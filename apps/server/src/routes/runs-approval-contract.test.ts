/**
 * §9 approval + manual-run contract pins (runs.ts):
 *   1. decideApproval rejects expired tasks (timeout_at < NOW()) with 409
 *      approval_already_decided (§9: "if expires_at < NOW()").
 *   2. Reject with on_error: continue updates the paused run_steps row to
 *      failed with the rejected decision (§9/§6.1).
 *   3. Approve updates the paused run_steps row to succeeded with the
 *      approved decision (§9).
 *   4. POST /workflows/:id/run returns 201 { run_id } for new runs and
 *      200 { run_id } for 10s-bucket dedup (§9).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'runs.ts'), 'utf-8');

describe('§9 decideApproval expired-task check', () => {
  it('selects timeout_at from approval_tasks', () => {
    expect(source).toContain('a.timeout_at');
  });

  it('checks timeout_at < NOW() and returns 409 approval_already_decided', () => {
    const expiredBlock = source.slice(
      source.indexOf("approvalRow.rows[0].status !== 'pending'"),
      source.indexOf('const runResult = await query')
    );
    expect(expiredBlock).toContain('timeout_at');
    expect(expiredBlock).toContain('new Date()');
    expect(expiredBlock).toContain('APPROVAL_ALREADY_DECIDED');
    expect(expiredBlock).toContain('Approval task has expired');
  });
});

describe('§9 reject-continue updates run_steps to failed', () => {
  it('marks the paused run_steps row as failed with the rejected decision', () => {
    const continueBranch = source.slice(
      source.indexOf("if (onError === 'continue')"),
      source.indexOf("// Reject with abort")
    );
    expect(continueBranch).toContain("UPDATE run_steps SET status = 'failed'");
    expect(continueBranch).toContain("'{decision}'");
    expect(continueBranch).toContain('"rejected"');
    expect(continueBranch).toContain("status = 'paused'");
  });
});

describe('§9 approve updates run_steps to succeeded', () => {
  it('marks the paused run_steps row as succeeded with the approved decision', () => {
    const approveBlock = source.slice(
      source.indexOf('// §9: the approved step is marked succeeded'),
      source.indexOf('fastify.post(\'/approvals/:id/approve\'')
    );
    expect(approveBlock).toContain("UPDATE run_steps SET status = 'succeeded'");
    expect(approveBlock).toContain("'{decision}'");
    expect(approveBlock).toContain('"approved"');
    expect(approveBlock).toContain("status = 'paused'");
  });
});

describe('§9 manual run response shape', () => {
  it('returns 201 { run_id } for newly created runs (no status field)', () => {
    const newRunReturn = source.slice(
      source.indexOf('// §9: newly created manual run'),
      source.indexOf('}\n}\n')
    );
    expect(newRunReturn).toContain('reply.code(201)');
    expect(newRunReturn).toContain('{ data: { run_id: created.runId } }');
    // Must NOT carry the extra status field
    expect(newRunReturn).not.toContain("status: 'queued'");
  });

  it('returns 200 { run_id } for deduplicated runs (no deduplicated field)', () => {
    const dedupReturn = source.slice(
      source.indexOf('if (created.deduplicated)'),
      source.indexOf('await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.RUN_CREATED')
    );
    expect(dedupReturn).not.toContain('deduplicated: true');
    expect(dedupReturn).toContain('{ data: { run_id: created.runId } }');
  });
});
