/**
 * API token routes (§8.4) — workspace-scoped bearer tokens, shown once,
 * stored SHA-256-hashed.
 */

import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS, hasPermission } from '@flowforge/shared';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function apiTokenRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api-tokens', { preHandler: requireAuth }, async (request) => {
    const result = await query(
      `SELECT id, name, role_snapshot, created_at::text, revoked_at::text, last_used_at::text
       FROM api_tokens WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [request.auth!.workspaceId, request.auth!.user.id]
    );
    return { data: result.rows };
  });

  fastify.post('/api-tokens', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_OWN_TOKENS)],
  }, async (request, reply) => {
    const { name } = request.body as { name: string };
    if (!name || !name.trim()) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name is required' } });
    }

    // §8.4: 256-bit random tokens (32 bytes), shown once, stored SHA-256-hashed.
    // §8.2: role_snapshot frozen at creation time — later membership changes
    // do not affect tokens already issued.
    const token = `ff_${randomBytes(32).toString('base64url')}`;
    const tokenHash = hashToken(token);

    const result = await query<{ id: string }>(
      `INSERT INTO api_tokens (workspace_id, user_id, name, token_hash, role_snapshot)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [request.auth!.workspaceId, request.auth!.user.id, name.trim(), tokenHash, request.auth!.role]
    );
    await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.API_TOKEN_CREATED, 'api_token', result.rows[0].id, { name });
    return { data: { id: result.rows[0].id, name: name.trim(), token } };
  });

  fastify.delete('/api-tokens/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_OWN_TOKENS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = request.auth!;

    // §3.3 RBAC: members can only revoke their own tokens; owners/admins
    // (MANAGE_OTHERS_TOKENS) can revoke any workspace member's token.
    const canManageOthers = hasPermission(auth.role, PERMISSIONS.MANAGE_OTHERS_TOKENS);
    const filterClause = canManageOthers ? '' : 'AND user_id = $3';
    const params = canManageOthers
      ? [id, auth.workspaceId]
      : [id, auth.workspaceId, auth.user.id];

    const result = await query(
      `UPDATE api_tokens SET revoked_at = now()
       WHERE id = $1 AND workspace_id = $2 ${filterClause}
       RETURNING user_id`,
      params,
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Token not found' } });
    }
    await emitAuditEvent(auth.workspaceId, auth.user.id, AUDIT_ACTIONS.API_TOKEN_REVOKED, 'api_token', id, {
      token_owner: result.rows[0].user_id,
    });
    return { data: { ok: true } };
  });
}
