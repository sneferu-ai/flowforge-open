/**
 * Trigger routes — list, create, update, delete (§9).
 *
 * Triggers are reconciled from the manifest on workflow creation and version
 * promotion; these routes are the explicit control path. Webhook paths are
 * unique per workspace; enabling a trigger only flips its flag. History rows
 * reference triggers via trigger_id, so DELETE is a soft disable + flag clear
 * (never a hard delete that orphans run history).
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ERROR_CODES, AUDIT_ACTIONS, PERMISSIONS } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { computeNextFire, isValidCron } from '../lib/cron.js';

export async function triggerRoutes(fastify: FastifyInstance): Promise<void> {
  // List triggers for a workflow
  fastify.get('/workflows/:id/triggers', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await assertWorkflow(request.auth!.workspaceId, id, reply))) return;
    const result = await query(
      `SELECT t.id, t.type, t.config, t.is_enabled, t.next_fire_at::text, t.created_at::text
       FROM triggers t
       WHERE t.workflow_id = $1
       ORDER BY t.created_at`,
      [id]
    );
    return { data: result.rows };
  });

  // Create a trigger (§9: { type, config }).
  fastify.post('/workflows/:id/triggers', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { type, config } = (request.body ?? {}) as { type?: string; config?: Record<string, unknown> };
    const workspaceId = request.auth!.workspaceId;
    if (!(await assertWorkflow(workspaceId, id, reply))) return;

    if (type !== 'schedule' && type !== 'webhook') {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'trigger type must be schedule or webhook' },
      });
    }
    const storedConfig = { ...(config || {}) };
    let nextFire: Date | null = null;
    if (type === 'schedule') {
      const cron = String(storedConfig.cron ?? '');
      if (!isValidCron(cron)) {
        return reply.code(400).send({
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'schedule trigger requires a valid 5-field cron' },
        });
      }
      nextFire = computeNextFire(cron);
    } else {
      // §6.4 — webhook paths are unique per workspace.
      const path = String(storedConfig.path ?? '').trim();
      if (!path) {
        return reply.code(400).send({
          error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'webhook trigger requires config.path' },
        });
      }
      storedConfig.path = path;
      const conflict = await query(
        `SELECT 1 FROM triggers t
         JOIN workflows w ON w.id = t.workflow_id
         WHERE w.workspace_id = $1 AND t.type = 'webhook' AND t.config ->> 'path' = $2 LIMIT 1`,
        [workspaceId, path]
      );
      if (conflict.rows.length > 0) {
        return reply.code(400).send({
          error: { code: ERROR_CODES.WEBHOOK_PATH_CONFLICT, message: `webhook path '${path}' is already taken in this workspace` },
        });
      }
    }

    const created = await query<{ id: string }>(
      `INSERT INTO triggers (workflow_id, type, config, is_enabled, next_fire_at)
       VALUES ($1, $2, $3, true, $4) RETURNING id`,
      [id, type, JSON.stringify(storedConfig), nextFire]
    );
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.TRIGGER_CREATED, 'trigger', created.rows[0].id, { workflow_id: id, type });
    return reply.code(201).send({
      data: { id: created.rows[0].id, type, config: storedConfig, is_enabled: true, next_fire_at: nextFire?.toISOString() ?? null },
    });
  });

  // Update a trigger (§9: { is_enabled?, config? }).
  fastify.put('/workflows/:id/triggers/:triggerId', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id, triggerId } = request.params as { id: string; triggerId: string };
    const { is_enabled, config } = (request.body ?? {}) as { is_enabled?: boolean; config?: Record<string, unknown> };
    const workspaceId = request.auth!.workspaceId;
    if (!(await assertWorkflow(workspaceId, id, reply))) return;

    const existing = await query<{ type: string; config: Record<string, unknown> }>(
      'SELECT type, config FROM triggers WHERE id = $1 AND workflow_id = $2',
      [triggerId, id]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Trigger not found' } });
    }

    let nextFire: Date | null = null;
    if (config) {
      // Merge over the stored config (update-in-place semantics).
      const storedConfig: Record<string, unknown> = typeof existing.rows[0].config === 'string'
        ? (JSON.parse(existing.rows[0].config as unknown as string) as Record<string, unknown>)
        : existing.rows[0].config;
      const merged = { ...storedConfig, ...config };
      if (existing.rows[0].type === 'schedule' && typeof merged.cron === 'string') {
        if (!isValidCron(merged.cron)) {
          return reply.code(400).send({
            error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'invalid cron expression' },
          });
        }
        nextFire = computeNextFire(merged.cron);
      }
      await query('UPDATE triggers SET config = $1, updated_at = now() WHERE id = $2', [JSON.stringify(merged), triggerId]);
    }
    if (typeof is_enabled === 'boolean') {
      await query('UPDATE triggers SET is_enabled = $1, updated_at = now() WHERE id = $2', [is_enabled, triggerId]);
    }
    if (nextFire) {
      await query('UPDATE triggers SET next_fire_at = $1 WHERE id = $2', [nextFire, triggerId]);
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.TRIGGER_UPDATED, 'trigger', triggerId, {
      workflow_id: id,
      is_enabled: is_enabled ?? null,
    });
    const updated = await query(
      `SELECT id, type, config, is_enabled, next_fire_at::text FROM triggers WHERE id = $1`,
      [triggerId]
    );
    return { data: updated.rows[0] };
  });

  // Delete a trigger (§9) — soft: disabled so run history (trigger_id) stays intact.
  fastify.delete('/workflows/:id/triggers/:triggerId', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id, triggerId } = request.params as { id: string; triggerId: string };
    const workspaceId = request.auth!.workspaceId;
    if (!(await assertWorkflow(workspaceId, id, reply))) return;

    const result = await query(
      'UPDATE triggers SET is_enabled = false, updated_at = now() WHERE id = $1 AND workflow_id = $2 RETURNING id',
      [triggerId, id]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Trigger not found' } });
    }
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.TRIGGER_DELETED, 'trigger', triggerId, { workflow_id: id });
    return { data: { ok: true } };
  });
}

/** True when the workflow exists in the workspace; replies 404 itself when not. */
async function assertWorkflow(workspaceId: string, workflowId: string, reply: FastifyReply): Promise<boolean> {
  const result = await query('SELECT id FROM workflows WHERE id = $1 AND workspace_id = $2', [workflowId, workspaceId]);
  if (result.rows.length === 0) {
    reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    return false;
  }
  return true;
}
