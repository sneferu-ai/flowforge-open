/**
 * Scheduler service (§6.3, D20) — single 10-second tick under the Redis lock
 * `ff:scheduler:tick`, handling:
 *   1. due schedule triggers → run creation + next_fire_at advance + BullMQ enqueue
 *   2. delay-resume (`runs.resume_at <= now()`) under `scheduler_lease` (§6.3)
 *   3. approval timeout check (pending tasks past timeout_at)
 *   4. reconciliation (§6.2): stale sweep, queue timeout, stuck-queued re-enqueue,
 *      concurrency promotion, lease + webhook-replay-log cleanup
 *
 * Runs are enqueued to the BullMQ `forge-run` queue (§4.2); the embedded
 * consumer (FF_WORKER_MODE=embedded) or the standalone worker executes them.
 */

import { query } from '../db/pool.js';
import { randomUUID } from 'node:crypto';
import { computeNextFire } from '../lib/cron.js';
import { getPlanDefinition } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS } from '@flowforge/shared';
import { hasHardRunCap } from '../auth/entitlements.js';
import {
  enqueueRunJob,
  getSharedRedis,
  SCHEDULER_TICK_LOCK_KEY,
  SCHEDULER_TICK_LOCK_TTL_MS,
} from './queue.js';
import { recordBillingForTerminalRun } from './billing.js';
import { dispatchDueSystemJobs } from './system-jobs.js';

const TICK_INTERVAL_MS = 10_000; // spec D20
const STALE_RUNNING_SQL_INTERVAL = "INTERVAL '90 seconds'"; // §6.2 stale sweep
const QUEUE_TIMEOUT_SQL_INTERVAL = "INTERVAL '24 hours'"; // §6.2 queue timeout
const LEASE_TTL_SQL_INTERVAL = "INTERVAL '5 minutes'"; // §6.3 lease expiry
const WEBHOOK_REPLAY_TTL_SQL_INTERVAL = "INTERVAL '10 minutes'"; // §6.4 replay window

export function schedulerLeaseKey(runId: string, resumeAtIso: string): string {
  return `${runId}:${resumeAtIso}`;
}

