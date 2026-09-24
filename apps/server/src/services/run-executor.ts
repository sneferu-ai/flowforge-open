/**
 * Run executor — durable step execution (§6).
 *
 * State machine: queued → running → (waiting | paused | succeeded | failed)
 * Terminal verdicts are `succeeded`, `failed`, `canceled` (§6.1). Durable
 * checkpoints live in `runs.state`:
 *   - outputs:        Record<stepId, unknown>    (expression `steps.<id>.output`)
 *   - _stepStatus:    Record<stepId, stepStatus> (expression `steps.<id>.status`)
 *   - _done:          Record<stepPath, true>     (completed step paths at any depth)
 *   - _pendingDelay:  { path, resumeAt }         (delay park)
 *   - _pendingApproval: { path, taskId }         (approval park)
 *   - _iteration:     Record<forEachPath, int>   (resume-safe loop cursor)
 *   - _reply:         { status, headers, body }  (webhook sync reply)
 *   - _runFailed:     boolean                    (top-level continue-failure)
 */

import { query } from '../db/pool.js';
import {
  type Manifest,
  type Step,
  evaluateExpression,
  resolveInterpolation,
  resolvePureInterpolation,
  isTruthy,
  type EvalContext,
  ExpressionError,
} from '@flowforge/engine';
import { decrypt } from '../crypto.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES } from '@flowforge/shared';
import { parseDurationMs } from '../lib/durations.js';
import { BlockList, isIP as netIsIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { featureEnabled } from '../auth/entitlements.js';
import { recordBillingForTerminalRun } from './billing.js';

const HEARTBEAT_INTERVAL_MS = 15_000; // §6.2
const HTTP_BODY_LIMIT = 1_048_576; // 1MB §18
const LOG_LIMIT = 64 * 1024; // 64KB §18
const MAX_REDIRECTS = 3; // §6.4: up to 3 hops, each checked against egress allowlist

// Private IP ranges blocked per §8.8
const PRIVATE_IP_BLOCKLIST = new BlockList();
PRIVATE_IP_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');       // loopback
PRIVATE_IP_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');         // RFC 1918 A
PRIVATE_IP_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');      // RFC 1918 B
PRIVATE_IP_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');     // RFC 1918 C
PRIVATE_IP_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');     // link-local
PRIVATE_IP_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4');      // CGNAT
PRIVATE_IP_BLOCKLIST.addSubnet('::1', 128, 'ipv6');             // IPv6 loopback
PRIVATE_IP_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');            // ULA
PRIVATE_IP_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');           // link-local
PRIVATE_IP_BLOCKLIST.addSubnet('::ffff:0:0', 96, 'ipv6');       // IPv4-mapped IPv6

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_BLOCKLIST.check(ip);
}

/**
 * Check if a hostname resolves to (or is) a private IP.
 * Fail-closed: if DNS resolution fails, treat as private (block).
 * Returns true if any resolved IP is private or DNS fails.
 */
async function isHostPrivate(hostname: string): Promise<boolean> {
  if (netIsIP(hostname) > 0) {
    return isPrivateIp(hostname);
  }
  try {
    const addresses = await dnsLookup(hostname, { all: true, family: 0 });
    if (addresses.length === 0) return true; // no DNS records → fail-closed
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) return true;
    }
    return false;
  } catch {
    return true; // DNS resolution failed → fail-closed
  }
}

/**
 * §5.4.8/§11 — env.FF_APP_URL evaluates to null when unset (e.g. `forge run`
 * without `--demo`). Only `--demo` sets it to `http://localhost:{port}`.
 */
function resolveAppUrl(): string | null {
  return process.env.FF_APP_URL || null;
}

/**
 * Check if a URL qualifies for the loopback exemption (§8.8).
 * When FF_SEED_DEMO=1, only the FF_APP_URL-derived host:port is exempt.
 */
function isLoopbackExempt(parsed: URL): boolean {
  if (process.env.FF_SEED_DEMO !== 'true' && process.env.FF_SEED_DEMO !== '1') return false;
  const appUrlStr = resolveAppUrl();
  if (!appUrlStr) return false;
  try {
    const appUrl = new URL(appUrlStr);
    const appPort = appUrl.port || (appUrl.protocol === 'https:' ? '443' : '80');
    const urlPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return (
      appUrl.hostname.toLowerCase() === parsed.hostname.toLowerCase() &&
      appPort === urlPort
    );
  } catch {
    return false;
  }
}
const REPLY_BODY_LIMIT = 64 * 1024; // §5.3
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const FORBIDDEN_HEADERS = new Set(['host', 'cookie', 'x-forwarded-for']);
const FORBIDDEN_REPLY_HEADERS = new Set(['set-cookie', 'content-length', 'transfer-encoding', 'connection']);

const STEP_STATUSES = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  WAITING: 'waiting',
  PAUSED: 'paused',
  SKIPPED: 'skipped',
  RUNNING: 'running',
} as const;

export interface RunExecutionResult {
  runId: string;
  status: string;
  output: Record<string, unknown> | null;
}

interface LoopCtx {
  item: unknown;
  index: number;
  outer: LoopCtx | null;
}

interface ExecutionContext {
  state: Record<string, unknown>;
  inputs: Record<string, unknown>;
  timeoutAt: Date;
  /** §6.2: max execution seconds = (timeout_at - created_at) / 1000 */
  timeoutSeconds: number;
  runId: string;
  workspaceId: string;
  trigger: { type: string; payload: unknown; scheduled_at?: string };
  loop: LoopCtx | null;
}

interface StepExecution {
  status: 'completed' | 'failed' | 'waiting' | 'paused';
  error?: { code: string; message: string };
  anyFailure?: boolean;
  anySuccess?: boolean;
  /** First failure swallowed by on_error: continue (for for_each result entries). */
  anyFailureError?: string;
  /** Completed-but-skipped (e.g. manual_approval timeout with on_timeout: skip). */
  skipped?: boolean;
}

