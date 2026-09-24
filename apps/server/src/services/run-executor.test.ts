/**
 * Source-pin tests for run-executor step-level SSE events (§7), redirect
 * per-hop egress routing (§6.4/§8.8), and attempt incrementing (§6.2).
 *
 * These are structural source pins — the same pattern as queue.test.ts —
 * because the run executor requires a live Postgres + Redis + BullMQ stack
 * to exercise end-to-end. The pins keep the contracts from regressing between
 * e2e runs.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'run-executor.ts'), 'utf-8');

describe('§7 step-level SSE events emitted in run-executor', () => {
  const stepEvents: Array<{ type: string; fields: string[] }> = [
    { type: 'step.started', fields: ['run_id', 'step_path', 'step_id', 'attempt', 'input'] },
    { type: 'step.succeeded', fields: ['run_id', 'step_path', 'output'] },
    { type: 'step.failed', fields: ['run_id', 'step_path', 'error'] },
    { type: 'step.skipped', fields: ['run_id', 'step_path'] },
    { type: 'step.waiting', fields: ['run_id', 'step_path', 'resume_at'] },
    { type: 'step.paused', fields: ['run_id', 'step_path', 'prompt', 'approval_task_id'] },
  ];

  for (const { type, fields } of stepEvents) {
    it(`emits '${type}' event into run_events`, () => {
      expect(source).toContain(`'${type}'`);
    });

    it(`'${type}' payload includes fields: ${fields.join(', ')}`, () => {
      // Each event's JSON.stringify payload must contain every required field.
      // We find the INSERT block for this event type and check the payload
      // object includes all required keys.
      const eventIdx = source.indexOf(`'${type}'`);
      expect(eventIdx).toBeGreaterThan(-1);
      // Grab a window around the event insertion to inspect the payload.
      const window = source.slice(eventIdx, eventIdx + 400);
      for (const field of fields) {
        expect(window).toContain(field);
      }
    });
  }

  it('emits step.skipped from BOTH the if:false skip path and the executeStepRecord completed-skipped path', () => {
    // The if:false path is in executeSteps; the completed-skipped path is in
    // executeStepRecord. Both must emit step.skipped.
    const firstIdx = source.indexOf("'step.skipped'");
    expect(firstIdx).toBeGreaterThan(-1);
    const secondIdx = source.indexOf("'step.skipped'", firstIdx + 1);
    expect(secondIdx).toBeGreaterThan(-1);
  });
});

describe('§6.4/§8.8 redirect per-hop egress routing', () => {
  it('uses redirectRoute (not the original first-hop route) for the connector decision', () => {
    // The redirect handler must check redirectRoute === 'connector', not
    // route === 'connector'. Using the original route bypasses the per-hop
    // egress classification.
    expect(source).toContain("redirectRoute === 'connector'");
  });

  it('does not use the original route variable in the redirect connector block', () => {
    // Find the redirect block and verify it doesn't contain `route === 'connector'`
    // (the bug was checking the first-hop route for a subsequent hop).
    const redirectIdx = source.indexOf('redirectRoute = await checkEgressRoute');
    expect(redirectIdx).toBeGreaterThan(-1);
    const redirectBlock = source.slice(redirectIdx, redirectIdx + 500);
    expect(redirectBlock).not.toContain("route === 'connector'");
  });

  it('authenticates every connector hop with the engine token (§8.8 token injection)', () => {
    // Every hop to the connector — first hop and redirect hops — must carry
    // `Authorization: Bearer <FF_CONNECTOR_TOKEN>`. The previous code dropped
    // the token whenever the manifest set its own Authorization.
    expect(source).toContain('const connectorToken = process.env.FF_CONNECTOR_TOKEN');
    expect(source).toContain("fetchHeaders['Authorization'] = `Bearer ${connectorToken}`");
    expect(source).toContain("Authorization: `Bearer ${connectorToken}`");
  });

  it('forwards a manifest Authorization as X-Target-Authorization on connector hops', () => {
    // (§8.8) "the manifest's Authorization value is sent as X-Target-Authorization
    // instead" — never as the Authorization the connector authenticates with.
    expect(source).toContain('manifestAuthorization');
    expect(source).toContain("fetchHeaders['X-Target-Authorization'] = manifestTargetAuthorization ?? manifestAuthorization");
    expect(source).toContain("hopHeaders['X-Target-Authorization'] = manifestTargetAuthorization ?? manifestAuthorization");
  });

  it('never leaks connector credentials to direct redirect targets', () => {
    // A direct redirect hop must rebuild from the manifest's original headers —
    // spreading the first hop's connector-mutated fetchHeaders would leak
    // X-Target-URL and the engine token to the target (the fetchHeaders spread
    // is only valid for the initial first hop).
    expect(source).toContain("currentHeaders = { ...headers, 'X-Idempotency-Key': idempotencyKey }");
    const redirectIdx = source.indexOf('redirectRoute === \'connector\'');
    const redirectBlock = source.slice(redirectIdx, redirectIdx + 700);
    expect(redirectBlock).not.toContain('{ ...fetchHeaders');
  });

  it('does not mutate the manifest header object between hops', () => {
    // The manifest auth must survive to later hops and retry attempts; the
    // previous code deleted headers.Authorization mid-flight.
    expect(source).not.toContain('delete headers.Authorization');
    expect(source).not.toContain("delete fetchHeaders['Authorization']");
  });
});

describe('§6.2 attempt incrementing on retry / crash recovery', () => {
  it('executeStepRecord increments attempt for terminal-status existing rows', () => {
    // The retry/crash-recovery path must compute prev.attempt + 1, not hardcode 1.
    expect(source).toContain('prev.attempt + 1');
  });

  it('executeStepRecord selects attempt from the existing row', () => {
    // The SELECT must include the attempt column so it can be incremented.
    expect(source).toContain('SELECT id, status, attempt FROM run_steps');
  });

  it('insertStepRecord computes nextAttempt from MAX(attempt), not a hardcoded 1', () => {
    // The skip-path insert must also compute the attempt dynamically.
    expect(source).toContain('COALESCE(MAX(attempt), 0)');
    expect(source).toContain('nextAttempt');
    // The old hardcoded ", 1)" in the VALUES clause for insertStepRecord must
    // be gone — the attempt is now a parameter ($8).
    const insertIdx = source.indexOf('ON CONFLICT (run_id, step_path, attempt) DO NOTHING');
    expect(insertIdx).toBeGreaterThan(-1);
    const insertBlock = source.slice(insertIdx - 200, insertIdx + 50);
    expect(insertBlock).toContain('$8');
    expect(insertBlock).not.toMatch(/now\(\), now\(\), 1\)/);
  });
});
