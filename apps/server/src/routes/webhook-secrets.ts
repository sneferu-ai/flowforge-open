/**
 * Webhook secret routes (§8.4, §9) — names + AES-256-GCM encrypted values.
 * Values are never returned after creation.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { encryptWithMeta } from '../crypto.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS } from '@flowforge/shared';

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export async function secretRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/webhook-secrets', { preHandler: requireAuth }, async (request) => {
    const result = await query(
      'SELECT id, name, created_at::text FROM webhook_secrets WHERE workspace_id = $1 ORDER BY name',
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  fastify.post('/webhook-secrets', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_WEBHOOK_SECRETS)],
  }, async (request, reply) => {
    const { name, value } = request.body as { name: string; value: string };
    if (!name || typeof value !== 'string' || value.length === 0) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name and a non-empty value are required' },
      });
    }
    if (!NAME_RE.test(name)) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name must match ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
      });
    }
    try {
      const sealed = encryptWithMeta(value, request.auth!.workspaceId);
      const result = await query<{ id: string }>(
        `INSERT INTO webhook_secrets (workspace_id, name, value_enc, nonce, key_version)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [request.auth!.workspaceId, name, sealed.valueEnc, sealed.nonce, sealed.keyVersion]
      );
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WEBHOOK_SECRET_CREATED, 'webhook_secret', result.rows[0].id, { name });
      return { data: { id: result.rows[0].id, name } };
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        return reply.code(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'A secret with this name already exists' } });
      }
      throw err;
    }
  });

  fastify.delete('/webhook-secrets/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_WEBHOOK_SECRETS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      'DELETE FROM webhook_secrets WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Secret not found' } });
    }
    await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WEBHOOK_SECRET_DELETED, 'webhook_secret', id, {});
    return { data: { ok: true } };
  });
}
