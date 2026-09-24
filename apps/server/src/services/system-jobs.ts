/**
 * System jobs (§7) — the `system_jobs` table is the schedule of record for
 * the two interval-scale jobs that no per-tick loop already covers:
 *
 *   - `billing_period_close` — 1st of month 00:00 UTC: invoices each active
 *     subscription whose billing period just ended (plan_base_cents +
 *     overage_runs * overage_rate_cents), then rolls the subscription to the
 *     next 30-day period with runs_consumed = 0 (§3.3, §7, scenario 25/28).
 *   - `retention_purge` — daily 02:00 UTC: deletes audit_events older than the
 *     workspace plan's audit_retention_days, runs(+cascade) older than
 *     run_history_days, notifications older than 30 days, and aggregates
 *     usage_daily from usage_events (§7 retention, scenario 29).
 *
 * The five fast jobs (approval_timeout_check, concurrency_retry,
 * replay_log_cleanup, reconciliation, notification_dispatch) run on their own
 * per-tick loops (scheduler tick + notification processor) and never travel
 * through this queue.
 *
 * Execution mechanism (§7): the scheduler tick selects due rows and dispatches
 * them to the `forge-scheduler` BullMQ queue. BullMQ `jobId` = job_type dedups
 * re-dispatches of the same interval while a job is in flight. The worker
 * consumer executes the job; on success it sets `last_run_at` and advances
 * `next_run_at`. A failing job retries 3 times with a 30s backoff; a
 * still-failing job advances `next_run_at` anyway and emits the
 * `system_job.failed` audit event — it fires again at the next interval.
 *
 * A crash between execution and bookkeeping re-dispatches the same interval on
 * the next tick; every handler is idempotent (invoice insert is
 * ON CONFLICT DO NOTHING, deletes and aggregates are naturally re-runnable).
 */

import { Worker, type Job } from 'bullmq';
import { query } from '../db/pool.js';
import { getPlanDefinition, AUDIT_ACTIONS, type PlanDefinition } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { QUEUE_SCHEDULER, bullQueueOpts, getSystemJobQueue } from './queue.js';

/** Job types dispatched through the forge-scheduler queue. */
export const ROUTED_SYSTEM_JOB_TYPES = ['billing_period_close', 'retention_purge'] as const;
export type RoutedSystemJobType = (typeof ROUTED_SYSTEM_JOB_TYPES)[number];

/** §7 retry contract: up to 3 BullMQ retries with a fixed 30s backoff. */
export const SYSTEM_JOB_ATTEMPTS = 4;
export const SYSTEM_JOB_BACKOFF_MS = 30_000;

/**
 * §3.3/§7 — invoice arithmetic for one closed billing period.
 * `overage_runs` exists only on soft-threshold plans (overage_rate_cents > 0):
 * runs beyond the included `run_limit` bill at the overage rate. Hard-cap
 * (Free) and unlimited (Community/Demo) plans can never have overage.
 */
export function computeInvoiceClose(
  plan: PlanDefinition,
  runsConsumed: number
): { plan_base_cents: number; overage_runs: number; overage_cents: number; total_cents: number } {
  const plan_base_cents = plan.price_cents;
  const soft = plan.run_limit !== null && (plan.overage_rate_cents ?? 0) > 0;
  const limit = plan.run_limit ?? 0;
  const overage_runs = soft ? Math.max(0, runsConsumed - limit) : 0;
  const overage_cents = overage_runs * (plan.overage_rate_cents ?? 0);
  return { plan_base_cents, overage_runs, overage_cents, total_cents: plan_base_cents + overage_cents };
}

/**
 * §7 schedule advancement:
 *   billing_period_close → 1st of the next month, 00:00 UTC
 *   retention_purge      → next day, 02:00 UTC
 */
export function nextRunAtFor(jobType: string, from: Date = new Date()): Date {
  if (jobType === 'billing_period_close') {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }
  if (jobType === 'retention_purge') {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 2, 0, 0, 0));
  }
  // Unknown/fast job types: keep the row from re-selecting every tick.
  return new Date(from.getTime() + 60_000);
}

/**
 * Scheduler-tick side (§7) — select due rows and dispatch each routed type to
 * the forge-scheduler queue. `next_run_at` is left untouched here: the worker
 * advances it after success (or after retry exhaustion), and until then the
 * jobId dedup makes repeated add() calls no-ops. A queue-plane outage leaves
 * the row due, so the next tick re-attempts the dispatch.
 */