export function setupScheduler() {
  let running = true;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (!running) return;

    // Distribute the tick across concurrent processes (§6.3).
    const locked = await getSharedRedis()
      .set(SCHEDULER_TICK_LOCK_KEY, process.pid.toString(), 'PX', SCHEDULER_TICK_LOCK_TTL_MS, 'NX')
      .catch(() => null);
    if (!locked) {
      if (running) timer = setTimeout(tick, TICK_INTERVAL_MS);
      return;
    }

    try {
      // §7 — dispatch due system_jobs rows (billing_period_close +
      // retention_purge) to the forge-scheduler queue before the per-tick
      // loops; the fast interval jobs run on those loops directly.
      await dispatchDueSystemJobs();
      await fireDueTriggers();
      await resumeDelays();
      await checkApprovalTimeouts();
      await reconcile();
    } catch (err) {
      console.error('Scheduler error:', (err as Error).message);
    }
    if (running) {
      timer = setTimeout(tick, TICK_INTERVAL_MS);
    }
  }

  async function fireDueTriggers(): Promise<void> {
    const due = await query<{
      id: string;
      workflow_id: string;
      workspace_id: string;
      is_enabled: boolean;
      plan_id: string;
      next_fire_at: Date;
      config: { cron?: string; timezone?: string };
    }>(
      `SELECT t.id, t.workflow_id, w.workspace_id, w.is_enabled, ws.plan_id, t.next_fire_at, t.config
       FROM triggers t
       JOIN workflows w ON w.id = t.workflow_id
       JOIN workspaces ws ON ws.id = w.workspace_id
       WHERE t.type = 'schedule'
         AND t.is_enabled = true
         AND t.next_fire_at <= now()
       FOR UPDATE SKIP LOCKED
       LIMIT 20`
    );

    for (const trigger of due.rows) {
      if (!trigger.is_enabled) continue;

      // Idempotent run creation keyed on (workflow, trigger, next_fire_at) — spec §6.3.
      // Uses the trigger's actual next_fire_at, not a wall-clock minute truncation,
      // so distinct scheduled instants within the same minute are not silently deduped.
      const nextFireIso = trigger.next_fire_at.toISOString();
      const idempotencyKey = `sched:${trigger.workflow_id}:${trigger.id}:${nextFireIso}`;
      const versionResult = await query<{ id: string }>(
        'SELECT id FROM workflow_versions WHERE workflow_id = $1 AND is_current = true',
        [trigger.workflow_id]
      );
      if (versionResult.rows.length === 0) {
        await advanceTrigger(trigger.id, trigger.config.cron);
        continue;
      }

      const plan = getPlanDefinition(trigger.plan_id ?? 'free');

      // §3.3: runs_consumed is the authoritative counter on the active
      // subscription within the current billing period (current_period_start/
      // current_period_end), NOT a calendar-month COUNT(*) from usage_events.
      // Active count excludes concurrency-blocked runs (§6.5: blocked runs
      // are not active). The HARD cap applies only to plans without overage
      // billing (Free): Pro/Studio limits are soft thresholds where overage
      // billing activates at 100% and runs are still created.
      if (plan && hasHardRunCap(plan)) {
        const subResult = await query<{ runs_consumed: number }>(
          `SELECT runs_consumed FROM subscriptions
           WHERE workspace_id = $1 AND status = 'active'
             AND now() >= current_period_start AND now() < current_period_end
           ORDER BY created_at DESC LIMIT 1`,
          [trigger.workspace_id]
        );
        const runsConsumed = subResult.rows[0]?.runs_consumed ?? 0;
        const active = await query<{ n: number }>(
          `SELECT count(*)::int AS n FROM runs
           WHERE workspace_id = $1 AND status IN ('queued','running','waiting','paused')
             AND concurrency_block = false`,
          [trigger.workspace_id]
        );
        if (runsConsumed + (active.rows[0]?.n ?? 0) >= (plan.run_limit ?? 0)) {
          // At cap: no run created, next_fire_at advanced (§3.3).
          await advanceTrigger(trigger.id, trigger.config.cron);
          await emitAuditEvent(trigger.workspace_id, null, AUDIT_ACTIONS.RUN_LIMIT_EXCEEDED, 'trigger', trigger.id, { scheduled: true });
          continue;
        }
      }

      // Concurrency admission (§6.5): blocked runs sit at queued/job_id NULL
      // until the concurrency_retry sweep promotes them.
      const activeCountResult = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM runs
         WHERE workspace_id = $1 AND status IN ('queued','running','waiting','paused')
           AND concurrency_block = false`,
        [trigger.workspace_id]
      );
      const activeCount = activeCountResult.rows[0]?.n ?? 0;
      const blocked =
        plan?.concurrency_limit !== null &&
        plan?.concurrency_limit !== undefined &&
        activeCount >= plan.concurrency_limit;

      const timeoutHours = plan?.workflow_timeout_hours ?? 1;
      const runId = randomUUID();
      const inserted = await query<{ id: string }>(
        `INSERT INTO runs (id, workspace_id, workflow_id, workflow_version_id, trigger_id, idempotency_key, state, timeout_at, concurrency_block)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idempotency_key, workspace_id) DO NOTHING
         RETURNING id`,
        [
          runId,
          trigger.workspace_id,
          trigger.workflow_id,
          versionResult.rows[0].id,
          trigger.id,
          idempotencyKey,
          // §5.4.6 — run.scheduled_at is the trigger's fire instant.
          JSON.stringify({ inputs: {}, trigger: { type: 'schedule', payload: null, scheduled_at: nextFireIso } }),
          new Date(Date.now() + timeoutHours * 60 * 60 * 1000),
          blocked,
        ]
      );
      if (inserted.rows.length > 0) {
        // §7 SSE shape for run.created: { run_id, workflow_id, trigger_type, inputs }
        await query(
          `INSERT INTO run_events (run_id, event_type, payload) VALUES ($1, 'run.created', $2)`,
          [runId, JSON.stringify({ run_id: runId, workflow_id: trigger.workflow_id, trigger_type: 'schedule', inputs: {} })]
        );
        if (!blocked) {
          // Post-commit enqueue via BullMQ (§6.3); reconciliation re-enqueues
          // if this crashes before job_id lands.
          await enqueueRunJob(runId);
        }
      }
      await advanceTrigger(trigger.id, trigger.config.cron);
    }
  }

  async function advanceTrigger(triggerId: string, cron: string | undefined): Promise<void> {
    const next = computeNextFire(cron || '* * * * *');
    await query('UPDATE triggers SET next_fire_at = $1, updated_at = now() WHERE id = $2', [next, triggerId]);
  }

  async function resumeDelays(): Promise<void> {
    const waiting = await query<{ id: string; resume_at: Date }>(
      `SELECT id, resume_at FROM runs WHERE status = 'waiting' AND resume_at <= now()
       FOR UPDATE SKIP LOCKED LIMIT 50`
    );
    for (const row of waiting.rows) {
      // §6.3 — one lease per (run, resume instant): a second delay step in the
      // same run gets its own lease because resume_at differs. A worker crash
      // between lease insert and re-queue is repaired when the lease expires
      // (5 min) and the run reappears in this query.
      const leaseKey = schedulerLeaseKey(row.id, row.resume_at.toISOString());
      const leased = await query(
        `INSERT INTO scheduler_lease (key, expires_at)
         VALUES ($1, now() + ${LEASE_TTL_SQL_INTERVAL})
         ON CONFLICT (key) DO NOTHING
         RETURNING id`,
        [leaseKey]
      );
      if (leased.rows.length === 0) continue;
      await query(`UPDATE runs SET status = 'queued', resume_at = NULL WHERE id = $1 AND status = 'waiting'`, [row.id]);
      await enqueueRunJob(row.id);
    }
  }

  async function checkApprovalTimeouts(): Promise<void> {
    const timedOut = await query<{ id: string; run_id: string; step_id: string; step_path: string; on_timeout: string; workspace_id: string }>(
      `SELECT id, run_id, step_id, step_path, on_timeout, workspace_id FROM approval_tasks
       WHERE status = 'pending' AND timeout_at <= now()
       FOR UPDATE SKIP LOCKED LIMIT 100`
    );
    for (const task of timedOut.rows) {
      // §7 race handling: an approval decided between the SELECT and this
      // UPDATE leaves status != 'pending' — 0 rows affected, skip the task.
      const taskUpdate = await query(
        `UPDATE approval_tasks SET status = 'timeout', decided_at = now() WHERE id = $1 AND status = 'pending'`,
        [task.id]
      );
      if (taskUpdate.rowCount === 0) continue;
      // §7 approval_timeout_check — skip ⇒ step 'skipped', abort ⇒ step 'failed';
      // the resumed executor rewrites the row to its final state either way.
      const stepStatus = task.on_timeout === 'abort' ? 'failed' : 'skipped';
      await query(
        `UPDATE run_steps SET status = $1, finished_at = now(),
           output = jsonb_set(COALESCE(output, '{}'::jsonb), '{decision}', '"timeout"')
         WHERE run_id = $2 AND step_path = $3 AND status = 'paused'`,
        [stepStatus, task.run_id, task.step_path]
      );
      await emitAuditEvent(
        task.workspace_id,
        null,
        AUDIT_ACTIONS.APPROVAL_TIMEOUT,
        'approval',
        task.id,
        { run_id: task.run_id }
      );
      if (task.on_timeout === 'abort') {
        // Guard the run transition (decided/re-canceled between the SELECT
        // and this UPDATE ⇒ 0 rows, no event, no billing — §7 race handling).
        const failedRun = await query<{ total_running_seconds: number }>(
          `UPDATE runs SET status = 'failed', error = 'approval_timeout', finished_at = now()
           WHERE id = $1 AND status = 'paused' RETURNING total_running_seconds`,
          [task.run_id]
        );
        if (failedRun.rows.length === 0) continue;
        // §7 SSE shape for run.failed: { run_id, finished_at, reason, total_running_seconds }
        await query(
          `INSERT INTO run_events (run_id, event_type, payload)
           VALUES ($1, 'run.failed',
            jsonb_build_object('run_id', $4::text, 'finished_at', now(), 'reason', $2::text, 'total_running_seconds', $3::int))`,
          [task.run_id, 'approval_timeout', failedRun.rows[0]?.total_running_seconds ?? 0, task.run_id]
        );
        await recordBillingForTerminalRun(task.workspace_id, task.run_id, 'run.failed');
      } else {
        // on_timeout: skip → resume the run.
        const resumed = await query(`UPDATE runs SET status = 'queued', resume_at = NULL WHERE id = $1 AND status = 'paused' RETURNING id`, [task.run_id]);
        if (resumed.rows.length > 0) {
          await enqueueRunJob(task.run_id);
        }
      }
    }
  }

  async function reconcile(): Promise<void> {
    // §6.3 — lease expiry cleanup: a crashed tick's leases expire and the
    // associated waiting runs are reprocessed by resumeDelays().
    await query(`DELETE FROM scheduler_lease WHERE expires_at < now()`);

    // §6.4 — webhook replay window (10 minutes).
    await query(`DELETE FROM webhook_replay_log WHERE received_at < now() - ${WEBHOOK_REPLAY_TTL_SQL_INTERVAL}`);

    // §6.2 stale sweep
    const stale = await query<{ id: string; workspace_id: string; recovery_count: number }>(
      `UPDATE runs SET status = 'queued', job_id = NULL, recovery_count = recovery_count + 1
       WHERE status = 'running' AND heartbeat_at < now() - ${STALE_RUNNING_SQL_INTERVAL}
       RETURNING id, workspace_id, recovery_count`
    );
    for (const row of stale.rows) {
      if (row.recovery_count >= 3) {
        const failedRun = await query<{ total_running_seconds: number }>(
          `UPDATE runs SET status = 'failed', error = 'recovery_exhausted', finished_at = now(), job_id = NULL
           WHERE id = $1 RETURNING total_running_seconds`,
          [row.id]
        );
        // §7 SSE shape for run.failed: { run_id, finished_at, reason, total_running_seconds }
        await query(
          `INSERT INTO run_events (run_id, event_type, payload)
           VALUES ($1, 'run.failed',
            jsonb_build_object('run_id', $4::text, 'finished_at', now(), 'reason', $2::text, 'total_running_seconds', $3::int))`,
          [row.id, 'recovery_exhausted', failedRun.rows[0]?.total_running_seconds ?? 0, row.id]
        );
        await recordBillingForTerminalRun(row.workspace_id, row.id, 'run.failed');
        console.warn(`[scheduler] run ${row.id} failed: recovery_exhausted`);
      } else {
        await enqueueRunJob(row.id);
      }
    }

    // §6.2 stuck queued (crash before/after BullMQ enqueue, job lost)
    const stuck = await query<{ id: string }>(
      `SELECT id FROM runs WHERE status = 'queued' AND job_id IS NULL AND concurrency_block = false
       ORDER BY created_at LIMIT 50`
    );
    for (const row of stuck.rows) {
      await enqueueRunJob(row.id);
    }

    // §6.2 queue timeout (24h, fixed — not plan-configurable)
    const queueTimedOut = await query<{ id: string; total_running_seconds: number }>(
      `UPDATE runs SET status = 'failed', error = 'queue_timeout', finished_at = now(), job_id = NULL
       WHERE status = 'queued' AND created_at < now() - ${QUEUE_TIMEOUT_SQL_INTERVAL}
       RETURNING id, total_running_seconds`
    );
    for (const row of queueTimedOut.rows) {
      // §7 SSE shape for run.failed: { run_id, finished_at, reason, total_running_seconds }
      await query(
        `INSERT INTO run_events (run_id, event_type, payload)
         VALUES ($1, 'run.failed',
          jsonb_build_object('run_id', $4::text, 'finished_at', now(), 'reason', $2::text, 'total_running_seconds', $3::int))`,
        [row.id, 'queue_timeout', row.total_running_seconds ?? 0, row.id]
      );
    }

    // §6.3 concurrency_retry — the ONLY mechanism that unblocks concurrency-blocked runs.
    const blockedRuns = await query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id FROM runs
       WHERE status = 'queued' AND concurrency_block = true AND job_id IS NULL
       ORDER BY created_at LIMIT 100`
    );
    for (const row of blockedRuns.rows) {
      const wsPlan = await query<{ plan_id: string }>('SELECT plan_id FROM workspaces WHERE id = $1', [row.workspace_id]);
      const plan = getPlanDefinition(wsPlan.rows[0]?.plan_id ?? 'free');
      if (plan?.concurrency_limit === null || plan?.concurrency_limit === undefined) continue;
      const count = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM runs
         WHERE workspace_id = $1 AND status IN ('queued','running','waiting','paused')
           AND concurrency_block = false`,
        [row.workspace_id]
      );
      if ((count.rows[0]?.n ?? 0) < plan.concurrency_limit) {
        const promoted = await query(
          `UPDATE runs SET concurrency_block = false WHERE id = $1 AND concurrency_block = true AND job_id IS NULL RETURNING id`,
          [row.id]
        );
        if (promoted.rows.length > 0) {
          await enqueueRunJob(row.id);
        }
      }
    }
  }

  tick();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
