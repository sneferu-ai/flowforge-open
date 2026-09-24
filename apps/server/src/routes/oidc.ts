/**
 * OIDC provider management (§8.6, §9) — Studio-gated in the real product;
 * this route manages provider records (secret encrypted at rest) AND the
 * pre-workspace SSO login flow (mock IdP fully provable; real IdPs through
 * discovery + RS256/ES256 id_token verification).
 * Live round-trips with real IdPs require an external provider (§15).
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { encryptWithMeta } from '../crypto.js';
import { createSession, getSessionCookieName, getSessionDuration } from '../auth/session.js';
import { verifyIdToken } from '../auth/oidc.js';
import { mockIssuerUrl } from './mock-idp.js';
import { getSharedRedis } from '../services/queue.js';
import { getPlanDefinition } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS } from '@flowforge/shared';

const OIDC_STATE_TTL_S = 600;
const OIDC_SCOPE = 'openid email profile';

interface ProviderRow {
  id: string;
  name: string;
  issuer_url: string;
  client_id: string;
  enabled: boolean;
}

function appBaseUrl(): string {
  const base = process.env.FF_APP_URL;
  if (!base) throw new Error('FF_APP_URL is required for OIDC login (§4.4)');
  return base.replace(/\/+$/, '');
}

function normalizeIssuer(url: string): string {
  return url.replace(/\/+$/, '');
}

function isMockProvider(issuerUrl: string): boolean {
  try {
    const issuer = new URL(normalizeIssuer(issuerUrl));
    const app = new URL(appBaseUrl());
    const mock = new URL(mockIssuerUrl());
    return issuer.hostname === app.hostname &&
      (issuer.pathname === mock.pathname || issuer.pathname.includes('/mock-idp'));
  } catch {
    return false;
  }
}

export async function oidcRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/oidc/providers', { preHandler: requireAuth }, async (request) => {
    const result = await query(
      `SELECT id, name, issuer_url, client_id, created_at::text
       FROM oidc_providers WHERE workspace_id = $1 ORDER BY name`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  fastify.post('/oidc/providers', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_OIDC)],
  }, async (request, reply) => {
    const { name, issuer_url, client_id, client_secret } = request.body as {
      name: string;
      issuer_url: string;
      client_id: string;
      client_secret: string;
    };

    // Studio-gated (§3.3 plan table: OIDC gated at Studio)
    const ws = await query<{ plan_id: string }>('SELECT plan_id FROM workspaces WHERE id = $1', [request.auth!.workspaceId]);
    const plan = getPlanDefinition(ws.rows[0]?.plan_id ?? 'free');
    if (!plan || plan.id !== 'studio') {
      return reply.code(403).send({
        error: { code: ERROR_CODES.PLAN_FEATURE_REQUIRED, message: 'OIDC SSO requires the Studio plan' },
      });
    }

    if (!name || !issuer_url || !client_id || !client_secret) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name, issuer_url, client_id, and client_secret are required' },
      });
    }
    try {
      const sealed = encryptWithMeta(client_secret, request.auth!.workspaceId);
      const result = await query<{ id: string }>(
        `INSERT INTO oidc_providers (workspace_id, name, issuer_url, client_id, client_secret_enc, client_secret_nonce, client_secret_key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [request.auth!.workspaceId, name, issuer_url, client_id, sealed.valueEnc, sealed.nonce, sealed.keyVersion]
      );
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.OIDC_PROVIDER_ADDED, 'oidc_provider', result.rows[0].id, { name, issuer_url });
      return { data: { id: result.rows[0].id, name, issuer_url, client_id } };
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        return reply.code(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'A provider with this name already exists' } });
      }
      throw err;
    }
  });

  fastify.delete('/oidc/providers/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_OIDC)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      'DELETE FROM oidc_providers WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Provider not found' } });
    }
    await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.OIDC_PROVIDER_REMOVED, 'oidc_provider', id, {});
    return { data: { ok: true } };
  });

  // --- Pre-workspace SSO login flow (§8.6/§9) ---

  /** §8.6 — workspace-agnostic provider resolution for login. */
  async function resolveLoginProvider(name: string): Promise<ProviderRow | null> {
    const result = await query<ProviderRow>(
      `SELECT id, name, issuer_url, client_id, enabled
       FROM oidc_providers WHERE name = $1 AND enabled = true
       ORDER BY created_at LIMIT 1`,
      [name]
    );
    return result.rows[0] ?? null;
  }

  // GET /auth/oidc/:provider/login — mint state/nonce, redirect to the IdP.
  fastify.get('/auth/oidc/:provider/login', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const row = await resolveLoginProvider(provider);
    if (!row) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'No enabled OIDC provider with that name' } });
    }

    // §8.6 — state (Redis, 600s TTL, fail-closed) + nonce (in the ID token).
    const state = randomUUID();
    const nonce = randomUUID();
    try {
      await getSharedRedis().set(`ff:oidc:state:${state}`, nonce, 'EX', OIDC_STATE_TTL_S);
    } catch {
      return reply.code(503).send({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'OIDC state store unavailable' } });
    }

    const redirectUri = `${appBaseUrl()}/api/v1/auth/oidc/${provider}/callback`;
    const authorizeUrl = new URL(
      '/authorize',
      isMockProvider(row.issuer_url) ? normalizeIssuer(row.issuer_url) : `${normalizeIssuer(row.issuer_url)}/`
    );
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', row.client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', OIDC_SCOPE);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('nonce', nonce);

    return reply.code(302).redirect(authorizeUrl.toString());
  });

  // GET /auth/oidc/:provider/callback — validate state, exchange code, verify
  // the id_token, upsert the identity, and start a pre-workspace session.
  fastify.get('/auth/oidc/:provider/callback', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const { code, state } = (request.query ?? {}) as { code?: string; state?: string };

    if (!code || !state) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'code and state are required' } });
    }
    // §8.6 — state must exist in Redis; one-time use, deleted on read.
    let nonce: string | null = null;
    try {
      nonce = await getSharedRedis().getdel(`ff:oidc:state:${state}`);
    } catch {
      nonce = null;
    }
    if (nonce === null) {
      return reply.code(400).send({ error: { code: ERROR_CODES.INVALID_STATE, message: 'OIDC state missing or expired' } });
    }

    const row = await resolveLoginProvider(provider);
    if (!row) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'No enabled OIDC provider with that name' } });
    }

    // Token exchange — the provider's issuer path IS the token endpoint
    // (mock and real providers alike: {issuer}/token per OIDC discovery).
    const issuer = normalizeIssuer(row.issuer_url);
    const tokenUrl = `${issuer}/token`;
    const userinfoUrl = `${issuer}/userinfo`;

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: row.client_id,
          redirect_uri: `${appBaseUrl()}/api/v1/auth/oidc/${provider}/callback`,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return reply.code(502).send({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'OIDC token endpoint unreachable' } });
    }
    const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
      id_token?: string;
      access_token?: string;
    };
    if (!tokenResponse.ok || !tokenBody.id_token) {
      return reply.code(401).send({
        error: { code: ERROR_CODES.INVALID_SIGNATURE, message: 'OIDC token exchange failed' },
      });
    }

    // id_token verification: alg family (HS256 mock / RS256+ES256 real),
    // iss, aud, exp, nonce (§8.6, §9 test plan 37).
    let claims: { sub: string; email?: string; name?: string };
    try {
      claims = await verifyIdToken(tokenBody.id_token, {
        issuer: normalizeIssuer(row.issuer_url),
        audience: row.client_id,
        expectedNonce: nonce,
      });
    } catch (err) {
      return reply.code(401).send({
        error: {
          code: err instanceof Error && err.message.includes('nonce') ? ERROR_CODES.INVALID_NONCE : ERROR_CODES.INVALID_SIGNATURE,
          message: `id_token verification failed: ${(err as Error).message}`,
        },
      });
    }

    let email = claims.email ?? '';
    let name = claims.name ?? '';
    if (tokenBody.access_token && (!email || !name)) {
      try {
        const infoResponse = await fetch(userinfoUrl, {
          headers: { Authorization: `Bearer ${tokenBody.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (infoResponse.ok) {
          const info = (await infoResponse.json()) as { email?: string; name?: string };
          email = email || info.email || '';
          name = name || info.name || '';
        }
      } catch {
        /* userinfo best-effort — identity still boots from verified claims */
      }
    }
    const subject = claims.sub;

    // Upsert the user by OIDC identity; new users get an unusable random
    // password hash (SSO-only accounts never touch the password path).
    let userId: string;
    const identity = await query<{ user_id: string }>(
      'SELECT user_id FROM oidc_identities WHERE provider = $1 AND subject = $2',
      [provider, subject]
    );
    if (identity.rows.length > 0) {
      userId = identity.rows[0].user_id;
    } else {
      const existingUser = email
        ? await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
        : { rows: [] as Array<{ id: string }> };
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
      } else {
        const randomPassword = `ssnly-${randomUUID()}${randomUUID()}`;
        const passwordHash = await argon2.hash(randomPassword, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        const created = await query<{ id: string }>(
          'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
          [email.toLowerCase(), passwordHash, name || email.split('@')[0]]
        );
        userId = created.rows[0].id;
      }
      await query(
        `INSERT INTO oidc_identities (user_id, provider, subject)
         VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING`,
        [userId, provider, subject]
      );
    }

    const session = await createSession(userId, null);
    reply.setCookie(getSessionCookieName(), session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: getSessionDuration() / 1000,
    });

    const wsCount = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM workspace_members WHERE user_id = $1',
      [userId]
    );
    if (wsCount.rows[0]?.n === 1) {
      // Single-workspace members skip the picker (§8.1 the common SSO case).
      const onlyWs = await query<{ workspace_id: string }>(
        'SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1',
        [userId]
      );
      await query('UPDATE sessions SET workspace_id = $1 WHERE id = $2', [onlyWs.rows[0].workspace_id, session.id]);
    }

    // §8.6 — the audit ledger is workspace-scoped; pre-workspace logins emit
    // under the user's first workspace (or skip for brand-new users, whose
    // first workspace does not exist yet).
    const auditWs = await query<{ workspace_id: string }>(
      'SELECT workspace_id FROM workspace_members WHERE user_id = $1 ORDER BY created_at LIMIT 1',
      [userId]
    );
    if (auditWs.rows.length > 0) {
      await emitAuditEvent(auditWs.rows[0].workspace_id, userId, AUDIT_ACTIONS.USER_LOGIN, 'user', userId, { provider, subject });
    }
    return reply.code(302).redirect('/select-workspace');
  });

  // GET /auth/oidc/:provider/logout — end the app session, then the IdP's.
  fastify.get('/auth/oidc/:provider/logout', async (request, reply) => {
    const sessionToken = request.cookies[getSessionCookieName()];
    if (sessionToken) {
      const tokenHash = createHash('sha256').update(sessionToken, 'utf-8').digest('hex');
      await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
    }
    reply.clearCookie(getSessionCookieName(), { path: '/' });
    const row = await resolveLoginProvider((request.params as { provider: string }).provider);
    if (row && isMockProvider(row.issuer_url)) {
      return reply.code(302).redirect(`${normalizeIssuer(row.issuer_url)}/logout`);
    }
    return reply.code(302).redirect('/');
  });
}
