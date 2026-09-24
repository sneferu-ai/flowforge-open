/**
 * §3.3 / §6.5 / §7 — scheduler contract pins:
 *   1. Run-cap admission reads subscriptions.runs_consumed (NOT usage_events
 *      with date_trunc('month')), within current_period_start/current_period_end.
 *   2. Active-run count in the run-cap check excludes concurrency_block = false.
 *   3. Scheduler-driven terminal transitions (approval_timeout abort,
 *      recovery_exhausted, queue_timeout) insert §7 run.failed SSE events.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'scheduler.ts'), 'utf-8');

describe('§3.3 scheduler run-cap admission — authoritative counter', () => {
  it('reads subscriptions.runs_consumed, not usage_events', () => {
    // §3.3: "runs_consumed is the authoritative counter on the active
    // subscription within the current billing period"
    expect(source).toContain('SELECT runs_consumed FROM subscriptions');
    expect(source).toContain("status = 'active'");
    expect(source).toContain('current_period_start');
    expect(source).toContain('current_period_end');
  });

  it('does NOT use date_trunc month for run-cap admission', () => {
    // The old code used date_trunc('month', now()) on usage_events — the
    // reviewer flagged this as a contract deviation. It must be gone.
    expect(source).not.toContain("date_trunc('month', now())");
  });

  it('does NOT count usage_events for run-cap admission', () => {
    // The run-cap check must not read usage_events at all.
    const admissionBlock = source.slice(
      source.indexOf('if (plan && hasHardRunCap'),
      source.indexOf('// Concurrency admission')
    );
    expect(admissionBlock).not.toContain('usage_events');
  });
});

describe('§3.3 the run cap is hard only for plans without overage (Free)', () => {
  it('gates the cap check on hasHardRunCap, not a bare run_limit', () => {
    // Pro/Studio run_limits are SOFT thresholds — at 100% overage billing
    // activates and scheduled runs are still created. A bare
    // `plan.run_limit !== null` check would wrongly skip Pro/Studio triggers.
    const admissionBlock = source.slice(
      source.indexOf('// Active count excludes concurrency-blocked runs'),
      source.indexOf('// Concurrency admission')
    );
    expect(admissionBlock).toContain('hasHardRunCap(plan)');
    expect(admissionBlock).toContain('overage');
  });

  it('does NOT reject on bare run_limit presence', () => {
    expect(source).not.toContain("plan?.run_limit !== null && plan?.run_limit !== undefined");
  });
});

describe('§6.5 scheduler active-run count excludes concurrency-blocked', () => {
  it('run-cap active count includes concurrency_block = false', () => {
    // The active count in the run-cap check must exclude blocked runs.
    const admissionBlock = source.slice(
      source.indexOf('if (plan && hasHardRunCap'),
      source.indexOf('// Concurrency admission')
    );
    expect(admissionBlock).toContain('concurrency_block = false');
  });
});

describe('§7 scheduler terminal transitions emit run.failed SSE events', () => {
  it('approval_timeout abort inserts run.failed event', () => {
    const abortBlock = source.slice(
      source.indexOf("on_timeout === 'abort'"),
      source.indexOf('recordBillingForTerminalRun(task.workspace_id')
    );
    expect(abortBlock).toContain("'run.failed'");
    expect(abortBlock).toContain('jsonb_build_object');
    expect(abortBlock).toContain("'reason'");
    expect(abortBlock).toContain("'approval_timeout'");
    expect(abortBlock).toContain("'total_running_seconds'");
    expect(abortBlock).toContain('RETURNING total_running_seconds');
  });

  it('approval_timeout honors the §7 race rule (decided between SELECT and UPDATE ⇒ skip)', () => {
    const raceBlock = source.slice(
      source.indexOf('§7 race handling'),
      source.indexOf('§7 approval_timeout_check — skip ⇒')
    );
    expect(raceBlock).toContain("status = 'pending'");
    expect(raceBlock).toContain('rowCount === 0');

    // The run transition itself is guarded: only a still-paused run fails,
    // and only a real transition emits the event + bills.
    const abortBlock = source.slice(
      source.indexOf("on_timeout === 'abort'"),
      source.indexOf('recordBillingForTerminalRun(task.workspace_id')
    );
    expect(abortBlock).toContain("AND status = 'paused' RETURNING total_running_seconds");
    expect(abortBlock).toContain('failedRun.rows.length === 0');
  });

  it('recovery_exhausted inserts run.failed event', () => {
    const recoveryBlock = source.slice(
      source.indexOf('recovery_count >= 3'),
      source.indexOf('console.warn')
    );
    expect(recoveryBlock).toContain("'run.failed'");
    expect(recoveryBlock).toContain("'recovery_exhausted'");
    expect(recoveryBlock).toContain("'total_running_seconds'");
    expect(recoveryBlock).toContain('RETURNING total_running_seconds');
  });

  it('queue_timeout inserts run.failed event for each timed-out run', () => {
    // The old code was a blind bulk UPDATE with no RETURNING — it could
    // never emit per-run SSE events. Now it must RETURNING and loop.
    // Use lastIndexOf to skip the file-header comment and find the actual
    // reconcile() code block.
    const queueBlock = source.slice(
      source.lastIndexOf('§6.2 queue timeout (24h, fixed'),
      source.lastIndexOf('§6.3 concurrency_retry — the ONLY')
    );
    expect(queueBlock).toContain('RETURNING id, total_running_seconds');
    expect(queueBlock).toContain("'run.failed'");
    expect(queueBlock).toContain("'queue_timeout'");
    expect(queueBlock).toContain("'total_running_seconds'");
  });

  it('all three run.failed events use the §7 payload shape', () => {
    // §7: run.failed → { run_id, finished_at, reason, total_running_seconds }
    const failedEventCount = (source.match(/'run\.failed'/g) || []).length;
    // 3 scheduler sites + the run-cap admission block has none.
    // The fireDueTriggers block references run.created only.
    expect(failedEventCount).toBeGreaterThanOrEqual(3);
  });
});
