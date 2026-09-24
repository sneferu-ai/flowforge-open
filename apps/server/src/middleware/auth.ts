/**
 * Auth middleware — session validation, CSRF, API token auth, feature gating.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession, isCsrfValid, getSessionCookieName } from '../auth/session.js';
import { query } from '../db/pool.js';
import { hasPermission, type Role, type Permission } from '@flowforge/shared';
import { featureEnabled, type FeatureKey } from '../auth/entitlements.js';
import { createHmac, createHash } from 'node:crypto';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthContext {
  user: AuthUser;
  workspaceId: string;
  role: Role;
  sessionId: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    /** Pre-workspace plane (§8.1): a valid session whose workspace may be NULL.
     *  Set by requireSession for /auth/me, /auth/select-workspace, logout. */
    sessionAuth?: SessionAuthContext;
    /** Raw request body bytes, captured by the webhook onRequest hook. */
    rawBodyBuffer?: Buffer;
    /** Raw request body string, captured by the string content-type parser. */
    rawBodyString?: string;
  }
}

export interface SessionAuthContext {
  user: AuthUser;
  sessionId: string;
  /** Session token (cookie value) — needed to revoke the pre-workspace session
   *  after a successful workspace selection. */
  sessionToken: string;
  workspaceId: string | null;
  csrfToken: string;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // --- Bearer API-token path (§8.4/§11) ---
  // CLI and external callers authenticate via Authorization: Bearer <token>.
  // The token is SHA-256 hashed and looked up in api_tokens.
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const tokenResult = await query<{ workspace_id: string; user_id: string; role_snapshot: string }>(
      `SELECT workspace_id, user_id, role_snapshot FROM api_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid API token' } });
      return;
    }

    const { workspace_id, user_id } = tokenResult.rows[0];

    // Get user details
    const userResult = await query<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [user_id]
    );
    if (userResult.rows.length === 0) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'User not found' } });
      return;
    }

    // §8.4/§8.2: API tokens carry a role_snapshot frozen at creation time.
    // The role is NOT re-resolved from workspace_members — later membership
    // changes do not affect tokens already issued.

    // Touch last_used_at only once the token proved to be a live member
    // credential, so revoked/stale lookups never phantom-bump the column.
    await query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1', [tokenHash]);

    request.auth = {
      user: userResult.rows[0],
      workspaceId: workspace_id,
      role: tokenResult.rows[0].role_snapshot as Role,
      sessionId: '',
      csrfToken: '',
    };
    return;
  }

  // --- Session cookie path (§8.1) ---
  const sessionToken = request.cookies[getSessionCookieName()];
  if (!sessionToken) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'Not authenticated' } });
    return;
  }

  const session = await getSession(sessionToken);
  if (!session) {
    reply.clearCookie(getSessionCookieName()).code(401).send({
      error: { code: 'unauthorized', message: 'Session expired' },
    });
    return;
  }

  // CSRF check for state-changing requests (§8.1).
  // The CSRF token is HMAC-SHA256(FF_SESSION_SECRET, session_token)[:32].
  if (STATE_CHANGING_METHODS.has(request.method)) {
    const csrfToken = request.headers['x-csrf-token'] as string | undefined;
    if (!(await isCsrfValid(sessionToken, csrfToken))) {
      reply.code(403).send({
        error: { code: 'csrf_token_invalid', message: 'Invalid CSRF token' },
      });
      return;
    }
  }

  // §8.1: a pre-workspace session (workspace_id NULL) only reaches workspace
  // creation/selection/logout — every workspace-scoped route rejects it.
  if (session.workspace_id == null) {
    reply.code(403).send({
      error: { code: 'workspace_not_selected', message: 'Select a workspace first (POST /auth/select-workspace)' },
    });
    return;
  }

  // Get user details
  const userResult = await query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM users WHERE id = $1',
    [session.user_id]
  );
  if (userResult.rows.length === 0) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'User not found' } });
    return;
  }

  // Get workspace membership
  const memberResult = await query<{ role: string }>(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [session.workspace_id, session.user_id]
  );
  if (memberResult.rows.length === 0) {
    reply.code(403).send({ error: { code: 'forbidden', message: 'Not a workspace member' } });
    return;
  }

  // Compute the CSRF token from the session token (deterministic via HMAC).
  const secret = process.env.FF_SESSION_SECRET || '';
  const csrfToken = createHmac('sha256', secret).update(sessionToken, 'utf-8').digest('hex').slice(0, 32);

  request.auth = {
    user: userResult.rows[0],
    workspaceId: session.workspace_id,
    role: memberResult.rows[0].role as Role,
    sessionId: session.id,
    csrfToken,
  };
}

/**
 * Pre-workspace plane (§8.1): requires a valid session but NOT a selected
 * workspace. Used by /auth/me, /auth/select-workspace. Enforces CSRF for
 * state-changing methods exactly like requireAuth.
 */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionToken = request.cookies[getSessionCookieName()];
  if (!sessionToken) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'Not authenticated' } });
    return;
  }

  const session = await getSession(sessionToken);
  if (!session) {
    reply.clearCookie(getSessionCookieName()).code(401).send({
      error: { code: 'unauthorized', message: 'Session expired' },
    });
    return;
  }

  if (STATE_CHANGING_METHODS.has(request.method)) {
    const csrfToken = request.headers['x-csrf-token'] as string | undefined;
    if (!(await isCsrfValid(sessionToken, csrfToken))) {
      reply.code(403).send({
        error: { code: 'csrf_token_invalid', message: 'Invalid CSRF token' },
      });
      return;
    }
  }

  const userResult = await query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM users WHERE id = $1',
    [session.user_id]
  );
  if (userResult.rows.length === 0) {
    reply.code(401).send({ error: { code: 'unauthorized', message: 'User not found' } });
    return;
  }

  const secret = process.env.FF_SESSION_SECRET || '';
  const csrfToken = createHmac('sha256', secret).update(sessionToken, 'utf-8').digest('hex').slice(0, 32);

  request.sessionAuth = {
    user: userResult.rows[0],
    sessionId: session.id,
    sessionToken,
    workspaceId: session.workspace_id,
    csrfToken,
  };
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'Not authenticated' } });
      return;
    }
    if (!hasPermission(request.auth.role, permission)) {
      reply.code(403).send({
        error: { code: 'forbidden', message: `Requires ${permission} permission` },
      });
      return;
    }
  };
}

/**
 * §3.3 — plan feature gate. Runs AFTER requireAuth in the preHandler chain.
 * Entitlement checks fail closed: an unavailable Redis plane denies the
 * feature with plan_feature_required.
 */
export function requireFeature(feature: FeatureKey) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.auth) {
      reply.code(401).send({ error: { code: 'unauthorized', message: 'Not authenticated' } });
      return;
    }
    const allowed = await featureEnabled(request.auth.workspaceId, feature);
    if (!allowed) {
      reply.code(403).send({
        error: {
          code: 'plan_feature_required',
          message: `The '${feature}' feature requires a plan that supports it`,
        },
      });
      return;
    }
  };
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr ?? '32', 10);

  const ipParts = ip.split('.').map(Number);
  const baseParts = base.split('.').map(Number);

  if (ipParts.length !== 4 || baseParts.length !== 4) {
    // Handle IPv6 simply — exact match
    return ip === base;
  }

  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipNum & mask) === (baseNum & mask);
}

/**
 * Client IP for ingress IP fencing. `X-Forwarded-For` is client-controllable,
 * so it is only honored when the direct peer is a TRUSTED proxy:
 * FF_TRUST_PROXY = comma-separated proxy IPs/CIDRs ("1"/"true" trusts the
 * immediate peer unconditionally — only for deployments where the server is
 * never directly reachable). Default: trust nothing, use the socket address.
 */
export function getClientIp(request: FastifyRequest): string {
  const trust = (process.env.FF_TRUST_PROXY ?? '').trim();
  if (trust && trust !== '0' && trust !== 'false') {
    const peer = request.socket?.remoteAddress ?? request.ip;
    const unconditional = trust === '1' || trust === 'true';
    const listed = !unconditional && trust.split(',').some((entry) => {
      const e = entry.trim();
      return e.length > 0 && ipInCidr(peer, e);
    });
    if (unconditional || listed) {
      const forwarded = request.headers['x-forwarded-for'] as string | undefined;
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
    }
  }
  return request.ip;
}
