/**
 * Run routes — list, get, cancel, approvals, manual trigger.
 *
 * Manual trigger contract (§6.3, §9):
 *  - disabled workflow → 403 workflow_disabled
 *  - over concurrency limit → 429 concurrency_limit_exceeded
 *  - Free-plan run cap → 429 run_limit_exceeded
 *  - 10-second bucket dedup on (workflow, inputs)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';
import { ERROR_CODES, AUDIT_ACTIONS, getPlanDefinition } from '@flowforge/shared';
import { hasHardRunCap } from '../auth/entitlements.js';
import { emitAuditEvent } from '../audit/emit.js';
import { parsePageParams } from '../lib/pagination.js';

const ACTIVE_STATUSES = `('queued','running','waiting','paused')`;

import { enqueueRunJob, getRunQueue, releaseWorkflowLock } from '../services/queue.js';
import { recordBillingForTerminalRun } from '../services/billing.js';

export { enqueueRunJob };

const approvalGate = [requireAuth, requireFeature('manual_approval')];

export async function runRoutes(fastify: FastifyInstance): Promise<void> {
  // List runs
  fastify.get('/runs', { preHandler: requireAuth }, async (request) => {
    const { limit, offset } = parsePageParams(request.query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const workflowId = (request.query as Record<string, string>).workflow_id;
    const status = (request.query as Record<string, string>).status;

    let sql = `SELECT r.id, r.workflow_id, r.status, r.error, r.started_at::text, r.finished_at::text,
                      r.created_at::text, r.trigger_id, r.recovery_count,
                      w.name as workflow_name
               FROM runs r
               JOIN workflows w ON w.id = r.workflow_id
               WHERE r.workspace_id = $1`;
    const params: unknown[] = [request.auth!.workspaceId];
    let paramIdx = 2;
    if (workflowId) {
      sql += ` AND r.workflow_id = $${paramIdx++}`;
      params.push(workflowId);
    }
    if (status) {
      sql += ` AND r.status = $${paramIdx++}`;
      params.push(status);
    }
    sql += ` ORDER BY r.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return { data: result.rows };
  });

  // Get run
  fastify.get('/runs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      `SELECT r.id, r.workflow_id, r.status, r.state, r.cursor, r.error,
              r.started_at::text, r.finished_at::text, r.created_at::text, r.heartbeat_at::text,
              r.recovery_count, r.total_running_seconds, r.trigger_id, r.resume_at::text, r.timeout_at::text,
              w.name as workflow_name
       FROM runs r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.id = $1 AND r.workspace_id = $2`,
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.RUN_NOT_FOUND, message: 'Run not found' } });
    }
    return { data: result.rows[0] };
  });

  // Get run steps
  fastify.get('/runs/:id/steps', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const runCheck = await query('SELECT id FROM runs WHERE id = $1 AND workspace_id = $2', [id, request.auth!.workspaceId]);
    if (runCheck.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.RUN_NOT_FOUND, message: 'Run not found' } });
    }
    const result = await query(
      `SELECT id, step_id, step_path, iteration, status, input, output, logs,
              attempt, started_at::text, finished_at::text
       FROM run_steps WHERE run_id = $1 ORDER BY started_at, step_path`,
      [id]
    );
    return { data: result.rows };
  });

  // Run events (SSE §D13) — also returns the full history as JSON when
  // no Accept: text/event-stream header is present.
  fastify.get('/runs/:id/events', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const runCheck = await query<{ id: string; status: string }>(
      'SELECT id, status FROM runs WHERE id = $1 AND workspace_id = $2',
      [id, request.auth!.workspaceId],
    );
    if (runCheck.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.RUN_NOT_FOUND, message: 'Run not found' } });
    }
    const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
    const TERMINAL_EVENT_TYPES = new Set(['run.succeeded', 'run.failed', 'run.canceled']);
    const isTerminal = (rows: Array<Record<string, unknown>>): boolean =>
      rows.some((r) => TERMINAL_EVENT_TYPES.has(r.event_type as string));
    const result = await query(
      `SELECT id, event_type, payload, created_at::text FROM run_events WHERE run_id = $1 ORDER BY created_at, id`,
      [id]
    );
    const wantsSse = (request.headers.accept ?? '').includes('text/event-stream');
    if (!wantsSse) {
      return { data: result.rows };
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    for (const row of result.rows) {
      reply.raw.write(`event: ${(row as { event_type: string }).event_type}\ndata: ${JSON.stringify((row as { payload: unknown }).payload)}\n\n`);
    }
    // §7 — terminal closes: after the replay, a run that has already reached
    // a terminal state (succeeded/failed/canceled — either per the runs row
    // or per its replayed events) ends the stream immediately. Only a live
    // run keeps the connection open for the polling loop below.
    if (TERMINAL_RUN_STATUSES.has(runCheck.rows[0].status) || isTerminal(result.rows)) {
      reply.raw.end();
      return;
    }
    // §7 — heartbeat every 15s during the SSE connection so intermediate
    // proxies never idle out a live subscription (the row stream itself is
    // quiet between step transitions, which can span minutes for a delay or
    // a parked manual_approval).
    let lastHeartbeatAt = Date.now();
    const interval = setInterval(async () => {
      try {
        /* Cursor on (created_at, id) — a plain created_at > cursor can drop an
         * event inserted in the same millisecond as the previous replayed row
         * (the executor now emits several lifecycle events per transition). */
        const lastRow = result.rows.length > 0 ? result.rows[result.rows.length - 1] : null;
        const fresh = await query(
          `SELECT id, event_type, payload, created_at::text FROM run_events
           WHERE run_id = $1 AND ${
             lastRow
               ? '((created_at, id) > ($2::timestamptz, $3::uuid))'
               : 'created_at >= $2::timestamptz'
           } ORDER BY created_at, id`,
          lastRow
            ? [id, lastRow.created_at, lastRow.id]
            : [id, '1970-01-01T00:00:00.000Z']
        );
        for (const row of fresh.rows) {
          reply.raw.write(`event: ${(row as { event_type: string }).event_type}\ndata: ${JSON.stringify((row as { payload: unknown }).payload)}\n\n`);
          result.rows.push(row);
        }
        // §7 — terminal closes: once the stream observes the run's terminal
        // event, flush and end so subscribers are not left hanging.
        if (isTerminal(fresh.rows)) {
          clearInterval(interval);
          reply.raw.end();
          return;
        }
        // §7 SSE shape for heartbeat: { ts }
        const heartbeatNow = Date.now();
        if (heartbeatNow - lastHeartbeatAt >= 15_000) {
          reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
          lastHeartbeatAt = heartbeatNow;
        }
      } catch {
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1000);
    reply.raw.on('close', () => clearInterval(interval));
  });

  // Cancel run (§6.1 state machine; §3.3/D7 billing; §9).
  //
  // One transaction: terminal transition + pending-approval cleanup +
  // resume_at/job_id clearing + metering. A run canceled from `queued` before
  // any step executed is NOT billed; a run canceled after it started IS billed
  // (usage_events row + subscriptions.runs_consumed in the same transaction).
  fastify.post('/runs/:id/cancel', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = request.auth!.workspaceId;

    const canceled = await withTransaction(async (tx) => {
      const runResult = await tx.query<{ status: string; started_at: string | null; workflow_id: string; job_id: string | null }>(
        `SELECT status, started_at::text, workflow_id, job_id FROM runs
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [id, workspaceId]
      );
      if (runResult.rows.length === 0) return null;
      const run = runResult.rows[0];
      if (!['queued', 'running', 'waiting', 'paused'].includes(run.status)) return null;

      await tx.query(
        `UPDATE runs SET status = 'canceled', finished_at = now(), resume_at = NULL, job_id = NULL
         WHERE id = $1`,
        [id]
      );
      // §6.1 lifecycle feed — the UI's SSE stream listens for run.canceled.
      // §7 SSE shape for run.canceled: { run_id, finished_at }
      await tx.query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.canceled', jsonb_build_object('run_id', $2::text, 'finished_at', now()))`,
        [id, id]
      );
      // Pending approvals for a canceled run can never be decided — cancel them.
      await tx.query(
        `UPDATE approval_tasks SET status = 'canceled', decided_at = now()
         WHERE run_id = $1 AND status = 'pending'`,
        [id]
      );
      // DB-lead lease rows for this run are released with the run.
      await tx.query('DELETE FROM run_locks WHERE run_id = $1', [id]);

      // §3.3/D7: bill only when at least one step executed (started_at set).
      // Shared metering (usage_events + usage_daily + subscriptions, idempotent)
      // inside this run's terminal transaction.
      await recordBillingForTerminalRun(workspaceId, id, 'run.canceled', tx);
      return run;
    });

    if (!canceled) {
      return reply.code(404).send({ error: { code: ERROR_CODES.RUN_NOT_FOUND, message: 'Run not found or not cancelable' } });
    }

    // Post-commit best-effort cleanup: a queued BullMQ job for a canceled run
    // must not execute, and the per-workflow Redis lock is released. The job
    // processor also self-skips terminal runs, so failures here are harmless.
    if (canceled.job_id) {
      try {
        const job = await getRunQueue().getJob(canceled.job_id);
        await job?.remove();
      } catch {
        /* locked/active jobs self-skip on the terminal status */
      }
    }
    try {
      await releaseWorkflowLock(canceled.workflow_id);
    } catch {
      /* Redis outage — the lock expires by TTL */
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.RUN_CANCELED, 'run', id, {});
    return { data: { status: 'canceled' } };
  });

  // List approval tasks (pending)
  fastify.get('/approvals', { preHandler: approvalGate }, async (request) => {
    const result = await query(
      `SELECT a.id, a.run_id, a.step_id, a.step_path, a.prompt, a.status, a.created_at::text,
              a.timeout_at::text, a.decided_at::text, a.on_timeout,
              r.workflow_id, w.name as workflow_name
       FROM approval_tasks a
       JOIN runs r ON r.id = a.run_id
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.workspace_id = $1 AND a.status = 'pending'
       ORDER BY a.created_at DESC`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  // Decide an approval task (approve or reject) and resume the paused run.
  async function decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const workspaceId = request.auth!.workspaceId;

    const approvalRow = await query<{ run_id: string; status: string; step_path: string; timeout_at: string | null }>(
      `SELECT a.run_id, a.status, a.step_path, a.timeout_at
       FROM approval_tasks a
       JOIN runs r ON r.id = a.run_id
       WHERE a.id = $1 AND r.workspace_id = $2`,
      [id, workspaceId]
    );
    if (approvalRow.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Approval task not found' } });
    }
    if (approvalRow.rows[0].status !== 'pending') {
      return reply.code(409).send({ error: { code: ERROR_CODES.APPROVAL_ALREADY_DECIDED, message: 'Approval already decided' } });
    }
    // §9: an expired task (timeout_at < NOW()) must return 409 approval_already_decided
    if (approvalRow.rows[0].timeout_at && new Date(approvalRow.rows[0].timeout_at) < new Date()) {
      return reply.code(409).send({ error: { code: ERROR_CODES.APPROVAL_ALREADY_DECIDED, message: 'Approval task has expired' } });
    }

    const runResult = await query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [approvalRow.rows[0].run_id]);
    if (runResult.rows[0]?.status !== 'paused') {
      return reply.code(409).send({
        error: { code: ERROR_CODES.APPROVAL_ALREADY_DECIDED, message: `Run is not paused (status: ${runResult.rows[0]?.status ?? 'unknown'})` },
      });
    }

    await query(
      `UPDATE approval_tasks SET status = $1, decision = $1, decided_by = $2, decided_at = now()
       WHERE id = $3 AND status = 'pending'`,
      [decision, request.auth!.user.id, id]
    );

    const runId = approvalRow.rows[0].run_id;
    if (decision === 'rejected') {
      // §6.1: reject with on_error abort → canceled; continue → queued.
      // The step's on_error is recorded on the paused run_steps row at park time.
      const stepRow = await query<{ input: { on_error?: string } | null }>(
        `SELECT input FROM run_steps WHERE run_id = $1 AND step_path = $2 AND status = 'paused' ORDER BY started_at DESC LIMIT 1`,
        [runId, approvalRow.rows[0].step_path]
      );
      const onError = stepRow.rows[0]?.input?.on_error ?? 'abort';
      if (onError === 'continue') {
        // §9/§6.1: the rejected step is marked failed with the rejected
        // decision; the run resumes (queued) — on_error: continue means the
        // workflow proceeds past the rejected step.
        await query(
          `UPDATE run_steps SET status = 'failed', finished_at = now(),
             output = jsonb_set(COALESCE(output, '{}'::jsonb), '{decision}', '"rejected"')
           WHERE run_id = $1 AND step_path = $2 AND status = 'paused'`,
          [runId, approvalRow.rows[0].step_path]
        );
        await query(`UPDATE runs SET status = 'queued', resume_at = NULL WHERE id = $1`, [runId]);
        await enqueueRunJob(runId);
        await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.APPROVAL_REJECTED, 'approval', id, { run_id: runId });
        return { data: { status: 'queued' } };
      }
      // Reject with abort → canceled, mirroring the cancel endpoint's terminal
      // contract (§6.1/§7): run.canceled SSE event + the same transaction-scoped
      // metering as every other terminal transition (D7 — the run executed
      // steps before parking, so it IS billable; the shared helper skips runs
      // that never started, so this can never over-bill).
      await withTransaction(async (tx) => {
        await tx.query(
          `UPDATE runs SET status = 'canceled', finished_at = now(), resume_at = NULL, job_id = NULL WHERE id = $1`,
          [runId]
        );
        // §7 SSE shape for run.canceled: { run_id, finished_at }
        await tx.query(
          `INSERT INTO run_events (run_id, event_type, payload)
           VALUES ($1, 'run.canceled', jsonb_build_object('run_id', $2::text, 'finished_at', now()))`,
          [runId, runId]
        );
        await tx.query(
          `UPDATE run_steps SET status = 'failed', finished_at = now(),
             output = jsonb_set(COALESCE(output, '{}'::jsonb), '{decision}', '"rejected"')
           WHERE run_id = $1 AND step_path = $2 AND status = 'paused'`,
          [runId, approvalRow.rows[0].step_path]
        );
        await tx.query('DELETE FROM run_locks WHERE run_id = $1', [runId]);
        await recordBillingForTerminalRun(workspaceId, runId, 'run.canceled', tx);
      });
      await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.APPROVAL_REJECTED, 'approval', id, { run_id: runId });
      await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.RUN_CANCELED, 'run', runId, { reason: 'approval_rejected' });
      return { data: { status: 'canceled' } };
    }

    // §9: the approved step is marked succeeded with the approved decision,
    // and the run resumes (queued).
    await query(
      `UPDATE run_steps SET status = 'succeeded', finished_at = now(),
         output = jsonb_set(COALESCE(output, '{}'::jsonb), '{decision}', '"approved"')
       WHERE run_id = $1 AND step_path = $2 AND status = 'paused'`,
      [runId, approvalRow.rows[0].step_path]
    );
    await query(`UPDATE runs SET status = 'queued', resume_at = NULL WHERE id = $1`, [runId]);
    await enqueueRunJob(runId);
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.APPROVAL_APPROVED, 'approval', id, { run_id: runId });
    return { data: { status: 'queued' } };
  }

  fastify.post('/approvals/:id/approve', { preHandler: approvalGate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return decideApproval(id, 'approved', request, reply);
  });
  fastify.post('/approvals/:id/reject', { preHandler: approvalGate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return decideApproval(id, 'rejected', request, reply);
  });
  // Legacy combined endpoint (decision in body) — kept for CLI compatibility.
  fastify.post('/approvals/:id/decide', { preHandler: approvalGate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { decision } = request.body as { decision?: string };
    if (decision !== 'approved' && decision !== 'rejected') {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'decision must be approved or rejected' } });
    }
    return decideApproval(id, decision, request, reply);
  });

  // Approve every pending task for a run
  fastify.post('/runs/:id/approve-all', { preHandler: approvalGate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const runCheck = await query('SELECT id, status FROM runs WHERE id = $1 AND workspace_id = $2', [id, request.auth!.workspaceId]);
    if (runCheck.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.RUN_NOT_FOUND, message: 'Run not found' } });
    }
    const tasks = await query<{ id: string }>(
      `SELECT a.id FROM approval_tasks a WHERE a.run_id = $1 AND a.status = 'pending'`,
      [id]
    );
    for (const task of tasks.rows) {
      await query(
        `UPDATE approval_tasks SET status = 'approved', decision = 'approved', decided_by = $1, decided_at = now()
         WHERE id = $2`,
        [request.auth!.user.id, task.id]
      );
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.APPROVAL_APPROVED, 'approval', task.id, { run_id: id });
    }
    if (tasks.rows.length > 0 && runCheck.rows[0].status === 'paused') {
      await query(`UPDATE runs SET status = 'queued', resume_at = NULL WHERE id = $1`, [id]);
      await enqueueRunJob(id);
    }
    return { data: { approved_count: tasks.rows.length } };
  });

  // Trigger a run manually
  fastify.post('/workflows/:id/run', { preHandler: requireAuth }, async (request, reply) => {
    return manualTrigger(request, reply);
  });
  fastify.post('/workflows/:id/trigger', { preHandler: requireAuth }, async (request, reply) => {
    return manualTrigger(request, reply);
  });

  async function manualTrigger(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { inputs } = (request.body as { inputs?: Record<string, unknown> }) || {};
    const workspaceId = request.auth!.workspaceId;

    // Workflow must be enabled
    const wf = await query<{ is_enabled: boolean }>(
      'SELECT is_enabled FROM workflows WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );
    if (wf.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }
    if (!wf.rows[0].is_enabled) {
      return reply.code(403).send({ error: { code: ERROR_CODES.WORKFLOW_DISABLED, message: 'Workflow is disabled' } });
    }

    // 10-second bucket dedup (§9 manual run dedup)
    const inputsJson = JSON.stringify(inputs || {});
    const bucket = Math.floor(Date.now() / 10000);
    const dedupHash = createHash('sha256').update(`${workspaceId}:${id}:${inputsJson}:${bucket}`).digest('hex').slice(0, 32);
    const idempotencyKey = `manual:${dedupHash}`;

    // --- Admission control + run creation (§3.3, §6.5) ---
    // §3.3: Free-plan admission is one transaction that locks the workspace
    // and its active subscription before reading the counters, and creates
    // the run in the SAME transaction. Manual runs are rejected at the
    // cap/limit (429).
    type ManualTriggerTxResult =
      | { status: number; code: string; message: string }
      | { runId: string; deduplicated: boolean };
    const created = await withTransaction(async (tx): Promise<ManualTriggerTxResult> => {
      // Serialize concurrent admission for this workspace.
      const lockedWs = await tx.query<{ plan_id: string }>(
        'SELECT plan_id FROM workspaces WHERE id = $1 FOR UPDATE',
        [workspaceId]
      );
      const plan = getPlanDefinition(lockedWs.rows[0]?.plan_id ?? 'free');

      const activeCountResult = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM runs WHERE workspace_id = $1 AND status IN ${ACTIVE_STATUSES} AND concurrency_block = false`,
        [workspaceId]
      );
      const activeCount = activeCountResult.rows[0]?.n ?? 0;

      if (plan?.concurrency_limit !== null && plan?.concurrency_limit !== undefined && activeCount >= plan.concurrency_limit) {
        return { status: 429, code: ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED, message: 'Workspace concurrency limit reached' };
      }

      // §3.3: the HARD run cap applies only to plans without overage billing
      // (Free: 500/mo). Pro/Studio limits are soft thresholds — at 100%
      // overage billing activates and runs are still admitted. The
      // authoritative counter is subscriptions.runs_consumed on the active
      // subscription within the current billing period (current_period_start/
      // current_period_end), NOT a calendar-month COUNT(*) from usage_events.
      if (plan && hasHardRunCap(plan)) {
        const subResult = await tx.query<{ runs_consumed: number }>(
          `SELECT runs_consumed FROM subscriptions
           WHERE workspace_id = $1 AND status = 'active'
             AND now() >= current_period_start AND now() < current_period_end
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [workspaceId]
        );
        const runsConsumed = subResult.rows[0]?.runs_consumed ?? 0;
        if (runsConsumed + activeCount >= (plan.run_limit ?? 0)) {
          return { status: 429, code: ERROR_CODES.RUN_LIMIT_EXCEEDED, message: 'Free plan run limit reached (500/month)' };
        }
      }

      // Same-transaction dedup: the unique idempotency index is the backstop.
      const existingRun = await tx.query<{ id: string }>(
        'SELECT id FROM runs WHERE workspace_id = $1 AND idempotency_key = $2',
        [workspaceId, idempotencyKey]
      );
      if (existingRun.rows.length > 0) {
        return { runId: existingRun.rows[0].id, deduplicated: true };
      }

      // Current version pinned at creation; in-flight runs keep their version.
      const versionResult = await tx.query<{ version_id: string }>(
        `SELECT id as version_id FROM workflow_versions WHERE workflow_id = $1 AND is_current = true`,
        [id]
      );
      if (versionResult.rows.length === 0) {
        return { status: 404, code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow has no version' };
      }

      const timeoutHours = plan?.workflow_timeout_hours ?? 1;
      const runId = randomUUID();
      const timeoutAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

      await tx.query(
        `INSERT INTO runs (id, workspace_id, workflow_id, workflow_version_id, trigger_id, idempotency_key, state, timeout_at)
         VALUES ($1, $2, $3, $4, null, $5, $6, $7)`,
        [runId, workspaceId, id, versionResult.rows[0].version_id, idempotencyKey, JSON.stringify({ inputs: inputs || {} }), timeoutAt]
      );

      // §7 SSE shape for run.created: { run_id, workflow_id, trigger_type, inputs }
      await tx.query(
        `INSERT INTO run_events (run_id, event_type, payload) VALUES ($1, 'run.created', $2)`,
        [runId, JSON.stringify({ run_id: runId, workflow_id: id, trigger_type: 'manual', inputs: inputs || {} })]
      );

      return { runId, deduplicated: false };
    });

    if ('status' in created) {
      return reply.code(created.status).send({ error: { code: created.code, message: created.message } });
    }
    if (created.deduplicated) {
      // §9: duplicate within 10s bucket → 200 { run_id: <existing> }
      return { data: { run_id: created.runId } };
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.RUN_CREATED, 'run', created.runId, { workflow_id: id, trigger: 'manual' });
    await enqueueRunJob(created.runId);

    // §9: newly created manual run → 201 { run_id }
    return reply.code(201).send({ data: { run_id: created.runId } });
  }
}
