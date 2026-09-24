/**
 * §3.3 / §6.2 / §6.5 — webhook admission contract pins:
 *   1. Webhook run creation checks workspace concurrency limit → 429
 *      concurrency_limit_exceeded (§6.5, spec: "Webhook at limit: 429").
 *   2. Webhook run creation checks the Free-plan run cap using
 *      subscriptions.runs_consumed → 429 run_limit_exceeded (§3.3). The cap
 *      is HARD only for plans without overage billing; Pro/Studio soft
 *      thresholds activate overage and still admit.
 *   3. Free-plan admission is one transaction that locks the workspace and
 *      its active subscription and creates the run in the same transaction
 *      (§3.3).
 *   4. timeout_at uses plan.workflow_timeout_hours, not hard-coded 24h (§6.2).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'webhooks.ts'), 'utf-8');

/** The transactional admission block (lock → counts → rejections → insert). */
const admissionBlock = source.slice(
  source.indexOf('const admitted = await withTransaction'),
  source.indexOf('if (!admitted.ok)')
);

describe('§6.5 webhook concurrency limit admission', () => {
  it('checks concurrency limit before run creation', () => {
    expect(admissionBlock).toContain('CONCURRENCY_LIMIT_EXCEEDED');
    expect(admissionBlock).toContain('concurrency_limit');
    // Active count must exclude concurrency-blocked runs (§6.5)
    expect(admissionBlock).toContain('concurrency_block = false');
  });

  it('returns 429 at the concurrency limit', () => {
    expect(admissionBlock).toContain('status: 429');
    expect(admissionBlock).toContain('concurrency_limit_exceeded');
  });
});

describe('§3.3 webhook Free-plan run cap admission', () => {
  it('reads subscriptions.runs_consumed for the run cap', () => {
    expect(admissionBlock).toContain('SELECT runs_consumed FROM subscriptions');
    expect(admissionBlock).toContain('current_period_start');
    expect(admissionBlock).toContain('current_period_end');
  });

  it('returns 429 run_limit_exceeded at the cap', () => {
    expect(admissionBlock).toContain('RUN_LIMIT_EXCEEDED');
    expect(admissionBlock).toContain('status: 429');
  });

  it('does NOT use date_trunc or usage_events for admission', () => {
    expect(admissionBlock).not.toContain('date_trunc');
    // The admission SQL must not read usage_events (comments may name it as
    // the counter being replaced — check the SQL statements only).
    const sqlLines = admissionBlock
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && /SELECT|FROM|INSERT|UPDATE|count/i.test(trimmed);
      })
      .join('\n');
    expect(sqlLines).not.toContain('usage_events');
  });

  it('the cap is hard only without overage billing (Free), not bare run_limit', () => {
    // §3.3: Pro/Studio soft thresholds admit runs at >= 100% (overage
    // activates); a bare `run_limit` presence check would wrongly 429 them.
    expect(admissionBlock).toContain('hasHardRunCap(plan)');
    expect(admissionBlock).toContain('overage');
  });
});

describe('§3.3 webhook admission is transactional', () => {
  it('locks the workspace and the active subscription before reading counters', () => {
    expect(admissionBlock).toContain('SELECT plan_id FROM workspaces WHERE id = $1 FOR UPDATE');
    expect(admissionBlock).toContain('LIMIT 1\n           FOR UPDATE');
  });

  it('creates the run and its run.created event in the same transaction', () => {
    expect(admissionBlock).toContain('INSERT INTO runs');
    expect(admissionBlock).toContain("'run.created'");
    // Enqueue happens only after the transaction commits.
    expect(source.indexOf('await enqueueRunJob(runId)')).toBeGreaterThan(source.indexOf('if (!admitted.ok)'));
  });
});

describe('§6.2 webhook timeout_at uses plan workflow_timeout_hours', () => {
  it('reads workflow_timeout_hours from the plan definition', () => {
    expect(source).toContain('workflow_timeout_hours');
    expect(source).toContain('timeoutHours');
  });

  it('does NOT hard-code 24h timeout', () => {
    // The old code was: new Date(Date.now() + 24 * 60 * 60 * 1000)
    // This literal must be gone — replaced by the plan-driven calculation.
    expect(source).not.toContain('24 * 60 * 60 * 1000');
  });

  it('falls back to 1h when plan has no timeout (Free plan)', () => {
    // Free plan: workflow_timeout_hours = 1
    expect(source).toContain('?? 1');
  });
});