function stateRecords(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = state[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  const created: Record<string, unknown> = {};
  state[key] = created;
  return created;
}

export async function executeWorkflowRun(runId: string): Promise<RunExecutionResult> {
  // Cross-worker serialization per run.
  const lockResult = await query(
    `INSERT INTO run_locks (run_id, locked_by)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM run_locks WHERE run_id = $1)
     ON CONFLICT (run_id) DO NOTHING
     RETURNING run_id`,
    [runId, `worker-${process.pid}`]
  );

  if (lockResult.rows.length === 0) {
    return { runId, status: 'running', output: null };
  }

  try {
    return await doExecuteRun(runId);
  } finally {
    await query('DELETE FROM run_locks WHERE run_id = $1 AND locked_by = $2', [runId, `worker-${process.pid}`]);
  }
}

async function doExecuteRun(runId: string): Promise<RunExecutionResult> {
  const runResult = await query<{
    id: string;
    workspace_id: string;
    workflow_version_id: string;
    status: string;
    state: Record<string, unknown> | null;
    started_at: string | null;
    timeout_at: string;
    created_at: string;
  }>(
    `SELECT id, workspace_id, workflow_version_id, status, state, started_at::text, timeout_at::text, created_at::text
     FROM runs WHERE id = $1`,
    [runId]
  );

  if (runResult.rows.length === 0) {
    throw new Error(`Run ${runId} not found`);
  }
  const run = runResult.rows[0];
  if (run.status === 'canceled' || run.status === 'failed' || run.status === 'succeeded') {
    return { runId, status: run.status, output: null };
  }

  const versionResult = await query<{ manifest_json: Record<string, unknown> }>(
    'SELECT manifest_json FROM workflow_versions WHERE id = $1',
    [run.workflow_version_id]
  );
  if (versionResult.rows.length === 0) {
    throw new Error(`Workflow version not found for run ${runId}`);
  }

  // manifest_json was stored zod-parsed; the stored object IS the manifest.
  const manifest = versionResult.rows[0].manifest_json as unknown as Manifest;
  const state = run.state ?? {};
  const suppliedInputs = (state.inputs as Record<string, unknown>) || {};
  // Manifest input defaults apply when the trigger did not supply a value (§5.1).
  const defaultInputs: Record<string, unknown> = {};
  for (const input of manifest.inputs || []) {
    if (input.default !== undefined) defaultInputs[input.name] = input.default;
  }
  const inputs = { ...defaultInputs, ...suppliedInputs };
  const trigger =
    (state.trigger as { type: string; payload: unknown; scheduled_at?: string }) ||
    { type: 'manual', payload: null };

  await preloadWorkspaceSecrets(run.workspace_id);

  await query(
    `UPDATE runs SET status = 'running', started_at = COALESCE(started_at, now()), heartbeat_at = now() WHERE id = $1`,
    [runId]
  );
  // §6.1 lifecycle feed — the UI's SSE stream subscribes to run.started;
  // emit it here so the subscription receives the same narrative the polls see.
  // §7 SSE shape: { run_id, started_at }
  await query(
    `INSERT INTO run_events (run_id, event_type, payload)
     VALUES ($1, 'run.started', jsonb_build_object('run_id', $2::text, 'started_at', now()))`,
    [runId, runId]
  );

  const heartbeatTimer = setInterval(async () => {
    try {
      await query('UPDATE runs SET heartbeat_at = now() WHERE id = $1', [runId]);
    } catch {
      /* heartbeat best-effort */
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  try {
    const ctx: ExecutionContext = {
      state,
      inputs,
      timeoutAt: new Date(run.timeout_at),
      timeoutSeconds: (new Date(run.timeout_at).getTime() - new Date(run.created_at).getTime()) / 1000,
      runId,
      workspaceId: run.workspace_id,
      trigger,
      loop: null,
    };

    const result = await executeSteps(runId, run.workspace_id, manifest.steps, ctx, '', 0);

    if (result.status === 'waiting') {
      const resumeAt = (state._pendingDelay as { resumeAt: string } | undefined)?.resumeAt ?? null;
      await query(
        `UPDATE runs SET status = 'waiting', state = $2, resume_at = $3 WHERE id = $1`,
        [runId, JSON.stringify(state), resumeAt]
      );
      // §7 SSE shape for run.waiting: { run_id, resume_at }
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.waiting', jsonb_build_object('run_id', $3::text, 'resume_at', $2::text))`,
        [runId, resumeAt, runId]
      );
      return { runId, status: 'waiting', output: null };
    }
    if (result.status === 'paused') {
      await query(`UPDATE runs SET status = 'paused', state = $2 WHERE id = $1`, [runId, JSON.stringify(state)]);
      const approval = state._pendingApproval as { path: string; taskId: string } | undefined;
      // §7 SSE shape for run.paused: { run_id, step_path, approval_task_id }
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.paused', jsonb_build_object('run_id', $4::text, 'step_path', $2::text, 'approval_task_id', $3::text))`,
        [runId, approval?.path ?? null, approval?.taskId ?? null, runId]
      );
      return { runId, status: 'paused', output: null };
    }

    const runFailed = state._runFailed === true || result.status === 'failed';
    const terminal = runFailed ? 'failed' : 'succeeded';
    const totalRunningSeconds = Math.floor((state._elapsedS as number) || 0);

    await query(
      `UPDATE runs SET status = $2, state = $3, finished_at = now(), heartbeat_at = now(),
        total_running_seconds = $5, error = $4 WHERE id = $1`,
      [runId, terminal, JSON.stringify(state), result.error?.code ?? null, totalRunningSeconds]
    );
    // §7 SSE shapes:
    //   run.succeeded → { run_id, finished_at, total_running_seconds }
    //   run.failed    → { run_id, finished_at, reason, total_running_seconds }
    if (terminal === 'succeeded') {
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.succeeded',
          jsonb_build_object('run_id', $3::text, 'finished_at', now(), 'total_running_seconds', $2::int))`,
        [runId, totalRunningSeconds, runId]
      );
    } else {
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.failed',
          jsonb_build_object('run_id', $4::text, 'finished_at', now(), 'reason', $2::text, 'total_running_seconds', $3::int))`,
        [runId, result.error?.code ?? 'unknown', totalRunningSeconds, runId]
      );
    }

    // Metering (§3.3, §7, D7): one billable unit per terminal run that
    // executed at least one step — shared with the scheduler/cancel paths so
    // every terminal transition bills identically and idempotently.
    await recordBillingForTerminalRun(
      run.workspace_id,
      runId,
      terminal === 'succeeded' ? 'run.succeeded' : 'run.failed'
    );

    await emitAuditEvent(
      run.workspace_id,
      null,
      terminal === 'succeeded' ? AUDIT_ACTIONS.RUN_SUCCEEDED : AUDIT_ACTIONS.RUN_FAILED,
      'run',
      runId,
      { error: result.error?.code ?? null }
    );

    return { runId, status: terminal, output: state._reply ? { _reply: state._reply } : null };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    console.error(`[run-executor] run ${runId} crashed: ${(err as Error).stack}`);
    await query(
      `UPDATE runs SET status = 'failed', state = $2, finished_at = now(),
        total_running_seconds = $4, error = $3 WHERE id = $1`,
      [runId, JSON.stringify(state), message, Math.floor((state._elapsedS as number) || 0)]
    );
    // §7 SSE shape for run.failed: { run_id, finished_at, reason, total_running_seconds }
    await query(
      `INSERT INTO run_events (run_id, event_type, payload)
       VALUES ($1, 'run.failed',
        jsonb_build_object('run_id', $4::text, 'finished_at', now(), 'reason', $2::text, 'total_running_seconds', $3::int))`,
      [runId, message, Math.floor((state._elapsedS as number) || 0), runId]
    );
    // A crashed run is a terminal failure — bill it when steps executed (§3.3,
    // D7). Runs that never started are skipped by the shared metering helper.
    try {
      await recordBillingForTerminalRun(run.workspace_id, runId, 'run.failed');
    } catch (billingError) {
      // Reconciliation verifies against usage_events; never mask the crash.
      console.error(`[run-executor] billing after crash failed: ${(billingError as Error).message}`);
    }
    await emitAuditEvent(run.workspace_id, null, AUDIT_ACTIONS.RUN_FAILED, 'run', runId, {
      error: (err as Error).message.slice(0, 500),
    });
    return { runId, status: 'failed', output: null };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// --- Step walking -----------------------------------------------------------------

async function executeSteps(
  runId: string,
  workspaceId: string,
  steps: Step[],
  ctx: ExecutionContext,
  prefix: string,
  iteration: number
): Promise<StepExecution> {
  const topLevel = prefix === '';
  let anyFailure = false;
  let anySuccess = false;
  let anyFailureError: string | undefined;
  for (const step of steps) {
    const stepPath = prefix ? `${prefix}.${step.id}` : step.id;

    // §6.2: timeout is total_running_seconds (excluding waiting/paused) >
    // (timeout_at - created_at) / 1000, NOT wall-clock time. A long delay or
    // manual_approval park must not consume the execution budget.
    if (topLevel && ((ctx.state._elapsedS as number) || 0) > ctx.timeoutSeconds) {
      return { status: 'failed', error: { code: ERROR_CODES.TIMEOUT_EXCEEDED, message: 'Run timed out' } };
    }

    const done = (stateRecords(ctx.state, '_done'));

    // `if` condition — skip without recording execution.
    if (step.if) {
      try {
        if (!isTruthy(evaluateExpression(step.if, buildEvalContext(ctx)))) {
          if (!done[stepPath]) {
            await insertStepRecord(runId, step.id, stepPath, iteration, STEP_STATUSES.SKIPPED, { if: step.if }, null, ctx);
            done[stepPath] = true;
            markStepStatus(ctx, step.id, 'skipped');
            // §7 SSE: step.skipped → { run_id, step_path }
            await query(
              `INSERT INTO run_events (run_id, event_type, payload)
               VALUES ($1, 'step.skipped', $2)`,
              [runId, JSON.stringify({ run_id: runId, step_path: stepPath })]
            );
          }
          continue;
        }
      } catch (err) {
        return { status: 'failed', error: stepError(err) };
      }
    }
    if (done[stepPath]) continue; // resume: already completed

    const result = await executeStepRecord(runId, workspaceId, step, stepPath, iteration, ctx);
    if (result.status === 'completed') {
      done[stepPath] = true;
      anySuccess = true;
      continue;
    }
    if (result.status === 'waiting' || result.status === 'paused') {
      return result;
    }
    // failed — honor on_error (§6.1, §20)
    if (step.on_error === 'continue') {
      anyFailure = true;
      anyFailureError = anyFailureError ?? result.error?.code ?? 'step_error';
      if (topLevel) ctx.state._runFailed = true;
      continue; // the scope continues; the failure rides the scope result
    }
    return result;
  }

  return { status: 'completed', anyFailure, anySuccess, anyFailureError };
}

async function executeStepRecord(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as Record<string, unknown>;
  const timeoutSeconds = Math.max(1, Math.min(step.timeout_seconds ?? 60, 3600));

  // Insert running row (resume-safe).
  // §6.2: crash recovery / retry re-inserts with attempt = previous_attempt + 1.
  // A non-terminal row (running/waiting/paused) is reused on resume; a terminal
  // row (succeeded/failed/skipped) triggers a new row with an incremented attempt
  // so the unique(run_id, step_path, attempt) index preserves each attempt.
  const existing = await query<{ id: string; status: string; attempt: number }>(
    `SELECT id, status, attempt FROM run_steps WHERE run_id = $1 AND step_path = $2 ORDER BY attempt DESC, started_at DESC LIMIT 1`,
    [runId, stepPath]
  );
  let stepDbId: string;
  let currentAttempt = 1;
  const stepInput = { ...config, on_error: step.on_error };
  if (existing.rows.length > 0) {
    const prev = existing.rows[0];
    if (['succeeded', 'failed', 'skipped'].includes(prev.status)) {
      // Retry / crash recovery: new row with incremented attempt (§6.2).
      currentAttempt = prev.attempt + 1;
      const inserted = await query<{ id: string }>(
        `INSERT INTO run_steps (run_id, step_id, step_path, iteration, status, input, started_at, attempt)
         VALUES ($1, $2, $3, $4, 'running', $5, now(), $6) RETURNING id`,
        [runId, step.id, stepPath, iteration, JSON.stringify(stepInput), currentAttempt]
      );
      stepDbId = inserted.rows[0].id;
    } else {
      // Resume: reuse the existing non-terminal row.
      stepDbId = prev.id;
      currentAttempt = prev.attempt;
      await query(`UPDATE run_steps SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1`, [stepDbId]);
    }
  } else {
    const inserted = await query<{ id: string }>(
      `INSERT INTO run_steps (run_id, step_id, step_path, iteration, status, input, started_at, attempt)
       VALUES ($1, $2, $3, $4, 'running', $5, now(), 1) RETURNING id`,
      [runId, step.id, stepPath, iteration, JSON.stringify(stepInput)]
    );
    stepDbId = inserted.rows[0].id;
  }

  // §7 SSE: step.started → { run_id, step_path, step_id, attempt, input }
  await query(
    `INSERT INTO run_events (run_id, event_type, payload)
     VALUES ($1, 'step.started', $2)`,
    [runId, JSON.stringify({ run_id: runId, step_path: stepPath, step_id: step.id, attempt: currentAttempt, input: config })]
  );

  const startedAt = Date.now();
  let result: StepExecution;

  try {
    switch (step.type) {
      case 'http': result = await executeHttpStep(runId, workspaceId, step, stepPath, ctx, timeoutSeconds); break;
      case 'notify': result = await executeNotifyStep(runId, workspaceId, step, stepPath, ctx); break;
      case 'condition': result = await executeConditionStep(runId, workspaceId, step, stepPath, iteration, ctx); break;
      case 'for_each': result = await executeForEachStep(runId, workspaceId, step, stepPath, iteration, ctx); break;
      case 'transform': result = await executeTransformStep(runId, step, stepPath, ctx); break;
      case 'delay': result = await executeDelayStep(runId, step, stepPath, iteration, ctx, stepDbId); break;
      case 'manual_approval': result = await executeApprovalStep(runId, workspaceId, step, stepPath, iteration, ctx, stepDbId); break;
      case 'log': result = await executeLogStep(runId, step, stepPath, iteration, ctx); break;
      case 'reply': result = await executeReplyStep(runId, step, stepPath, ctx); break;
      default:
        result = { status: 'failed' as const, error: { code: ERROR_CODES.VALIDATION_ERROR, message: `Unknown step type: ${step.type}` } };
    }
  } catch (err) {
    result = { status: 'failed', error: stepError(err) };
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  // Accumulate fractional seconds in state; the integer column stores the floor so
  // sub-second steps never lose their time across the run.
  ctx.state._elapsedS = ((ctx.state._elapsedS as number) || 0) + elapsedS;

  if (result.status === 'completed') {
    const stepStatus = result.skipped ? STEP_STATUSES.SKIPPED : STEP_STATUSES.SUCCEEDED;
    const outputValue = resultOutput(ctx, step.id) ?? null;
    await query(
      `UPDATE run_steps SET status = $1, finished_at = now(), output = $2 WHERE id = $3`,
      [stepStatus, JSON.stringify(outputValue), stepDbId]
    );
    await query(`UPDATE runs SET total_running_seconds = $2 WHERE id = $1`, [runId, Math.floor(ctx.state._elapsedS as number)]);
    markStepStatus(ctx, step.id, stepStatus);
    // §7 SSE: step.succeeded → { run_id, step_path, output }
    //         step.skipped   → { run_id, step_path }
    if (result.skipped) {
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'step.skipped', $2)`,
        [runId, JSON.stringify({ run_id: runId, step_path: stepPath })]
      );
    } else {
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'step.succeeded', $2)`,
        [runId, JSON.stringify({ run_id: runId, step_path: stepPath, output: outputValue })]
      );
    }
    return result;
  }
  if (result.status === 'failed') {
    const errorObj = result.error ?? { code: 'unknown', message: 'unknown' };
    await query(
      `UPDATE run_steps SET status = 'failed', finished_at = now(), output = $2 WHERE id = $1`,
      [stepDbId, JSON.stringify({ error: errorObj })]
    );
    await query(`UPDATE runs SET total_running_seconds = $2 WHERE id = $1`, [runId, Math.floor(ctx.state._elapsedS as number)]);
    markStepStatus(ctx, step.id, 'failed');
    // §7 SSE: step.failed → { run_id, step_path, error: { code, message } }
    await query(
      `INSERT INTO run_events (run_id, event_type, payload)
       VALUES ($1, 'step.failed', $2)`,
      [runId, JSON.stringify({ run_id: runId, step_path: stepPath, error: errorObj })]
    );
    return result;
  }
  // waiting / paused — the step row stays in its parked status.
  const parkedStatus = result.status === 'waiting' ? STEP_STATUSES.WAITING : STEP_STATUSES.PAUSED;
  await query(`UPDATE run_steps SET status = $2 WHERE id = $1`, [stepDbId, parkedStatus]);
  // §7 SSE: step.waiting → { run_id, step_path, resume_at }
  //         step.paused  → { run_id, step_path, prompt, approval_task_id }
  if (result.status === 'waiting') {
    const pendingDelay = ctx.state._pendingDelay as { path: string; resumeAt: string } | undefined;
    await query(
      `INSERT INTO run_events (run_id, event_type, payload)
       VALUES ($1, 'step.waiting', $2)`,
      [runId, JSON.stringify({ run_id: runId, step_path: stepPath, resume_at: pendingDelay?.resumeAt ?? null })]
    );
  } else {
    const pendingApproval = ctx.state._pendingApproval as { path: string; taskId: string } | undefined;
    const approvalConfig = step.with as { prompt?: string } | undefined;
    const promptText = approvalConfig?.prompt
      ? resolveInterpolation(approvalConfig.prompt, buildEvalContext(ctx))
      : null;
    await query(
      `INSERT INTO run_events (run_id, event_type, payload)
       VALUES ($1, 'step.paused', $2)`,
      [runId, JSON.stringify({ run_id: runId, step_path: stepPath, prompt: promptText, approval_task_id: pendingApproval?.taskId ?? null })]
    );
  }
  return result;
}

function resultOutput(ctx: ExecutionContext, stepId: string): unknown {
  const outputs = stateRecords(ctx.state, 'outputs');
  return outputs[stepId] ?? null;
}

function markStepStatus(ctx: ExecutionContext, stepId: string, status: string): void {
  const statuses = stateRecords(ctx.state, '_stepStatus');
  statuses[stepId] = status;
}

async function insertStepRecord(
  runId: string,
  stepId: string,
  stepPath: string,
  iteration: number,
  status: string,
  input: unknown,
  output: unknown,
  ctx: ExecutionContext
): Promise<void> {
  // §6.2: attempt starts at 1; crash recovery / retry increments. Compute the
  // next attempt from existing rows so the unique(run_id, step_path, attempt)
  // index never collides on a re-insert.
  const maxRow = await query<{ max_attempt: number }>(
    `SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM run_steps WHERE run_id = $1 AND step_path = $2`,
    [runId, stepPath]
  );
  const nextAttempt = (maxRow.rows[0]?.max_attempt ?? 0) + 1;
  await query(
    `INSERT INTO run_steps (run_id, step_id, step_path, iteration, status, input, output, started_at, finished_at, attempt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8)
     ON CONFLICT (run_id, step_path, attempt) DO NOTHING`,
    [runId, stepId, stepPath, iteration, status, JSON.stringify(input), JSON.stringify(output), nextAttempt]
  );
}

function stepError(err: unknown): { code: string; message: string } {
  if (err instanceof ExpressionError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'step_error', message: (err as Error).message.slice(0, 500) };
}

// --- Individual step executors -----------------------------------------------------

async function executeHttpStep(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  ctx: ExecutionContext,
  timeoutSeconds: number
): Promise<StepExecution> {
  const config = (step.with || {}) as {
    method?: string; url: string; headers?: Record<string, string>;
    body?: string; credential?: string; credential_header?: string;
    idempotency_key?: string;
  };
  const method = (config.method || 'GET').toUpperCase();

  // Track secrets references so a missing credential fails loudly rather than
  // silently interpolating to an empty string (§5.4), and so a workspace whose
  // plan lacks credential_vault is denied at execution time (§3.3).
  const missingSecrets = new Set<string>();
  let secretsReferenced = false;
  const evalCtx = () => {
    const c = buildEvalContext(ctx);
    const baseSecrets = c.secrets;
    c.secrets = (name: string) => {
      secretsReferenced = true;
      if (baseSecrets) {
        const v = typeof baseSecrets === 'function' ? baseSecrets(name) : null;
        if (v === null) missingSecrets.add(name);
        return v;
      }
      return null;
    };
    return c;
  };

  const url = resolveInterpolation(config.url, evalCtx());

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.headers || {})) {
    const key = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(key)) {
      return { status: 'failed', error: { code: ERROR_CODES.FORBIDDEN_HEADER, message: `Forbidden header: ${name}` } };
    }
    headers[name] = resolveInterpolation(value, evalCtx());
  }

  const body = config.body ? resolveInterpolation(config.body, evalCtx()) : undefined;

  // §3.3 — expressions referencing secrets.* on a plan without
  // credential_vault fail closed before any vault access is attempted.
  if (secretsReferenced && !(await featureEnabled(workspaceId, 'credential_vault'))) {
    return {
      status: 'failed',
      error: { code: ERROR_CODES.PLAN_FEATURE_REQUIRED, message: "secrets.* references require a plan with the 'credential_vault' feature flag" },
    };
  }
  if (missingSecrets.size > 0) {
    return { status: 'failed', error: { code: ERROR_CODES.SECRET_NOT_FOUND, message: `Secret not found: ${[...missingSecrets].join(', ')}` } };
  }

  // Legacy manifest credential reference (`credential` + optional header).
  if (config.credential && !headers.Authorization) {
    if (!(await featureEnabled(workspaceId, 'credential_vault'))) {
      return {
        status: 'failed',
        error: { code: ERROR_CODES.PLAN_FEATURE_REQUIRED, message: "credential references require a plan with the 'credential_vault' feature flag" },
      };
    }
    const credValue = await resolveCredential(workspaceId, config.credential);
    if (credValue === null) {
      return { status: 'failed', error: { code: ERROR_CODES.SECRET_NOT_FOUND, message: `Credential '${config.credential}' not found` } };
    }
    const targetHeader = config.credential_header || 'Authorization';
    headers[targetHeader] = targetHeader.toLowerCase() === 'authorization' ? `Bearer ${credValue}` : credValue;
  }

  // Egress policy (§8.8).
  const route = await checkEgressRoute(url, workspaceId);
  if (route === 'blocked') {
    return { status: 'failed', error: { code: ERROR_CODES.HOST_NOT_ALLOWED, message: `Host not on the egress allowlist: ${safeHost(url)}` } };
  }
  if (route === 'private_blocked') {
    return { status: 'failed', error: { code: ERROR_CODES.PRIVATE_IP_BLOCKED, message: `Private IP blocked: ${safeHost(url)}` } };
  }
  // §8.8 connector protocol — every hop to the connector authenticates with
  // the engine's own token AND carries the target URL. A manifest-provided
  // Authorization never collides with the token injection: it is forwarded as
  // `X-Target-Authorization` (an explicit manifest X-Target-Authorization wins).
  // The manifest's header object stays untouched so each redirect hop rebuilds
  // its own hop headers from the same base.
  const connectorToken = process.env.FF_CONNECTOR_TOKEN ?? '';
  const manifestAuthorization = headers['Authorization'];
  const manifestTargetAuthorization = headers['X-Target-Authorization'];

  const fetchHeaders: Record<string, string> = { ...headers };
  let fetchUrl = url;
  if (route === 'connector') {
    fetchUrl = process.env.FF_CONNECTOR_URL!;
    fetchHeaders['X-Target-URL'] = url;
    fetchHeaders['Authorization'] = `Bearer ${connectorToken}`;
    if (manifestAuthorization !== undefined) {
      fetchHeaders['X-Target-Authorization'] = manifestTargetAuthorization ?? manifestAuthorization;
    }
  }

  // Idempotency (§6.2): explicit key wins; otherwise ff:{run_id}:{step_path}.
  const idempotencyKey = config.idempotency_key || `ff:${runId}:${stepPath}`;
  fetchHeaders['X-Idempotency-Key'] = idempotencyKey;

  const retry = step.retry ?? { attempts: 3, backoff: 'exponential', base_ms: 500, max_ms: 30000, jitter: true };
  const maxAttempts = Math.min(Math.max(1, retry.attempts ?? 3), 10);

  let lastError: { code: string; message: string } = { code: ERROR_CODES.TIMEOUT_EXCEEDED, message: 'request failed' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Per-hop redirect following with egress checks (§8.8).
      // redirect: 'manual' — each hop checked against allowlist + private-IP.
      let currentUrl = fetchUrl;
      let currentHeaders = { ...fetchHeaders };
      let currentMethod = method;
      let currentBody = method === 'GET' || method === 'HEAD' ? undefined : body;
      let redirectCount = 0;
      let response: Response | null = null;

      for (;;) {
        response = await fetch(currentUrl, {
          method: currentMethod,
          headers: currentHeaders,
          body: currentBody,
          signal: AbortSignal.timeout(timeoutSeconds * 1000),
          redirect: 'manual',
        });

        const loc = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && loc) {
          if (++redirectCount > MAX_REDIRECTS) {
            lastError = { code: 'too_many_redirects', message: `Exceeded max redirects (${MAX_REDIRECTS})` };
            response = null;
            break;
          }
          const redirectUrl = new URL(loc, currentUrl).toString();

          // Per-hop egress + private-IP check (§8.8)
          const redirectRoute = await checkEgressRoute(redirectUrl, workspaceId);
          if (redirectRoute === 'blocked' || redirectRoute === 'private_blocked') {
            const code = redirectRoute === 'private_blocked' ? ERROR_CODES.PRIVATE_IP_BLOCKED : ERROR_CODES.HOST_NOT_ALLOWED;
            const msg = redirectRoute === 'private_blocked'
              ? `Redirect to private IP blocked: ${safeHost(redirectUrl)}`
              : `Redirect host not on the egress allowlist: ${safeHost(redirectUrl)}`;
            setStepOutput(ctx, step.id, { error: { code, message: msg } });
            return { status: 'failed', error: { code, message: msg } };
          }

          // §6.4/§8.8: use the per-hop redirectRoute, NOT the original first-hop
          // route — a redirect from an allowlisted host to an external host must
          // be connector-routed, and vice versa.
          if (redirectRoute === 'connector') {
            // §8.8 — connector hops carry the engine's token plus the hop's own
            // target URL; the manifest's Authorization rides X-Target-Authorization.
            currentUrl = process.env.FF_CONNECTOR_URL!;
            const hopHeaders: Record<string, string> = {
              ...headers,
              'X-Idempotency-Key': idempotencyKey,
              'X-Target-URL': redirectUrl,
              Authorization: `Bearer ${connectorToken}`,
            };
            if (manifestAuthorization !== undefined) {
              hopHeaders['X-Target-Authorization'] = manifestTargetAuthorization ?? manifestAuthorization;
            }
            currentHeaders = hopHeaders;
          } else {
            // Direct hop — manifest headers only: connector credentials
            // (X-Target-URL, the connector token, X-Target-Authorization) must
            // never leak to the target service.
            currentUrl = redirectUrl;
            currentHeaders = { ...headers, 'X-Idempotency-Key': idempotencyKey };
          }
          if (response.status === 303) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          continue;
        }
        break;
      }

      if (!response) {
        // Too many redirects — retry if attempts remain
        if (attempt < maxAttempts) {
          await backoffSleep(retry, attempt);
          continue;
        }
        setStepOutput(ctx, step.id, { error: lastError });
        return { status: 'failed', error: lastError };
      }

      const text = await response.text();
      const truncated = Buffer.byteLength(text, 'utf-8') > HTTP_BODY_LIMIT;
      const bodyText = truncated ? text.slice(0, HTTP_BODY_LIMIT) : text;
      let parsedBody: unknown = bodyText;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          parsedBody = bodyText;
        }
      }
      const output = {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: parsedBody,
        ...(truncated ? { truncated: true } : {}),
      };

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
          lastError = { code: 'http_error', message: `HTTP ${response.status}` };
          await backoffSleep(retry, attempt);
          continue;
        }
        setStepOutput(ctx, step.id, output);
        const failedResult: StepExecution = {
          status: 'failed',
          error: { code: 'http_error', message: `HTTP ${response.status} from ${safeHost(url)}` },
        };
        await finalizeHttpOutput(runId, stepPath, output);
        return failedResult;
      }

      setStepOutput(ctx, step.id, output);
      await finalizeHttpOutput(runId, stepPath, output);
      return { status: 'completed' };
    } catch (err) {
      lastError = stepError(err);
      if (attempt < maxAttempts) {
        await backoffSleep(retry, attempt);
        continue;
      }
    }
  }

  setStepOutput(ctx, step.id, { error: lastError });
  return { status: 'failed', error: lastError };
}

