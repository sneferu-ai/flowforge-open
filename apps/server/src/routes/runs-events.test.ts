/**
 * §7 SSE surface pins (runs.ts): the heartbeat keepalive, the live cursor,
 * and the payload shapes served by GET /runs/:id/events — the same source-pin
 * pattern as services/queue.test.ts, since the SSE endpoint needs a live
 * Postgres to exercise end-to-end (the e2e suite is the runtime net).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'runs.ts'), 'utf-8');

describe('§7 SSE endpoint in runs.ts', () => {
  it('emits a heartbeat every 15s during the SSE connection', () => {
    // §7: heartbeat → { ts }, every 15s during the SSE connection.
    expect(source).toContain('event: heartbeat');
    expect(source).toContain('{ ts: new Date().toISOString() }');
    expect(source).toContain('lastHeartbeatAt');
    expect(source).toContain('>= 15_000');
  });

  it('replays the full history before streaming, over a (created_at, id) cursor', () => {
    // Same-millisecond inserts must not be dropped by a created_at-only cursor.
    expect(source).toContain("'Content-Type': 'text/event-stream'");
    expect(source).toContain('((created_at, id) > ($2::timestamptz, $3::uuid))');
  });

  it('closes the stream for terminal runs (§7 — terminal closes)', () => {
    // The spec test plan scenario 33 requires the SSE stream to CLOSE once the
    // run has reached a terminal state, both when the run was already terminal
    // at connect time (replay then end) and when the terminal event arrives on
    // the live poll loop. Previously the stream heartbeated on a finished run
    // forever, leaving subscribers hanging.
    expect(source).toContain('SELECT id, status FROM runs');
    expect(source).toContain("new Set(['succeeded', 'failed', 'canceled'])");
    expect(source).toContain("new Set(['run.succeeded', 'run.failed', 'run.canceled'])");
    expect(source).toContain('TERMINAL_RUN_STATUSES.has(runCheck.rows[0].status)');
    expect(source).toContain('isTerminal(fresh.rows)');
    // Both terminal-close paths end the stream: after replay and on the live
    // poll loop. The catch path is the third end (error cleanup).
    expect(source.match(/reply\.raw\.end\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('emits run.canceled with the §7 payload shape', () => {
    // §7: run.canceled → { run_id, finished_at } — parameter-separated so live
    // Postgres never sees one parameter typed as both uuid and jsonb payload.
    expect(source).toContain("'run.canceled'");
    expect(source).toContain("jsonb_build_object('run_id', $2::text, 'finished_at', now())");
  });

  it('reject-with-abort is a full terminal transition (SSE + metering, same as /cancel)', () => {
    // The approval-reject abort branch must carry the SAME terminal contract as
    // the cancel endpoint: run.canceled event, lock release, and the shared
    // transaction-scoped billing — a rejected run executed steps and is
    // billable per D7.
    const rejectIdx = source.indexOf("{ reason: 'approval_rejected' }");
    expect(rejectIdx).toBeGreaterThan(-1);
    const rejectBranch = source.slice(0, rejectIdx).split('decision === \'rejected\'').pop();
    expect(rejectBranch).toBeDefined();
    expect(rejectBranch!).toContain("'run.canceled'");
    expect(rejectBranch!).toContain('recordBillingForTerminalRun(workspaceId, runId, \'run.canceled\', tx)');
    expect(rejectBranch!).toContain('DELETE FROM run_locks');
  });
});

describe('§3.3 / §6.5 manual trigger admission in runs.ts', () => {
  it('locks the workspace and the active subscription in one transaction (§3.3)', () => {
    const admissionBlock = source.slice(
      source.indexOf('const created = await withTransaction'),
      source.indexOf("'status' in created")
    );
    expect(admissionBlock).toContain('SELECT plan_id FROM workspaces WHERE id = $1 FOR UPDATE');
    expect(admissionBlock).toContain('LIMIT 1\n           FOR UPDATE');
  });

  it('checks concurrency (429) and the Free hard cap (429), soft thresholds excluded', () => {
    const admissionBlock = source.slice(
      source.indexOf('const created = await withTransaction'),
      source.indexOf("'status' in created")
    );
    expect(admissionBlock).toContain('CONCURRENCY_LIMIT_EXCEEDED');
    expect(admissionBlock).toContain('RUN_LIMIT_EXCEEDED');
    expect(admissionBlock).toContain('concurrency_block = false');
    // §3.3: the hard cap gates on hasHardRunCap — Pro/Studio soft thresholds
    // (overage billing) are not rejected.
    expect(admissionBlock).toContain('hasHardRunCap(plan)');
  });
});
