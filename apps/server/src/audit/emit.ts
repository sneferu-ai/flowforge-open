/**
 * Audit event emission — append-only hash chain.
 */

import { query } from '../db/pool.js';
import { computeAuditHash, GENESIS_HASH, type AuditAction } from '@flowforge/shared';

export async function emitAuditEvent(
  workspaceId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  // Get the last audit event for this workspace
  const lastResult = await query<{ hash: string; sequence_num: string }>(
    'SELECT hash, sequence_num FROM audit_events WHERE workspace_id = $1 ORDER BY sequence_num DESC LIMIT 1',
    [workspaceId]
  );

  const prevHash = lastResult.rows[0]?.hash ?? GENESIS_HASH;
  const sequenceNum = lastResult.rows[0] ? BigInt(lastResult.rows[0].sequence_num) + 1n : 1n;

  // Compute hash. Timestamps are deliberately NOT part of the chain input:
  // timestamptz round-trips through the column type with a different text
  // format than the JS ISO string, so hashing created_at makes every chain
  // unverifiable. The chain covers prev_hash + all event content fields.
  const hashInput = {
    workspace_id: workspaceId,
    sequence_num: Number(sequenceNum),
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
    prev_hash: prevHash,
  };

  const hash = await computeAuditHash(prevHash, hashInput);

  // Insert
  await query(
    `INSERT INTO audit_events (workspace_id, sequence_num, actor_id, action, entity_type, entity_id, metadata, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [workspaceId, sequenceNum.toString(), actorId, action, entityType, entityId, JSON.stringify(metadata), prevHash, hash]
  );
}

export interface AuditVerificationResult {
  valid: boolean;
  brokenAt: number | null;
  checked_count: number;
  truncated: boolean;
  anchor_sequence_num: number | null;
}

export interface AuditChainRow {
  sequence_num: string;
  prev_hash: string;
  hash: string;
  action: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Pure chain verification over rows (hermetically testable). See
 * `verifyAuditChain` for the semantics — a truncated chain (anchor
 * sequence_num > 1) skips the genesis link for its anchor row.
 */
export async function verifyChainRows(workspaceId: string, rows: AuditChainRow[]): Promise<AuditVerificationResult> {
  const empty: AuditVerificationResult = {
    valid: true,
    brokenAt: null,
    checked_count: rows.length,
    truncated: false,
    anchor_sequence_num: null,
  };
  if (rows.length === 0) return empty;

  const anchor = Number(rows[0].sequence_num);
  const truncated = anchor > 1;

  let expectedPrevHash = GENESIS_HASH;
  let isAnchor = true;

  for (const row of rows) {
    // The anchor of a truncated chain carries the hash of a purged row; its
    // linked-ness is not checkable, but its own hash verifies against its
    // recorded content + prev_hash below.
    const linkCheckable = !(isAnchor && truncated);
    isAnchor = false;
    if (linkCheckable && row.prev_hash !== expectedPrevHash) {
      return { valid: false, brokenAt: Number(row.sequence_num), checked_count: rows.length, truncated, anchor_sequence_num: anchor };
    }

    const hashInput = {
      workspace_id: workspaceId,
      sequence_num: Number(row.sequence_num),
      actor_id: row.actor_id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      metadata: row.metadata,
      prev_hash: row.prev_hash,
    };

    const computedHash = await computeAuditHash(row.prev_hash, hashInput);
    if (computedHash !== row.hash) {
      return { valid: false, brokenAt: Number(row.sequence_num), checked_count: rows.length, truncated, anchor_sequence_num: anchor };
    }

    expectedPrevHash = row.hash;
  }

  return { valid: true, brokenAt: null, checked_count: rows.length, truncated, anchor_sequence_num: anchor };
}

/**
 * Verify the hash chain integrity for a workspace (§7/§8.5).
 *
 * Retention purge deletes the OLDEST events; the chain remains gapless from
 * the anchor (the oldest retained event) forward, and `sequence_num` never
 * resets. A chain whose anchor is sequence_num > 1 therefore cannot be
 * expected to link back to the genesis hash — it is reported as
 * `truncated: true` with `anchor_sequence_num` set, and every retained row's
 * own hash is still recomputed. A chain starting at sequence_num 1 links to
 * genesis as before.
 */
export async function verifyAuditChain(workspaceId: string): Promise<AuditVerificationResult> {
  const result = await query<AuditChainRow>(
    'SELECT sequence_num, prev_hash, hash, action, actor_id, entity_type, entity_id, metadata FROM audit_events WHERE workspace_id = $1 ORDER BY sequence_num',
    [workspaceId]
  );
  return verifyChainRows(workspaceId, result.rows);
}
