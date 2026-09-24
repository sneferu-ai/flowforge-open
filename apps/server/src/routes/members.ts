/**
 * Member routes — list, invite, remove, role change.
 *
 * Safety invariants (§3.3/§8.2):
 *  - Only Owner holds change_member_roles (RBAC matrix), so PATCH role is
 *    owner-gated by permission.
 *  - No operation may leave the workspace without an owner — removal or
 *    demotion of the last owner is rejected for ANY actor.
 *  - Removing a member revokes that user's sessions and API tokens for the
 *    workspace (§8.2: "Revoked on membership removal").
 *  - Invitation tokens are stored as SHA-256 hashes (§7); the raw token is
 *    returned to the inviter once and never persisted.
 */

import type { FastifyInstance } from 'fastify';
import { query, withTransaction } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ERROR_CODES, PERMISSIONS, type Role } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS } from '@flowforge/shared';
import { randomUUID, createHash } from 'node:crypto';

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}

/** Count current owners of the workspace. */
async function ownerCount(workspaceId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) as count FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`,
    [workspaceId]
  );
  return parseInt(result.rows[0].count, 10);
}

/** True when the target user is currently an owner of the workspace. */
async function isOwner(workspaceId: string, userId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'owner'`,
    [workspaceId, userId]
  );
  return result.rows.length > 0;
}

export async function memberRoutes(fastify: FastifyInstance): Promise<void> {
  // List members
  fastify.get('/members', { preHandler: requireAuth }, async (request) => {
    const result = await query(
      `SELECT u.id, u.email, u.name, wm.role, wm.created_at::text
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.created_at`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  // List invitations (§9).
  fastify.get('/invitations', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_MEMBERS)] }, async (request) => {
    const result = await query(
      `SELECT id, email, role, expires_at::text, created_at::text, accepted_at::text, revoked_at::text
       FROM invitations WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  // Revoke an invitation (§9) — accepted invitations are historical and refuse.
  fastify.delete('/invitations/:id', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_MEMBERS)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = request.auth!.workspaceId;
    const result = await query(
      `UPDATE invitations SET revoked_at = now(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL
       RETURNING id`,
      [id, workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Invitation not found or no longer revocable' } });
    }
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.MEMBER_REMOVED, 'invitation', id, { revoked: true });
    return { data: { ok: true } };
  });

  // Resend (§9) — mints a NEW single-use token for the same email/role and
  // extends the expiry; the old token dies with the row update.
  fastify.post('/invitations/:id/resend', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_MEMBERS)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = request.auth!.workspaceId;
    const existing = await query<{ email: string; role: string }>(
      `SELECT email, role FROM invitations
       WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND accepted_at IS NULL`,
      [id, workspaceId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Invitation not found or no longer resendable' } });
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'UPDATE invitations SET token_hash = $1, expires_at = $2, updated_at = now() WHERE id = $3',
      [hashInvitationToken(token), expiresAt, id]
    );
    // The raw token rides the response ONLY — the audit ledger is append-only
    // and must never hold invite-link secrets.
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.MEMBER_INVITED, 'invitation', id, { resend: true, expires_at: expiresAt.toISOString() });
    return { data: { id, token, email: existing.rows[0].email, role: existing.rows[0].role, expires_at: expiresAt.toISOString() } };
  });

  // Force-revoke one member's sessions for this workspace (§9).
  fastify.delete('/sessions/:userId', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_MEMBERS)] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const workspaceId = request.auth!.workspaceId;
    const result = await query(
      'UPDATE sessions SET revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [workspaceId, userId]
    );
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.SESSION_REVOKED, 'user', userId, {});
    return { data: { ok: true, revoked: result.rowCount } };
  });

  // Force-revoke every OTHER member's sessions for this workspace (§9).
  fastify.delete('/sessions', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_MEMBERS)] }, async (request) => {
    const workspaceId = request.auth!.workspaceId;
    const result = await query(
      'UPDATE sessions SET revoked_at = now() WHERE workspace_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [workspaceId, request.auth!.sessionId]
    );
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.SESSION_REVOKED, 'workspace', workspaceId, { all: true });
    return { data: { ok: true, revoked: result.rowCount } };
  });

  // Invite member — stores only the token hash (§7); the raw token is
  // returned to the inviter once (it is the invitation link secret).
  fastify.post('/invitations', { preHandler: [requireAuth, requirePermission(PERMISSIONS.INVITE_MEMBERS)] }, async (request, reply) => {
    const { email, role } = request.body as { email: string; role?: string };
    if (!email) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'email is required' } });
    }
    const memberRole = (role || 'member') as Role;
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await query<{ id: string }>(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [request.auth!.workspaceId, email.toLowerCase(), memberRole, hashInvitationToken(token), expiresAt]
    );

    await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.MEMBER_INVITED, 'invitation', result.rows[0].id, { email, role: memberRole });

    return { data: { id: result.rows[0].id, token, email, role: memberRole, expires_at: expiresAt.toISOString() } };
  });

  // Remove member — revokes the member's sessions and API tokens for this
  // workspace in the same transaction (§8.2). The last owner can never be
  // removed, by any actor (§3.3 last-owner protection).
  fastify.delete('/members/:userId', { preHandler: [requireAuth, requirePermission(PERMISSIONS.REMOVE_MEMBERS)] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const workspaceId = request.auth!.workspaceId;

    // Last-owner protection applies regardless of who the actor is.
    if ((await isOwner(workspaceId, userId)) && (await ownerCount(workspaceId)) <= 1) {
      return reply.code(400).send({ error: { code: ERROR_CODES.CANNOT_REMOVE_LAST_OWNER, message: 'Cannot remove the last owner' } });
    }

    const removed = await withTransaction(async (tx) => {
      const result = await tx.query(
        'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id',
        [workspaceId, userId]
      );
      if (result.rows.length === 0) return false;
      await tx.query(
        'UPDATE api_tokens SET revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL',
        [workspaceId, userId]
      );
      await tx.query(
        'UPDATE sessions SET revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL',
        [workspaceId, userId]
      );
      return true;
    });

    if (!removed) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Member not found' } });
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.MEMBER_REMOVED, 'user', userId, {});
    return { data: { ok: true } };
  });

  // Change role (Owner-only via the change_member_roles permission, §3.3).
  // Demoting the last owner is rejected for any actor.
  fastify.patch('/members/:userId/role', { preHandler: [requireAuth, requirePermission(PERMISSIONS.CHANGE_MEMBER_ROLES)] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { role } = request.body as { role: Role };
    const workspaceId = request.auth!.workspaceId;

    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid role' } });
    }

    // Last-owner protection: demoting the last owner would strand the
    // workspace with no owner, whoever asks.
    if (role !== 'owner' && (await isOwner(workspaceId, userId)) && (await ownerCount(workspaceId)) <= 1) {
      return reply.code(400).send({ error: { code: ERROR_CODES.CANNOT_REMOVE_LAST_OWNER, message: 'Cannot demote the last owner' } });
    }

    const result = await query(
      'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING user_id',
      [role, workspaceId, userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Member not found' } });
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.MEMBER_ROLE_CHANGED, 'user', userId, { role });
    return { data: { ok: true } };
  });
}
