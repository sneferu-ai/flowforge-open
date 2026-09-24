/**
 * Auth routes — register, login, select-workspace, logout, me, csrf,
 * change-password.
 *
 * Session model (§8.1): register/login create a PRE-WORKSPACE session
 * (workspace_id = NULL). The client then calls POST /auth/select-workspace to
 * obtain a workspace-scoped session; the pre-workspace session is revoked.
 * Login rate limiting (§8.1): 5 failed attempts per email per 15 minutes locks
 * the account for 15 minutes (HTTP 423, code account_locked).
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { randomUUID, createHash } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import {
  createSession,
  revokeSession,
  getSessionCookieName,
  getSessionDuration,
} from '../auth/session.js';
import { slugify } from './workflows.js';
import { validatePasswordPolicy } from '@flowforge/shared';
import { requireAuth, requireSession } from '../middleware/auth.js';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES } from '@flowforge/shared';

/** §8.1 login rate limiting contract. */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW = `15 minutes`;
const LOGIN_LOCK = `15 minutes`;

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string | null;
  plan_id: string;
  role: string;
}

async function listUserWorkspaces(userId: string): Promise<WorkspaceRow[]> {
  const result = await query<WorkspaceRow>(
    `SELECT w.id, w.name, w.slug, w.plan_id, wm.role
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1 AND w.deleted_at IS NULL
     ORDER BY wm.created_at`,
    [userId]
  );
  return result.rows;
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: getSessionDuration() / 1000,
  });
}

/**
 * Record a failed login attempt for the email. Returns true when the account
 * is now locked (5th failure inside the 15-minute window engages the lock).
 * Runs in a transaction with a row lock so concurrent attempts cannot lose
 * counts.
 */
async function recordLoginFailure(email: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const existing = await tx.query<{
      failed_count: number;
      window_started_at: string;
    }>(
      'SELECT failed_count, window_started_at::text FROM login_attempts WHERE email = $1 FOR UPDATE',
      [email]
    );
    const now = Date.now();
    let count = 1;
    if (existing.rows.length > 0) {
      const windowStart = Date.parse(existing.rows[0].window_started_at);
      const windowExpired = Number.isFinite(windowStart) && now - windowStart > 15 * 60 * 1000;
      count = windowExpired ? 1 : existing.rows[0].failed_count + 1;
    }
    const locked = count >= LOGIN_MAX_FAILURES;
    await tx.query(
      `INSERT INTO login_attempts (email, failed_count, window_started_at, locked_until, updated_at)
       VALUES ($1, $2, now(), CASE WHEN $3 THEN now() + INTERVAL '${LOGIN_LOCK}' ELSE NULL END, now())
       ON CONFLICT (email) DO UPDATE SET
         failed_count = $2,
         window_started_at = CASE
           WHEN login_attempts.window_started_at < now() - INTERVAL '${LOGIN_WINDOW}' THEN now()
           ELSE login_attempts.window_started_at
         END,
         locked_until = CASE WHEN $3 THEN now() + INTERVAL '${LOGIN_LOCK}' ELSE NULL END,
         updated_at = now()`,
      [email, count, locked]
    );
    return locked;
  });
}

/** True when the account is currently inside a lock window. */
async function isLoginLocked(email: string): Promise<boolean> {
  const result = await query<{ locked_until: string | null }>(
    'SELECT locked_until::text FROM login_attempts WHERE email = $1',
    [email]
  );
  const lockedUntil = result.rows[0]?.locked_until;
  return !!lockedUntil && Date.parse(lockedUntil) > Date.now();
}

