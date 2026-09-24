/**
 * §7/§8.5 audit chain verification — pure `verifyChainRows` tests covering
 * the retention-truncation semantics: a purged chain verifies from its
 * anchor forward and reports { truncated: true, anchor_sequence_num }, while
 * an untruncated chain still links back to the genesis hash, and a tampered
 * row is always broken.
 */

import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, computeAuditHash } from '@flowforge/shared';
import { verifyChainRows, type AuditChainRow } from './emit.js';

const WS = '00000000-0000-4000-8000-000000000001';

async function buildChain(workspaceId: string, count: number, startSeq: number): Promise<AuditChainRow[]> {
  const rows: AuditChainRow[] = [];
  let prev = GENESIS_HASH;
  // Simulate the purged prefix so the anchor's prev_hash no longer links to
  // genesis once startSeq > 1.
  for (let s = 1; s < startSeq; s++) {
    const input = {
      workspace_id: workspaceId,
      sequence_num: s,
      actor_id: null,
      action: 'run.created',
      entity_type: 'run',
      entity_id: `purged-${s}`,
      metadata: {},
      prev_hash: prev,
    };
    prev = await computeAuditHash(prev, input);
  }
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i;
    const input = {
      workspace_id: workspaceId,
      sequence_num: seq,
      actor_id: null,
      action: 'run.succeeded',
      entity_type: 'run',
      entity_id: `run-${seq}`,
      metadata: { note: `event ${seq}` },
      prev_hash: prev,
    };
    const hash = await computeAuditHash(prev, input);
    rows.push({ sequence_num: String(seq), prev_hash: prev, hash, action: 'run.succeeded', actor_id: null, entity_type: 'run', entity_id: `run-${seq}`, metadata: { note: `event ${seq}` } });
    prev = hash;
  }
  return rows;
}

describe('verifyChainRows — untruncated chain (anchor = 1)', () => {
  it('verifies a genesis-linked chain', async () => {
    const rows = await buildChain(WS, 3, 1);
    const result = await verifyChainRows(WS, rows);
    expect(result).toEqual({ valid: true, brokenAt: null, checked_count: 3, truncated: false, anchor_sequence_num: 1 });
  });

  it('flags a tampered row (recomputed hash mismatch)', async () => {
    const rows = await buildChain(WS, 3, 1);
    rows[1] = { ...rows[1], hash: 'deadbeef'.padEnd(64, '0') };
    const result = await verifyChainRows(WS, rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('flags a broken prev_hash link in the middle of the chain', async () => {
    const rows = await buildChain(WS, 3, 1);
    rows[2] = { ...rows[2], prev_hash: 'cafebabe'.padEnd(64, '0') };
    const result = await verifyChainRows(WS, rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
  });

  it('reports an empty chain as valid with zero checks', async () => {
    const result = await verifyChainRows(WS, []);
    expect(result).toEqual({ valid: true, brokenAt: null, checked_count: 0, truncated: false, anchor_sequence_num: null });
  });
});

describe('verifyChainRows — truncated chain after retention purge (anchor > 1)', () => {
  it('verifies a purged chain from its anchor and reports truncation', async () => {
    const rows = await buildChain(WS, 3, 5);
    const result = await verifyChainRows(WS, rows);
    expect(result.valid).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.anchor_sequence_num).toBe(5);
    expect(result.checked_count).toBe(3);
  });

  it('still detects tampering INSIDE the retained range', async () => {
    const rows = await buildChain(WS, 3, 5);
    rows[1] = { ...rows[1], hash: '00'.repeat(32) };
    const result = await verifyChainRows(WS, rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(6);
    expect(result.truncated).toBe(true);
    expect(result.anchor_sequence_num).toBe(5);
  });

  it('still detects a broken link AFTER the anchor', async () => {
    const rows = await buildChain(WS, 3, 5);
    rows[2] = { ...rows[2], prev_hash: rows[2].hash }; // self-link is wrong
    const result = await verifyChainRows(WS, rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(7);
  });
});