export async function dispatchDueSystemJobs(): Promise<number> {
  const due = await query<{ job_type: string }>(
    `SELECT job_type FROM system_jobs
     WHERE next_run_at <= now()
     FOR UPDATE SKIP LOCKED
     LIMIT 20`
  );
  let dispatched = 0;
  for (const row of due.rows) {
    if (!(ROUTED_SYSTEM_JOB_TYPES as readonly string[]).includes(row.job_type)) continue;
    await getSystemJobQueue()
      .add(
        row.job_type,
        { job_type: row.job_type },
        {
          jobId: row.job_type,
          attempts: SYSTEM_JOB_ATTEMPTS,
          backoff: { type: 'fixed', delay: SYSTEM_JOB_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: false,
        }
      )
      .catch((err: Error) => {
        console.error(`[system-jobs] dispatch failed for ${row.job_type}: ${err.message}`);
      });
    dispatched += 1;
  }
  return dispatched;
}

/** §7 — billing_period_close body. Idempotent: invoice insert is
 *  ON CONFLICT DO NOTHING and the period roll only lands once per period. */
export async function runBillingPeriodClose(): Promise<{ closed: number; rollovers: number }> {
  const ended = await query<{
    id: string;
    workspace_id: string;
    plan_id: string;
    period_start: Date;
    period_end: Date;
    runs_consumed: number;
  }>(
    `SELECT id, workspace_id, plan_id, current_period_start::date AS period_start,
            current_period_end::date AS period_end, runs_consumed
     FROM subscriptions
     WHERE status = 'active' AND current_period_end <= now()`
  );

  let closed = 0;
  let rollovers = 0;
  for (const sub of ended.rows) {
    const plan = getPlanDefinition(sub.plan_id);
    if (!plan) continue;
    const invoice = computeInvoiceClose(plan, sub.runs_consumed);
    const inserted = await query(
      `INSERT INTO invoices (workspace_id, period_start, period_end, plan_base_cents, overage_runs, overage_cents, total_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
       ON CONFLICT (workspace_id, period_start, period_end) DO NOTHING
       RETURNING id`,
      [
        sub.workspace_id,
        sub.period_start,
        sub.period_end,
        invoice.plan_base_cents,
        invoice.overage_runs,
        invoice.overage_cents,
        invoice.total_cents,
      ]
    );
    if (inserted.rows.length > 0) closed += 1;

    // §3.3 — period rollover resets runs_consumed. Guarded by the still-ended
    // period so a re-dispatch of the same interval can never double-roll.
    const rolled = await query(
      `UPDATE subscriptions
       SET current_period_start = current_period_end,
           current_period_end = current_period_end + INTERVAL '30 days',
           runs_consumed = 0,
           updated_at = now()
       WHERE id = $1 AND current_period_end <= now()`,
      [sub.id]
    );
    if ((rolled.rowCount ?? 0) > 0) rollovers += 1;
  }
  return { closed, rollovers };
}

/**
 * §7 — retention_purge complete behavior:
 *   1. audit_events older than the workspace plan's audit_retention_days
 *   2. runs older than run_history_days (run_steps/run_events/approval_tasks
 *      cascade; usage_events are NOT deleted — billing history is permanent)
 *   3. notifications older than 30 days
 *   4. usage_daily aggregation from usage_events (recomputed, idempotent)
 * The audit chain is then reported as truncated by GET /audit/verify, which
 * anchors on the oldest retained event (§7/§8.5).
 */
export async function runRetentionPurge(): Promise<{
  auditPurged: number;
  runsPurged: number;
  notificationsPurged: number;
  usageRowsAggregated: number;
}> {
  // 1. Audit retention — per workspace, driven by its plan's audit_retention_days.
  let auditPurged = 0;
  const auditPlans = await query<{ workspace_id: string; audit_retention_days: number }>(
    `SELECT DISTINCT w.id AS workspace_id, p.audit_retention_days
     FROM workspaces w
     JOIN plans p ON p.id = w.plan_id
     WHERE p.audit_retention_days IS NOT NULL`
  );
  for (const row of auditPlans.rows) {
    const deleted = await query(
      `DELETE FROM audit_events
       WHERE workspace_id = $1 AND created_at < now() - ($2 || ' days')::interval`,
      [row.workspace_id, String(row.audit_retention_days)]
    );
    auditPurged += deleted.rowCount ?? 0;
  }

  // 2. Run history retention — runs older than run_history_days per plan.
  let runsPurged = 0;
  const runPlans = await query<{ workspace_id: string; run_history_days: number }>(
    `SELECT DISTINCT w.id AS workspace_id, p.run_history_days
     FROM workspaces w
     JOIN plans p ON p.id = w.plan_id
     WHERE p.run_history_days IS NOT NULL`
  );
  for (const row of runPlans.rows) {
    const deleted = await query(
      `DELETE FROM runs
       WHERE workspace_id = $1 AND created_at < now() - ($2 || ' days')::interval`,
      [row.workspace_id, String(row.run_history_days)]
    );
    runsPurged += deleted.rowCount ?? 0;
  }

  // 3. Notifications — 30 days regardless of plan (§7).
  const notifResult = await query(`DELETE FROM notifications WHERE created_at < now() - INTERVAL '30 days'`);
  const notificationsPurged = notifResult.rowCount ?? 0;

  // 4. usage_daily aggregation (recomputed, so repeated runs stay stable).
  const aggregated = await query(
    `INSERT INTO usage_daily (workspace_id, date, run_count, total_steps)
     SELECT workspace_id, DATE(recorded_at)::date, COUNT(DISTINCT run_id)::int, COUNT(*)::int
     FROM usage_events
     GROUP BY workspace_id, DATE(recorded_at)
     ON CONFLICT (workspace_id, date)
     DO UPDATE SET run_count = EXCLUDED.run_count,
                   total_steps = EXCLUDED.total_steps,
                   updated_at = now()`
  );

  return {
    auditPurged,
    runsPurged,
    notificationsPurged,
    usageRowsAggregated: aggregated.rowCount ?? 0,
  };
}

/** Advance next_run_at + last_run_at after a successful job execution (§7). */
async function markSystemJobCompleted(jobType: string): Promise<void> {
  await query('UPDATE system_jobs SET last_run_at = now(), next_run_at = $2 WHERE job_type = $1', [
    jobType,
    nextRunAtFor(jobType),
  ]);
}

export interface SystemJobConsumerHandle {
  close(): Promise<void>;
}

/**
 * Embedded/standalone consumer for the forge-scheduler queue (§7). Shared by
 * the embedded server and the standalone worker so both modes execute system
 * jobs identically.
 */
export function startSystemJobConsumer(): SystemJobConsumerHandle {
  const worker = new Worker(
    QUEUE_SCHEDULER,
    async (job: Job) => {
      const { job_type } = (job.data ?? {}) as { job_type?: string };
      if (!job_type || !(ROUTED_SYSTEM_JOB_TYPES as readonly string[]).includes(job_type)) {
        console.warn(`[system-jobs] unknown job_type ${job_type} — discarding`);
        return { job_type, skipped: 'unknown_job_type' };
      }
      if (job_type === 'billing_period_close') {
        const result = await runBillingPeriodClose();
        console.log(
          `[system-jobs] billing_period_close → ${result.closed} invoice(s), ${result.rollovers} rollover(s)`
        );
        await markSystemJobCompleted(job_type);
        return { job_type, ...result };
      }
      const result = await runRetentionPurge();
      console.log(
        `[system-jobs] retention_purge → ${result.auditPurged} audit, ${result.runsPurged} runs, ` +
          `${result.notificationsPurged} notifications, ${result.usageRowsAggregated} usage rows`
      );
      await markSystemJobCompleted(job_type);
      return { job_type, ...result };
    },
    {
      ...bullQueueOpts(),
      concurrency: 1,
    }
  );

  worker.on('failed', async (job, err) => {
    const jobType = (job?.data as { job_type?: string } | undefined)?.job_type ?? 'unknown';
    // §7 — after retry exhaustion, advance to the next scheduled time and
    // audit the failure; the job will fire again at the next interval.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await query('UPDATE system_jobs SET next_run_at = $2, last_run_at = now() WHERE job_type = $1', [
        jobType,
        nextRunAtFor(jobType),
      ]).catch(() => {});
      const ws = await query<{ id: string }>('SELECT id FROM workspaces ORDER BY created_at LIMIT 1').catch(() => ({
        rows: [] as { id: string }[],
      }));
      const anchor = ws.rows[0]?.id ?? null;
      if (anchor) {
        await emitAuditEvent(anchor, null, AUDIT_ACTIONS.SYSTEM_JOB_FAILED, 'system_job', jobType, {
          error: err.message.slice(0, 500),
        }).catch(() => {});
      }
      console.error(`[system-jobs] ${jobType} failed permanently: ${err.message}`);
    } else if (job) {
      console.warn(`[system-jobs] ${jobType} attempt ${job.attemptsMade} failed: ${err.message}`);
    }
  });

  console.log(`[system-jobs] consumer started on ${QUEUE_SCHEDULER}`);
  return {
    async close() {
      await worker.close();
    },
  };
}
