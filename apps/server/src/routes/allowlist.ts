/**
 * Per-workspace egress allowlist (§8.8, §9).
 * Entries: { scheme: http|https, host, port? }. Port null ⇒ scheme default.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS } from '@flowforge/shared';

// host is a bare hostname or IP literal — the port lives ONLY in the separate
// `port` field (§8.8/§9). No `:port` suffix, no wildcards, no paths.
// Exported for unit tests.
export const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^(?:\d{1,3}\.){3}\d{1,3}$/i;

export async function allowlistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/allowlist', { preHandler: requireAuth }, async (request) => {
    const result = await query(
      `SELECT id, scheme, host, port, created_at::text
       FROM workspace_allowlist WHERE workspace_id = $1 ORDER BY host, port`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  fastify.post('/allowlist', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_ALLOWLIST)],
  }, async (request, reply) => {
    const { scheme, host, port } = request.body as { scheme: string; host: string; port?: number };
    if (scheme !== 'http' && scheme !== 'https') {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'scheme must be http or https' },
      });
    }
    if (!host || !HOST_RE.test(host) || host.includes('/')) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'host must be a valid hostname or IP literal (no wildcards, no paths)' },
      });
    }
    if (port !== undefined && port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'port must be an integer 1-65535' },
      });
    }
    try {
      const result = await query<{ id: string }>(
        `INSERT INTO workspace_allowlist (workspace_id, scheme, host, port)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [request.auth!.workspaceId, scheme, host.toLowerCase(), port ?? null]
      );
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.ALLOWLIST_ENTRY_ADDED, 'allowlist', result.rows[0].id, { scheme, host, port });
      return { data: { id: result.rows[0].id, scheme, host: host.toLowerCase(), port: port ?? null } };
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        return reply.code(400).send({
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'duplicate allowlist entry for this workspace' },
        });
      }
      throw err;
    }
  });

  fastify.delete('/allowlist/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_ALLOWLIST)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      'DELETE FROM workspace_allowlist WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Allowlist entry not found' } });
    }
    await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.ALLOWLIST_ENTRY_REMOVED, 'allowlist', id, {});
    return { data: { ok: true } };
  });
}
