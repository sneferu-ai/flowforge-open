/**
 * Workspace routes — list, create, get, delete (§9, §8.1).
 *
 * §8.1 pre-workspace plane: only workspace creation/selection/logout are
 * reachable without a selected workspace, so GET /workspaces (the picker's
 * list) and POST /workspaces (create) use `requireSession`; everything else
 * requires a workspace-scoped session.
 *
 * Creation contract (§3.3/§7): the Free plan is assigned and the
 * `subscriptions` row is created in the SAME transaction — plan_id on
 * subscriptions is authoritative for entitlement checks.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth, requireSession } from '../middleware/auth.js';
import { createSession, revokeSession, getSessionCookieName, getSessionDuration } from '../auth/session.js';
import { slugify } from './workflows.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS } from '@flowforge/shared';
import { requirePermission } from '../middleware/auth.js';
import { getPlanDefinition } from '@flowforge/shared';

export async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  // List the caller's workspaces (workspace picker, §8.1/§9).
  fastify.get('/workspaces', { preHandler: requireSession }, async (request) => {
    const result = await query(
      `SELECT w.id, w.name, w.slug, w.plan_id, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.deleted_at IS NULL
       ORDER BY wm.created_at`,
      [request.sessionAuth!.user.id]
    );
    return { data: result.rows };
  });

  // Create a workspace — Free plan + subscriptions row atomically (§3.3).
  // The pre-workspace session is upgraded to a workspace-scoped session.
  fastify.post('/workspaces', { preHandler: requireSession }, async (request, reply) => {
    const { name, slug } = (request.body ?? {}) as { name?: string; slug?: string };
    if (!name || !name.trim() || name.length > 120) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'A workspace name (max 120 chars) is required' },
      });
    }
    const sessionAuth = request.sessionAuth!;
    const desiredSlug = (slug || slugify(name.trim())).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!desiredSlug || desiredSlug.length > 60) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'A valid workspace slug (max 60 chars, lowercase letters/numbers/dashes) is required' },
      });
    }

    let finalSlug = desiredSlug;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const created = await withTransaction(async (tx) => {
          const wsResult = await tx.query<{ id: string }>(
            `INSERT INTO workspaces (name, plan_id, api_secret, slug)
             VALUES ($1, 'free', $2, $3) RETURNING id`,
            [name.trim(), randomUUID() + randomUUID(), finalSlug]
          );
          const wsId = wsResult.rows[0].id;
          await tx.query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
            [wsId, sessionAuth.user.id, 'owner']
          );
          // §3.3/§7 — Free plan assignment + the authoritative subscriptions row.
          await tx.query(
            `INSERT INTO subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end, runs_consumed)
             VALUES ($1, 'free', 'active', now(), now() + INTERVAL '30 days', 0)`,
            [wsId]
          );
          return wsId;
        });

        await emitAuditEvent(created, sessionAuth.user.id, AUDIT_ACTIONS.WORKSPACE_CREATED, 'workspace', created, {
          name: name.trim(),
          slug: finalSlug,
        });

        // §8.1 — creation completes the pick: scope the session, revoke the old one.
        const scoped = await createSession(sessionAuth.user.id, created);
        await revokeSession(sessionAuth.sessionToken);
        reply.setCookie(getSessionCookieName(), scoped.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/',
          maxAge: getSessionDuration() / 1000,
        });

        return reply.code(201).send({
          data: { id: created, name: name.trim(), slug: finalSlug, plan_id: 'free', csrf_token: scoped.csrf_token },
        });
      } catch (err) {
        if ((err as Error).message.includes('duplicate key')) {
          finalSlug = `${desiredSlug}-${attempt + 2}`;
          continue;
        }
        throw err;
      }
    }
    return reply.code(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'Could not allocate a unique workspace slug' } });
  });

  // Get a workspace with plan info (§9).
  fastify.get('/workspaces/:slug', { preHandler: requireAuth }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const result = await query<{ plan_id: string | null; name: string; slug: string | null; is_enabled: boolean }>(
      'SELECT name, slug, plan_id, is_enabled FROM workspaces WHERE slug = $1 AND deleted_at IS NULL',
      [slug]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' } });
    }
    const plan = getPlanDefinition(result.rows[0].plan_id ?? 'free');
    return {
      data: {
        ...result.rows[0],
        plan: plan ? { id: plan.id, name: plan.name, price_cents: plan.price_cents } : null,
      },
    };
  });

  // Delete a workspace — Owner-only, soft delete (§3.3 RBAC matrix).
  fastify.delete('/workspaces/:slug', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.DELETE_WORKSPACE)],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const workspaceId = request.auth!.workspaceId;
    const result = await query(
      `UPDATE workspaces SET deleted_at = now(), is_enabled = false, updated_at = now()
       WHERE id = $1 AND slug = $2 AND deleted_at IS NULL RETURNING id`,
      [workspaceId, slug]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKSPACE_NOT_FOUND, message: 'Workspace not found' } });
    }
    await query('UPDATE workflows SET is_enabled = false, updated_at = now() WHERE workspace_id = $1', [workspaceId]);
    await query('UPDATE sessions SET revoked_at = now() WHERE workspace_id = $1 AND revoked_at IS NULL', [workspaceId]);
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKSPACE_DELETED, 'workspace', workspaceId, { slug });
    return { data: { ok: true } };
  });
}
