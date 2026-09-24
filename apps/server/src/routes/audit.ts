/**
 * Audit routes — list and verify.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';
import { verifyAuditChain } from '../audit/emit.js';
import { parsePageParams } from '../lib/pagination.js';

const auditGate = [requireAuth, requireFeature('audit_log')];

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  // List audit events
  fastify.get('/audit', { preHandler: auditGate }, async (request) => {
    const { limit, offset } = parsePageParams(request.query as Record<string, unknown>, {
      defaultLimit: 100,
      maxLimit: 500,
    });

    const result = await query(
      `SELECT id, sequence_num, actor_id, action, entity_type, entity_id, metadata, created_at::text
       FROM audit_events
       WHERE workspace_id = $1
       ORDER BY sequence_num DESC
       LIMIT $2 OFFSET $3`,
      [request.auth!.workspaceId, limit, offset]
    );
    return { data: result.rows };
  });

  // Verify audit chain
  fastify.get('/audit/verify', { preHandler: auditGate }, async (request) => {
    const result = await verifyAuditChain(request.auth!.workspaceId);
    return { data: result };
  });
}