async function clearLoginFailures(email: string): Promise<void> {
  await query('DELETE FROM login_attempts WHERE email = $1', [email]);
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Register — creates the user, their workspace (Free plan), the
  // subscriptions row (§3.5/§7), and a pre-workspace session (§8.1).
  fastify.post('/auth/register', async (request, reply) => {
    const { email, password, name, workspace_name } = request.body as {
      email: string;
      password: string;
      name: string;
      workspace_name?: string;
    };

    if (!email || !password || !name) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'email, password, and name are required' },
      });
    }

    // Validate password policy — distinct codes per failure class (§8.1):
    // only breached passwords report password_too_common.
    const pwCheck = validatePasswordPolicy(password);
    if (!pwCheck.valid) {
      return reply.code(400).send({
        error: { code: pwCheck.code ?? 'validation_error', message: pwCheck.error },
      });
    }

    // Check if email already exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({
        error: { code: 'conflict', message: 'Email already registered' },
      });
    }

    // Create user
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const userResult = await query<{ id: string }>(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      [email.toLowerCase(), passwordHash, name]
    );
    const userId = userResult.rows[0].id;

    // Create workspace
    const apiSecret = randomUUID() + randomUUID();
    const wsName = workspace_name || `${name}'s Workspace`;
    const baseSlug = slugify(wsName);
    let slug = baseSlug;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const { workspaceId } = await withTransaction(async (tx) => {
          const wsResult = await tx.query<{ id: string }>(
            'INSERT INTO workspaces (name, plan_id, api_secret, slug) VALUES ($1, $2, $3, $4) RETURNING id',
            [wsName, 'free', apiSecret, slug]
          );
          const wsId = wsResult.rows[0].id;

          // Add user as owner
          await tx.query(
            'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
            [wsId, userId, 'owner']
          );

          // §3.5/§7: workspace creation assigns the Free plan and creates the
          // subscriptions row — subscriptions.plan_id is authoritative.
          await tx.query(
            `INSERT INTO subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end, runs_consumed)
             VALUES ($1, 'free', 'active', now(), now() + INTERVAL '30 days', 0)`,
            [wsId]
          );
          return { workspaceId: wsId };
        });

        // Emit audit event
        await emitAuditEvent(workspaceId, userId, AUDIT_ACTIONS.USER_REGISTERED, 'user', userId, {
          email,
          name,
        });

        // §8.1: registration creates a PRE-WORKSPACE session; the client then
        // selects a workspace via POST /auth/select-workspace.
        const session = await createSession(userId, null);
        setSessionCookie(reply, session.token);

        const workspaces = await listUserWorkspaces(userId);
        return reply.code(201).send({
          data: {
            id: userId,
            email: email.toLowerCase(),
            name,
            user: { id: userId, email: email.toLowerCase(), name },
            workspaces,
            csrf_token: session.csrf_token,
          },
        });
      } catch (err) {
        if ((err as Error).message.includes('duplicate key')) {
          slug = `${baseSlug}-${attempt + 2}`;
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique workspace slug');
  });

  // Login — rate-limited (§8.1), creates a pre-workspace session.
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'email and password are required' },
      });
    }

    const normalizedEmail = email.toLowerCase();

    // §8.1: 5 failed attempts per email per 15 minutes → 15-minute lock (423).
    if (await isLoginLocked(normalizedEmail)) {
      return reply.code(423).send({
        error: { code: ERROR_CODES.ACCOUNT_LOCKED, message: 'Account locked — too many failed login attempts. Try again later.' },
      });
    }

    const result = await query<{ id: string; email: string; name: string; password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (result.rows.length === 0 || !(await argon2.verify(result.rows[0].password_hash, password))) {
      const nowLocked = await recordLoginFailure(normalizedEmail);
      if (nowLocked) {
        return reply.code(423).send({
          error: { code: ERROR_CODES.ACCOUNT_LOCKED, message: 'Account locked — too many failed login attempts. Try again later.' },
        });
      }
      return reply.code(401).send({
        error: { code: 'invalid_credentials', message: 'Invalid email or password' },
      });
    }

    const user = result.rows[0];
    await clearLoginFailures(normalizedEmail);

    const workspaces = await listUserWorkspaces(user.id);
    if (workspaces.length === 0) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'No workspace found' },
      });
    }

    // Update last_login_at
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    // §8.1: login creates a PRE-WORKSPACE session (workspace_id = NULL); the
    // client picks a workspace via POST /auth/select-workspace.
    const session = await createSession(user.id, null);
    setSessionCookie(reply, session.token);

    await emitAuditEvent(workspaces[0].id, user.id, AUDIT_ACTIONS.USER_LOGIN, 'user', user.id, {});

    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        user: { id: user.id, email: user.email, name: user.name },
        workspaces,
        csrf_token: session.csrf_token,
      },
    };
  });

  // §8.1: exchange a pre-workspace session for a workspace-scoped one.
  fastify.post('/auth/select-workspace', { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as { workspace_slug?: string; workspace_id?: string };
    const slugOrId = body.workspace_slug || body.workspace_id || '';
    if (!slugOrId) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'workspace_slug is required' },
      });
    }
    const sessionAuth = request.sessionAuth!;

    const wsResult = await query<{ id: string; name: string; slug: string | null; plan_id: string; role: string }>(
      `SELECT w.id, w.name, w.slug, w.plan_id, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.deleted_at IS NULL
         AND (${body.workspace_slug ? 'w.slug = $2' : 'w.id = $2'})`,
      [sessionAuth.user.id, slugOrId]
    );
    if (wsResult.rows.length === 0) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'Not a member of that workspace' },
      });
    }
    const ws = wsResult.rows[0];

    // Create the scoped session, then revoke the old (pre-workspace) session.
    const scoped = await createSession(sessionAuth.user.id, ws.id);
    await revokeSession(sessionAuth.sessionToken);
    setSessionCookie(reply, scoped.token);

    return {
      data: {
        workspace: { id: ws.id, name: ws.name, slug: ws.slug, plan_id: ws.plan_id },
        role: ws.role,
        csrf_token: scoped.csrf_token,
      },
    };
  });

  // Logout (§9: 204)
  fastify.post('/auth/logout', async (request, reply) => {
    const sessionToken = request.cookies[getSessionCookieName()];
    if (sessionToken) {
      await revokeSession(sessionToken);
    }
    reply.clearCookie(getSessionCookieName(), { path: '/' });
    return reply.code(204).send();
  });

  // Me — current user, workspace (when scoped), and the workspaces list used
  // by the workspace picker (§8.1). Pre-workspace sessions are allowed.
  fastify.get('/auth/me', { preHandler: requireSession }, async (request) => {
    const sessionAuth = request.sessionAuth!;
    const workspaces = await listUserWorkspaces(sessionAuth.user.id);

    let workspace: { id: string; name: string; plan_id: string; slug: string | null } | null = null;
    let role: string | null = null;
    if (sessionAuth.workspaceId) {
      const wsResult = await query<{ name: string; plan_id: string; slug: string | null }>(
        'SELECT name, plan_id, slug FROM workspaces WHERE id = $1',
        [sessionAuth.workspaceId]
      );
      workspace = wsResult.rows[0]
        ? { id: sessionAuth.workspaceId, ...wsResult.rows[0] }
        : null;
      role = workspaces.find((w) => w.id === sessionAuth.workspaceId)?.role ?? null;
    }

    return {
      data: {
        id: sessionAuth.user.id,
        email: sessionAuth.user.email,
        name: sessionAuth.user.name,
        user: sessionAuth.user,
        workspaces,
        workspace,
        role,
        csrf_token: sessionAuth.csrfToken,
      },
    };
  });

  // §8.1 password change: verify current, validate the new password, update
  // the hash, revoke ALL sessions and ALL API tokens, return 204.
  fastify.post('/auth/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const { current_password, new_password } = (request.body ?? {}) as {
      current_password?: string;
      new_password?: string;
    };
    if (!current_password || !new_password) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'current_password and new_password are required' },
      });
    }

    const userId = request.auth!.user.id;
    const userResult = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0 || !(await argon2.verify(userResult.rows[0].password_hash, current_password))) {
      return reply.code(401).send({
        error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: 'Current password is incorrect' },
      });
    }

    const pwCheck = validatePasswordPolicy(new_password);
    if (!pwCheck.valid) {
      return reply.code(400).send({
        error: { code: pwCheck.code ?? 'validation_error', message: pwCheck.error },
      });
    }

    const passwordHash = await argon2.hash(new_password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await withTransaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, userId]);
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await tx.query('UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    });

    await emitAuditEvent(request.auth!.workspaceId, userId, AUDIT_ACTIONS.USER_PASSWORD_CHANGED, 'user', userId, {});

    reply.clearCookie(getSessionCookieName(), { path: '/' });
    return reply.code(204).send();
  });

  // Accept an invitation (§9) — validates the token hash, expiry, and
  // revocation state; joins the workspace; returns a workspace-scoped session.
  fastify.post('/auth/invite/accept', { preHandler: requireSession }, async (request, reply) => {
    const { token } = (request.body ?? {}) as { token?: string };
    if (!token || typeof token !== 'string') {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'invitation token is required' },
      });
    }
    const sessionAuth = request.sessionAuth!;
    const tokenHash = createHash('sha256').update(token, 'utf-8').digest('hex');

    const invitation = await query<{ id: string; workspace_id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>(
      `SELECT id, workspace_id, email, role, expires_at::text, accepted_at::text, revoked_at::text
       FROM invitations WHERE token_hash = $1`,
      [tokenHash]
    );
    if (invitation.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'validation_error', message: 'Invitation not found' } });
    }
    const inv = invitation.rows[0];
    if (inv.revoked_at !== null) {
      return reply.code(400).send({ error: { code: 'validation_error', message: 'Invitation has been revoked' } });
    }
    if (Date.parse(inv.expires_at) <= Date.now()) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVITATION_EXPIRED, message: 'Invitation has expired' } });
    }

    await query(
      'UPDATE invitations SET accepted_at = now(), updated_at = now() WHERE id = $1',
      [inv.id]
    );

    const workspaceId = inv.workspace_id;
    await query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, sessionAuth.user.id, inv.role]
    );

    // §8.1 — acceptance completes the pick: workspace-scoped session, old
    // pre-workspace session revoked.
    const scoped = await createSession(sessionAuth.user.id, workspaceId);
    await revokeSession(sessionAuth.sessionToken);
    setSessionCookie(reply, scoped.token);

    const wsResult = await query<{ name: string; slug: string | null }>(
      'SELECT name, slug FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    await emitAuditEvent(workspaceId, sessionAuth.user.id, AUDIT_ACTIONS.MEMBER_INVITED, 'invitation', inv.id, {
      accepted: true,
      accepted_by: sessionAuth.user.id,
    });

    return {
      data: {
        workspace: { id: workspaceId, name: wsResult.rows[0]?.name ?? '', slug: wsResult.rows[0]?.slug ?? null },
        membership: { workspace_id: workspaceId, user_id: sessionAuth.user.id, role: inv.role },
        csrf_token: scoped.csrf_token,
      },
    };
  });

  // Get CSRF token
  fastify.get('/auth/csrf', { preHandler: requireAuth }, async (request) => {
    return { data: { csrf_token: request.auth!.csrfToken } };
  });
}
