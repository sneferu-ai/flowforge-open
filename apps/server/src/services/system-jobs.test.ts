/**
 * §7 system jobs — hermetic contract pins + pure-logic tests for
 * billing_period_close and retention_purge.
 *
 * The DB-backed handlers are exercised end-to-end by the live runtime proof
 * (a due subscription produces an open invoice + rollover; a purged audit
 * chain verifies as truncated). These tests pin the arithmetic, the
 * schedule, and the exact SQL contracts so a refactor cannot silently drift.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_DEFINITIONS, PLAN_IDS, type PlanDefinition } from '@flowforge/shared';
import { computeInvoiceClose, nextRunAtFor } from './system-jobs.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'system-jobs.ts'), 'utf-8');

function plan(id: string): PlanDefinition {
  const p = PLAN_DEFINITIONS.find((x) => x.id === id);
  if (!p) throw new Error(`plan ${id} missing`);
  return p;
}

describe('computeInvoiceClose — §3.3/§7 invoice arithmetic', () => {
  it('Free (hard cap, no overage billing) always invoices zero overage', () => {
    const f = plan(PLAN_IDS.FREE);
    const atLimit = computeInvoiceClose(f, 5000);
    expect(atLimit).toEqual({ plan_base_cents: 0, overage_runs: 0, overage_cents: 0, total_cents: 0 });
  });

  it('Pro (soft threshold) bills each run beyond the limit at 3 cents', () => {
    const pro = plan(PLAN_IDS.PRO);
    expect(pro.overage_rate_cents).toBe(3);
    expect(computeInvoiceClose(pro, 10_000)).toEqual({
      plan_base_cents: 2900,
      overage_runs: 0,
      overage_cents: 0,
      total_cents: 2900,
    });
    expect(computeInvoiceClose(pro, 10_500)).toEqual({
      plan_base_cents: 2900,
      overage_runs: 500,
      overage_cents: 1500,
      total_cents: 4400,
    });
  });

  it('Studio bills overage at 15 cents/run (spec §3.3 cents column)', () => {
    const studio = plan(PLAN_IDS.STUDIO);
    expect(studio.overage_rate_cents).toBe(15);
    expect(computeInvoiceClose(studio, 51_000)).toEqual({
      plan_base_cents: 9900,
      overage_runs: 1000,
      overage_cents: 15_000,
      total_cents: 24_900,
    });
  });

  it('Community and Demo (unlimited) can never produce overage', () => {
    for (const id of [PLAN_IDS.COMMUNITY, PLAN_IDS.DEMO]) {
      const p = plan(id);
      expect(computeInvoiceClose(p, 1_000_000).overage_runs).toBe(0);
      expect(computeInvoiceClose(p, 1_000_000).total_cents).toBe(p.price_cents);
    }
  });
});

describe('nextRunAtFor — §7 schedule', () => {
  it('billing_period_close targets the 1st of the NEXT month at 00:00 UTC', () => {
    const from = new Date(Date.UTC(2026, 6, 15, 12, 30));
    expect(nextRunAtFor('billing_period_close', from).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    const fromDec = new Date(Date.UTC(2026, 11, 31, 23, 59));
    expect(nextRunAtFor('billing_period_close', fromDec).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('retention_purge targets the next day at 02:00 UTC', () => {
    const from = new Date(Date.UTC(2026, 6, 15, 1, 0));
    expect(nextRunAtFor('retention_purge', from).toISOString()).toBe('2026-07-16T02:00:00.000Z');
    const fromLate = new Date(Date.UTC(2026, 6, 15, 23, 0));
    expect(nextRunAtFor('retention_purge', fromLate).toISOString()).toBe('2026-07-16T02:00:00.000Z');
  });
});

describe('dispatch contract (§7 mechanism)', () => {
  it('selects due rows from system_jobs with next_run_at <= now()', () => {
    expect(source).toContain('FROM system_jobs');
    expect(source).toContain('next_run_at <= now()');
  });

  it('adds to the forge-scheduler queue with jobId = job_type (in-flight dedup)', () => {
    expect(source).toContain('QUEUE_SCHEDULER');
    expect(source).toContain('jobId: row.job_type');
  });

  it('retries 3 times with 30s backoff (§7)', () => {
    expect(source).toContain('SYSTEM_JOB_ATTEMPTS = 4');
    expect(source).toContain('SYSTEM_JOB_BACKOFF_MS = 30_000');
  });

  it('only the two routed types travel through the queue', () => {
    expect(source).toContain("'billing_period_close', 'retention_purge'");
  });

  it('advances the schedule and records last_run_at only after execution', () => {
    expect(source).toContain('markSystemJobCompleted');
    expect(source).toContain('last_run_at = now()');
  });

  it('never writes updated_at to system_jobs (the column does not exist)', () => {
    // Live-probed on the first dispatch: `column "updated_at" of relation
    // "system_jobs" does not exist`. The bookkeeping queries must touch only
    // next_run_at / last_run_at.
    const mark = source.slice(source.indexOf('markSystemJobCompleted'));
    expect(mark).toContain('UPDATE system_jobs SET last_run_at = now(), next_run_at = $2 WHERE job_type');
    expect(mark).not.toContain('updated_at = now(), next_run_at');
    const failAdvance = source.slice(source.indexOf('attemptsMade >='));
    expect(failAdvance).toContain('UPDATE system_jobs SET next_run_at = $2, last_run_at = now() WHERE job_type');
  });

  it('a non-routed job type is discarded by the consumer, not executed', () => {
    expect(source).toContain('unknown_job_type');
  });
});

describe('billing_period_close body contracts', () => {
  it('inserts invoices with ON CONFLICT DO NOTHING on the period window key', () => {
    expect(source).toContain('ON CONFLICT (workspace_id, period_start, period_end) DO NOTHING');
  });

  it('closes only active subscriptions whose period has ended', () => {
    expect(source).toContain("status = 'active' AND current_period_end <= now()");
  });

  it('rolls the period by 30 days and resets runs_consumed (§3.3)', () => {
    expect(source).toContain("INTERVAL '30 days'");
    expect(source).toContain('runs_consumed = 0');
    expect(source).toContain('current_period_start = current_period_end');
  });

  it('the rollover is re-entry guarded by the still-ended period', () => {
    expect(source).toContain('WHERE id = $1 AND current_period_end <= now()');
  });
});

describe('retention_purge body contracts (§7 complete behavior)', () => {
  it('deletes audit_events per workspace plan audit_retention_days', () => {
    expect(source).toContain('audit_retention_days');
    expect(source).toContain('DELETE FROM audit_events');
  });

  it('deletes runs per workspace plan run_history_days (cascades cover the rest)', () => {
    expect(source).toContain('run_history_days');
    expect(source).toContain('DELETE FROM runs');
  });

  it('deletes notifications older than 30 days regardless of plan', () => {
    expect(source).toContain("DELETE FROM notifications WHERE created_at < now() - INTERVAL '30 days'");
  });

  it('never deletes usage_events — billing history is permanent', () => {
    expect(source).not.toContain('DELETE FROM usage_events');
  });

  it('aggregates usage_daily from usage_events as a recompute (idempotent)', () => {
    expect(source).toContain('INSERT INTO usage_daily');
    expect(source).toContain('COUNT(DISTINCT run_id)');
    expect(source).toContain('ON CONFLICT (workspace_id, date)');
    expect(source).toContain('total_steps = EXCLUDED.total_steps');
  });
});