async function finalizeHttpOutput(runId: string, stepPath: string, output: unknown): Promise<void> {
  await query(
    `UPDATE run_steps SET output = $2 WHERE run_id = $1 AND step_path = $3`,
    [runId, JSON.stringify(output), stepPath]
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

type EgressRoute = 'direct' | 'connector' | 'blocked' | 'private_blocked';

async function checkEgressRoute(url: string, workspaceId: string): Promise<EgressRoute> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'blocked';
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  // Private-IP blocking (§8.8) — check before allowlist.
  // Loopback exemption: only FF_APP_URL-derived host:port when FF_SEED_DEMO=1.
  if (!isLoopbackExempt(parsed)) {
    if (await isHostPrivate(host)) {
      return 'private_blocked';
    }
  }

  if (await allowlistContains(workspaceId, parsed.protocol.replace(':', ''), host, port)) {
    return 'direct';
  }
  // env-var bootstrap (§4.4, §8.8)
  const envEntries = String(process.env.FF_HTTP_ALLOWLIST || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  for (const entry of envEntries) {
    let scheme: string | null = null;
    let hostPort = entry;
    const m = entry.match(/^([a-z]+):\/\/(.+)$/i);
    if (m) {
      scheme = m[1].toLowerCase();
      hostPort = m[2];
    }
    const [h, p] = hostPort.split(':');
    if (h && host === h.toLowerCase() && (!p || p === port || (!scheme && (port === '80' || port === '443')))) {
      if (!scheme || scheme === parsed.protocol.replace(':', '')) return 'direct';
    }
  }
  const appUrlStr = resolveAppUrl();
  if (appUrlStr) {
    try {
      const appUrl = new URL(appUrlStr);
      if (appUrl.hostname.toLowerCase() === host) return 'direct';
    } catch {
      /* ignore malformed */
    }
  }
  if (process.env.FF_CONNECTOR_URL) {
    try {
      const connectorUrl = new URL(process.env.FF_CONNECTOR_URL);
      if (connectorUrl.hostname.toLowerCase() === host) return 'direct';
    } catch {
      /* ignore malformed */
    }
    return 'connector'; // non-allowlisted host + connector configured
  }
  return 'blocked';
}

async function allowlistContains(workspaceId: string, scheme: string, host: string, port: string): Promise<boolean> {
  const rows = await query<{ scheme: string; host: string; port: number | null }>(
    'SELECT scheme, host, port FROM workspace_allowlist WHERE workspace_id = $1',
    [workspaceId]
  );
  const defaultPort = scheme === 'https' ? '443' : '80';
  return rows.rows.some(
    (r) =>
      r.scheme === scheme &&
      r.host.toLowerCase() === host &&
      (r.port === null ? port === defaultPort || port === (scheme === 'https' ? '443' : '80') : String(r.port) === port)
  );
}

async function resolveCredential(workspaceId: string, name: string): Promise<string | null> {
  const rows = await query<{ value_enc: string }>(
    'SELECT value_enc FROM credentials WHERE workspace_id = $1 AND name = $2',
    [workspaceId, name]
  );
  if (rows.rows.length === 0) return null;
  try {
    return decrypt(rows.rows[0].value_enc, workspaceId);
  } catch {
    return null;
  }
}

async function executeNotifyStep(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { channel: string; to: string; subject?: string; body: string };
  const evalCtx = buildEvalContext(ctx);

  const recipient = resolveInterpolation(config.to, evalCtx);
  const subject = config.subject ? resolveInterpolation(config.subject, evalCtx) : '';
  const body = resolveInterpolation(config.body, evalCtx);

  if (config.channel === 'inbox') {
    // §8.7 — inbox notifications stay on the `notifications` table; the
    // recipient must be a workspace member (by email or user id).
    const member = await query<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 AND (u.email = $2 OR u.id::text = $2)
       LIMIT 1`,
      [workspaceId, recipient]
    );
    if (member.rows.length === 0) {
      return { status: 'failed', error: { code: ERROR_CODES.UNKNOWN_RECIPIENT, message: `Unknown inbox recipient: ${recipient}` } };
    }
    const inserted = await query<{ id: string }>(
      `INSERT INTO notifications (workspace_id, run_id, channel, recipient, subject, body, is_read)
       VALUES ($1, $2, 'inbox', $3, $4, $5, false) RETURNING id`,
      [workspaceId, runId, recipient, subject, body]
    );
    setStepOutput(ctx, step.id, { message_id: inserted.rows[0].id, status: 'enqueued' });
    return { status: 'completed' };
  }

  // channel email — §7/D22: enqueue-only; the row lands in notification_outbox
  // with the standardized idempotency key `ff:{run_id}:{step_path}` (§6.2), and
  // dispatch happens asynchronously with bounded retries.
  await enqueueOutboxNotification(workspaceId, runId, stepPath, 'email', recipient, subject, body);
  setStepOutput(ctx, step.id, { message_id: null, status: 'enqueued' });
  return { status: 'completed' };
}

/**
 * §7/D22 — write a `notification_outbox` row. Idempotent per (run, step path):
 * a retried notify step re-inserts the same key and conflicts away silently.
 */
export async function enqueueOutboxNotification(
  workspaceId: string,
  runId: string,
  stepPath: string,
  channel: string,
  recipient: string,
  subject: string,
  body: string
): Promise<void> {
  const idempotencyKey = `ff:${runId}:${stepPath}`;
  await query(
    `INSERT INTO notification_outbox
       (workspace_id, run_id, step_path, channel, recipient, subject, body, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [workspaceId, runId, stepPath, channel, recipient, subject, body, idempotencyKey]
  );
}

/**
 * §8.7 — approval notification via the outbox to the FIRST owner by
 * created_at ASC. Never blocks the step: the approval task is already
 * durable; the notification is best-effort (outbox dispatch retries).
 */
export async function enqueueApprovalNotification(
  workspaceId: string,
  runId: string,
  stepPath: string,
  prompt: string
): Promise<void> {
  const owner = await query<{ email: string; name: string }>(
    `SELECT u.email, u.name FROM users u
     JOIN workspace_members wm ON wm.user_id = u.id
     WHERE wm.workspace_id = $1 AND wm.role = 'owner'
     ORDER BY wm.created_at ASC LIMIT 1`,
    [workspaceId]
  );
  if (owner.rows.length === 0) {
    console.warn(`[run-executor] approval ${runId}/${stepPath}: workspace has no owner to notify`);
    return;
  }
  await enqueueOutboxNotification(
    workspaceId,
    runId,
    stepPath,
    'email',
    owner.rows[0].email,
    'Approval required',
    prompt
  );
}

async function executeConditionStep(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { when: string; then?: Step[]; else?: Step[] };
  let condition: unknown = false;
  try {
    condition = evaluateExpression(config.when, buildEvalContext(ctx));
  } catch (err) {
    return { status: 'failed', error: stepError(err) };
  }
  const branchSteps = isTruthy(condition) ? (config.then || []) : (config.else || []);
  const branchName = isTruthy(condition) ? 'then' : 'else';

  if (branchSteps.length === 0) {
    setStepOutput(ctx, step.id, { branch: branchName, output: null });
    return { status: 'completed' };
  }

  const result = await executeSteps(runId, workspaceId, branchSteps, ctx, `${stepPath}.${branchName}`, iteration);
  if (result.status === 'failed') {
    return result;
  }
  if (result.status !== 'completed') {
    return result; // waiting/paused bubbles up with cursor intact
  }
  const outputs = stateRecords(ctx.state, 'outputs');
  const lastStep = branchSteps[branchSteps.length - 1];
  const output = lastStep ? (outputs[lastStep.id] ?? null) : null;
  setStepOutput(ctx, step.id, { branch: branchName, output });
  return { status: 'completed', anyFailure: result.anyFailure, anySuccess: result.anySuccess };
}

async function executeForEachStep(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { over: string; limit?: number };
  // Children live at the STEP level (`steps:`) in the flat envelope (§5.2);
  // `with.steps` is accepted as a compatibility spelling.
  const children: Step[] = (step.steps ?? (config as unknown as { steps?: Step[] }).steps ?? []);
  let items: unknown;
  try {
    items = evaluateExpression(config.over, buildEvalContext(ctx));
  } catch (err) {
    return { status: 'failed', error: stepError(err) };
  }

  if (items === null || items === undefined) {
    setStepOutput(ctx, step.id, { results: [], truncated: false, dropped_count: 0 });
    return { status: 'completed' };
  }
  if (!Array.isArray(items)) {
    return { status: 'failed', error: { code: ERROR_CODES.TYPE_MISMATCH, message: 'for_each over must evaluate to a list' } };
  }

  const limit = Math.max(1, Math.min(config.limit ?? 100, 1000));
  const droppedCount = items.length > limit ? items.length - limit : 0;
  const bounded = items.slice(0, limit);

  const iterState = stateRecords(ctx.state, '_iteration');
  const resumeIndex = typeof iterState[stepPath] === 'number' ? (iterState[stepPath] as number) : 0;
  // §5.3 — one result entry per iteration: failed entries carry their error
  // code, skipped iterations mark `skipped`, succeeded iterations carry the
  // last executed child's output.
  const results: Array<Record<string, unknown>> = [];
  let anySucceeded = false;
  let anyExecuted = false;
  let iterationFailure = false;

  for (let i = resumeIndex; i < bounded.length; i++) {
    iterState[stepPath] = i;
    const childCtx: ExecutionContext = {
      ...ctx,
      loop: { item: bounded[i], index: i, outer: ctx.loop },
    };
    const subResult = await executeSteps(runId, workspaceId, children, childCtx, `${stepPath}[${i}]`, i);
    if (subResult.status === 'waiting' || subResult.status === 'paused') {
      return subResult;
    }

    if (subResult.status === 'failed') {
      // Child abort. The for_each itself decides via its own on_error.
      results.push({ status: 'failed', error: subResult.error?.code ?? 'step_error' });
      setStepOutput(ctx, step.id, { results, truncated: droppedCount > 0, dropped_count: droppedCount });
      return { status: 'failed', error: subResult.error };
    }

    // §5.3 iteration verdict: iterate the children of THIS iteration only.
    // Skipped children (if: false) do not count as attempted — an iteration
    // whose children are ALL skipped is a `skipped` result entry.
    const done = stateRecords(childCtx.state, '_done');
    const statuses = stateRecords(childCtx.state, '_stepStatus');
    const outputs = stateRecords(childCtx.state, 'outputs');
    let iterAttempted = false;
    let iterSucceeded = false;
    let lastChildOutput: unknown = null;
    for (const child of children) {
      const childPath = `${stepPath}[${i}].${child.id}`;
      if (!done[childPath]) continue; // unreachable children (nested park edges)
      const st = (statuses[child.id] as string) || 'skipped';
      if (st === 'skipped') continue;
      iterAttempted = true;
      anyExecuted = true;
      if (st === 'succeeded') {
        iterSucceeded = true;
        anySucceeded = true;
        lastChildOutput = outputs[child.id] ?? null;
      }
    }
    if (!iterAttempted) {
      results.push({ status: 'skipped' });
    } else if (subResult.anyFailure && !iterSucceeded) {
      results.push({ status: 'failed', error: subResult.anyFailureError ?? 'step_error' });
      iterationFailure = true;
    } else {
      results.push({ status: 'succeeded', step_id: children[children.length - 1]?.id, output: lastChildOutput });
    }
    if (subResult.anyFailure) iterationFailure = true;
    delete iterState[stepPath];
  }

  // §20 edge cases: all children failed via continue and none succeeded →
  // the step fails; all-skipped → succeeded with skipped results.
  setStepOutput(ctx, step.id, { results, truncated: droppedCount > 0, dropped_count: droppedCount });
  if (!anyExecuted) {
    return { status: 'completed' };
  }
  if (!anySucceeded && iterationFailure) {
    return {
      status: 'failed',
      error: { code: 'step_error', message: 'All for_each iterations failed' },
    };
  }
  return { status: 'completed', anyFailure: iterationFailure, anySuccess: anySucceeded };
}

async function executeTransformStep(
  runId: string,
  step: Step,
  stepPath: string,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { set?: Record<string, string> };
  const created: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(config.set || {})) {
    try {
      created[key] = resolvePureInterpolation(expr, buildEvalContext(ctx));
    } catch (err) {
      return { status: 'failed', error: stepError(err) };
    }
  }
  setStepOutput(ctx, step.id, created);
  void stepPath;
  return { status: 'completed' };
}

async function executeDelayStep(
  runId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext,
  stepDbId: string
): Promise<StepExecution> {
  const config = (step.with || {}) as { duration: string };
  const durationMs = parseDurationMs(config.duration || '30s');
  if (durationMs === null) {
    return { status: 'failed', error: { code: ERROR_CODES.TYPE_MISMATCH, message: `Invalid delay duration: ${config.duration}` } };
  }

  const pending = ctx.state._pendingDelay as { path: string; resumeAt: string } | undefined;
  if (pending && pending.path === stepPath) {
    if (Date.now() < new Date(pending.resumeAt).getTime()) {
      return { status: 'waiting' };
    }
    // Resume: delay already elapsed.
    await query(
      `UPDATE run_steps SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1`,
      [stepDbId, JSON.stringify({ resumed_at: new Date().toISOString(), duration: config.duration })]
    );
    delete ctx.state._pendingDelay;
    setStepOutput(ctx, step.id, { resumed_at: new Date().toISOString() });
    return { status: 'completed' };
  }

  const resumeAt = new Date(Date.now() + durationMs);
  ctx.state._pendingDelay = { path: stepPath, resumeAt: resumeAt.toISOString() };
  await query(
    `UPDATE run_steps SET output = $2 WHERE id = $1`,
    [stepDbId, JSON.stringify({ duration: config.duration, resume_at: resumeAt.toISOString() })]
  );
  void iteration;
  void runId;
  return { status: 'waiting' };
}

async function executeApprovalStep(
  runId: string,
  workspaceId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext,
  stepDbId: string
): Promise<StepExecution> {
  const config = (step.with || {}) as { prompt: string; timeout_seconds?: number; on_timeout?: 'skip' | 'abort' };

  // §3.3 — manual_approval is a plan feature; execution on a plan that lacks
  // it fails closed (plan_feature_required) instead of running unauthorized.
  if (!(await featureEnabled(workspaceId, 'manual_approval'))) {
    return {
      status: 'failed',
      error: { code: ERROR_CODES.PLAN_FEATURE_REQUIRED, message: "manual_approval requires a plan with the 'manual_approval' feature flag" },
    };
  }

  const onTimeout = config.on_timeout ?? 'skip';
  const prompt = resolveInterpolation(config.prompt, buildEvalContext(ctx));
  const timeoutSeconds = Math.max(60, Math.min(config.timeout_seconds ?? 86400, 30 * 24 * 3600));
  const timeoutAt = new Date(Date.now() + timeoutSeconds * 1000);

  const pending = ctx.state._pendingApproval as { path: string; taskId: string } | undefined;

  if (!pending || pending.path !== stepPath) {
    // First encounter (or a crashed worker left a stale task): create one.
    const existing = await query<{ id: string; status: string }>(
      `SELECT id, status FROM approval_tasks WHERE run_id = $1 AND step_path = $2 ORDER BY created_at DESC LIMIT 1`,
      [runId, stepPath]
    );
    if (existing.rows.length === 0 || ['timeout', 'canceled'].includes(existing.rows[0].status)) {
      const created = await query<{ id: string }>(
        `INSERT INTO approval_tasks (run_id, workspace_id, step_id, step_path, prompt, on_timeout, timeout_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [runId, workspaceId, step.id, stepPath, prompt, onTimeout, timeoutAt]
      );
      ctx.state._pendingApproval = { path: stepPath, taskId: created.rows[0].id };
      // §8.7 — approval notification goes to the first owner by created_at ASC,
      // through the outbox (idempotent per run + step path).
      await enqueueApprovalNotification(workspaceId, runId, stepPath, prompt).catch(() => {});
    } else {
      ctx.state._pendingApproval = { path: stepPath, taskId: existing.rows[0].id };
    }
    await query(
      `UPDATE run_steps SET output = $2 WHERE id = $1`,
      [stepDbId, JSON.stringify({ prompt, timeout_at: timeoutAt.toISOString(), decision: null })]
    );
    void iteration;
    return { status: 'paused' };
  }

  // Resume path: read the decision.
  const task = await query<{ status: string; decision: string | null; decided_by: string | null; decided_at: string | null }>(
    'SELECT status, decision, decided_by, decided_at::text FROM approval_tasks WHERE id = $1',
    [pending.taskId]
  );
  if (task.rows.length === 0) {
    return { status: 'failed', error: { code: 'step_error', message: 'Approval task missing' } };
  }
  const { status: taskStatus, decision, decided_by: decidedByRaw, decided_at: decidedAtRaw } = task.rows[0];
  const decidedBy = decidedByRaw === null ? null : String(decidedByRaw);
  const decidedAt = decidedAtRaw === null ? null : String(decidedAtRaw);
  // §20: approval output shape is { decision, decided_by, decided_at } for
  // every terminal decision.
  const approvalOutput = (d: string, by: string | null = decidedBy, at: string | null = decidedAt) => ({
    decision: d,
    decided_by: by,
    decided_at: at,
  });

  if (taskStatus === 'pending') {
    return { status: 'paused' }; // not actually decided yet (stale resume)
  }
  if (taskStatus === 'timeout') {
    if (onTimeout === 'abort') {
      setStepOutput(ctx, step.id, approvalOutput('timeout'));
      return { status: 'failed', error: { code: 'approval_timeout', message: 'Approval timed out' } };
    }
    setStepOutput(ctx, step.id, approvalOutput('timeout'));
    delete ctx.state._pendingApproval;
    // §5.3/§20 — timeout with on_timeout: skip ⇒ the step is skipped.
    return { status: 'completed', skipped: true };
  }
  if (decision === 'approved') {
    const out = approvalOutput('approved');
    await query(
      `UPDATE run_steps SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1`,
      [stepDbId, JSON.stringify(out)]
    );
    setStepOutput(ctx, step.id, out);
    delete ctx.state._pendingApproval;
    return { status: 'completed' };
  }
  // rejected
  const out = approvalOutput(decision ?? 'rejected');
  delete ctx.state._pendingApproval;
  setStepOutput(ctx, step.id, out);
  await query(
    `UPDATE run_steps SET status = 'failed', output = $2, finished_at = now() WHERE id = $1`,
    [stepDbId, JSON.stringify(out)]
  );
  return { status: 'failed', error: { code: 'approval_rejected', message: 'Approval rejected' } };
}

async function executeLogStep(
  runId: string,
  step: Step,
  stepPath: string,
  iteration: number,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { level?: string; message: string };
  const message = resolveInterpolation(config.message, buildEvalContext(ctx)).slice(0, LOG_LIMIT);
  const emitted = message.slice(0, LOG_LIMIT);
  setStepOutput(ctx, step.id, { message: emitted });
  await query(
    `UPDATE run_steps SET logs = $2 WHERE run_id = $1 AND step_path = $3`,
    [runId, emitted.slice(0, LOG_LIMIT), stepPath]
  );
  void iteration;
  return { status: 'completed' };
}

async function executeReplyStep(
  runId: string,
  step: Step,
  stepPath: string,
  ctx: ExecutionContext
): Promise<StepExecution> {
  const config = (step.with || {}) as { status?: number; headers?: Record<string, string>; body: string };
  const body = resolveInterpolation(config.body, buildEvalContext(ctx));
  if (Buffer.byteLength(body, 'utf-8') > REPLY_BODY_LIMIT) {
    return { status: 'failed', error: { code: ERROR_CODES.REPLY_BODY_TOO_LARGE, message: 'reply body exceeds 64KB' } };
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.headers || {})) {
    if (FORBIDDEN_REPLY_HEADERS.has(name.toLowerCase())) {
      return { status: 'failed', error: { code: ERROR_CODES.FORBIDDEN_REPLY_HEADER, message: `Forbidden reply header: ${name}` } };
    }
    headers[name] = String(value);
  }
  const reply = { status: config.status ?? 200, headers, body };
  ctx.state._reply = reply;
  setStepOutput(ctx, step.id, reply);
  void runId;
  void stepPath;
  return { status: 'completed' };
}

// --- Shared helpers ------------------------------------------------------------------

function setStepOutput(ctx: ExecutionContext, stepId: string, value: unknown): void {
  const outputs = stateRecords(ctx.state, 'outputs');
  outputs[stepId] = value;
}

let _preloadedSecrets: { workspaceId: string; secrets: Record<string, string> } | null = null;

/**
 * Decrypt the workspace's webhook secrets once per execution and expose them
 * to the expression sandbox (secrets.* bindings, §5.4). Unreadable secrets are
 * treated as missing; expressions referencing them resolve to null and the
 * using step fails with secret_not_found.
 */
export async function preloadWorkspaceSecrets(workspaceId: string): Promise<void> {
  if (_preloadedSecrets?.workspaceId === workspaceId) return;
  const rows = await query<{ name: string; value_enc: string }>(
    'SELECT name, value_enc FROM webhook_secrets WHERE workspace_id = $1',
    [workspaceId]
  );
  const secrets: Record<string, string> = {};
  for (const row of rows.rows) {
    try {
      secrets[row.name] = decrypt(row.value_enc, workspaceId);
    } catch {
      /* treated as missing */
    }
  }
  _preloadedSecrets = { workspaceId, secrets };
  (globalThis as Record<string, unknown>).__ffSecrets = secrets;
}

/** Ensure secrets are preloaded for expression evaluation before stepping. */
function buildEvalContext(ctx: ExecutionContext): EvalContext {
  const outputs = stateRecords(ctx.state, 'outputs');
  const statuses = stateRecords(ctx.state, '_stepStatus');
  const steps: Record<string, { output: unknown; status: string }> = {};
  for (const key of Object.keys(outputs)) {
    steps[key] = { output: outputs[key], status: (statuses[key] as string) || 'succeeded' };
  }
  return {
    inputs: ctx.inputs,
    steps,
    loop: ctx.loop ? { item: ctx.loop.item, index: ctx.loop.index, outer: ctx.loop.outer } : null,
    trigger: ctx.trigger,
    secrets: (name: string) => {
      const preloaded = (globalThis as Record<string, unknown>).__ffSecrets as Record<string, string> | undefined;
      return preloaded?.[name] ?? null;
    },
    env: { FF_APP_URL: resolveAppUrl() },
    run: {
      id: ctx.runId,
      // §5.4.6 — ISO 8601 for schedule (the trigger's fire instant) and
      // webhook (receipt time) runs; null for manual runs.
      scheduled_at: ctx.trigger.type === 'manual' || !ctx.trigger.scheduled_at ? null : (ctx.trigger.scheduled_at as string),
    },
  };
}

function backoffSleep(retry: { backoff?: string; base_ms?: number; max_ms?: number; jitter?: boolean }, attempt: number): Promise<void> {
  const base = retry.base_ms ?? 500;
  const max = retry.max_ms ?? 30000;
  let ms = retry.backoff === 'fixed' ? base : base * Math.pow(2, attempt - 1);
  if (retry.jitter !== false) {
    ms = ms * (0.75 + Math.random() * 0.5);
  }
  ms = Math.min(ms, max);
  return new Promise((resolve) => setTimeout(resolve, Math.floor(ms)));
}
