/**
 * Terminal-run metering (§3.3, §7, D7) — the single implementation shared by
 * every terminal transition that must bill: the run executor's
 * succeeded/failed paths, its crash path, the scheduler's approval-timeout
 * abort and recovery-exhaustion paths, and the cancel route.
 *
 * One billable unit per run that reached a terminal state having executed at
 * least one step (spec: "only if at least one step has executed — i.e.,
 * started_at IS NOT NULL"). Runs canceled from `queued` never start and are
 * never billed.
 *
 * The three writes run in one transaction; the usage_events unique index
 * (run_id, event_type) plus the RETURNING-id gate makes any re-invocation
 * (reconciliation re-bill, repeated terminal event) idempotent, so a run can
 * never be double-counted.
 */

import { query, withTransaction, type TxClient } from '../db/pool.js';

export async function recordBillingForTerminalRun(
  workspaceId: string,
  runId: string,
  eventType: 'run.succeeded' | 'run.failed' | 'run.canceled',
  tx?: TxClient
): Promise<void> {
  const q = tx ?? { query };
  const started = await q.query<{ started: boolean }>(
    `SELECT started_at IS NOT NULL AS started FROM runs WHERE id = $1`,
    [runId]
  );
  if (!(started.rows[0]?.started ?? false)) return;

  const stepCount = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM run_steps WHERE run_id = $1 AND status IN ('succeeded','failed')`,
    [runId]
  );
  const totalSteps = stepCount.rows[0]?.n ?? 0;

  const runWrites = async (client: TxClient): Promise<void> => {
    const ins = await client.query(
      `INSERT INTO usage_events (workspace_id, run_id, event_type)
       VALUES ($1, $2, $3) ON CONFLICT (run_id, event_type) DO NOTHING
       RETURNING id`,
      [workspaceId, runId, eventType]
    );
    if (ins.rows.length === 0) return; // already billed — never double-count

    // §7 usage_daily — daily aggregation (replaces the non-spec usage_counters).
    await client.query(
      `INSERT INTO usage_daily (workspace_id, date, run_count, total_steps)
       VALUES ($1, CURRENT_DATE, 1, $2)
       ON CONFLICT (workspace_id, date)
       DO UPDATE SET run_count = usage_daily.run_count + 1,
                     total_steps = usage_daily.total_steps + $2,
                     updated_at = now()`,
      [workspaceId, totalSteps]
    );
    // §3.3 — runs_consumed is maintained in the same terminal transition.
    // Only the active subscription within the current billing period is
    // incremented (a workspace has exactly one such row).
    await client.query(
      `UPDATE subscriptions SET runs_consumed = runs_consumed + 1, updated_at = now()
       WHERE workspace_id = $1 AND status = 'active'
         AND now() >= current_period_start AND now() < current_period_end`,
      [workspaceId]
    );
  };

  if (tx) {
    await runWrites(tx);
    return;
  }
  await withTransaction(runWrites);
}
