/**
 * Notification routes — in-app inbox feed (§8.7).
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { parsePageParams } from '../lib/pagination.js';

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/notifications', { preHandler: requireAuth }, async (request) => {
    const { limit, offset } = parsePageParams(request.query as Record<string, unknown>, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const result = await query(
      `SELECT id, channel, recipient, subject, body, is_read, status, created_at::text, run_id
       FROM notifications
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [request.auth!.workspaceId, limit, offset]
    );
    return { data: result.rows };
  });

  fastify.post('/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Notification not found' } });
    }
    return { data: { ok: true } };
  });
}
