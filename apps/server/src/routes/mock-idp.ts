/**
 * Mock IdP (§8.6, §9) — a fully provable OIDC identity provider for the demo.
 *
 * Endpoints (non-API, mounted at root per §4.3):
 *   GET  /.well-known/openid-configuration
 *   GET  /authorize        — login form (state/nonce echoed back)
 *   POST /authorize        — issues a one-time code, redirects to redirect_uri
 *   POST /token            — authorization_code → access_token + HS256 id_token
 *   GET  /userinfo         — Bearer access_token → claims
 *   GET  /logout           — back to the app
 *
 * The code/access_token store is process-local (embedded mode is a single
 * process, §4.2); tokens are signed with FF_OIDC_SIGNING_KEY (§4.4). The mock
 * is deliberately self-contained: no database reads, so the whole flow is
 * hermetically testable. The real-IdP direction is the auth/oidc login flow
 * with RS256/ES256 verification (auth/oidc.ts, bundled RSA test keypair).
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { signIdTokenHs256 } from '../auth/oidc.js';

interface AuthorizationRequest {
  state?: string;
  nonce?: string;
  client_id?: string;
  redirect_uri?: string;
}

interface AuthCode {
  sub: string;
  email: string;
  name: string;
  nonce?: string;
  client_id: string;
  redirect_uri: string;
  expiresAt: number;
}

const CODES = new Map<string, AuthCode>(); // code → pending authorization
const ACCESS = new Map<string, AuthCode>(); // access_token → session
const CODE_TTL_MS = 10 * 60 * 1000;

export function mockIssuerUrl(): string {
  const base = process.env.FF_APP_URL || 'http://localhost:8080';
  return `${base.replace(/\/+$/, '')}/mock-idp`;
}

export async function mockIdpRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/mock-idp/.well-known/openid-configuration', async () => {
    const issuer = mockIssuerUrl();
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      end_session_endpoint: `${issuer}/logout`,
      response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['HS256'],
      subject_types_supported: ['public'],
      scopes_supported: ['openid', 'email', 'profile'],
      claims_supported: ['sub', 'email', 'name', 'email_verified', 'nonce'],
    };
  });

  fastify.get('/mock-idp/authorize', async (request, reply) => {
    const query = (request.query ?? {}) as AuthorizationRequest;
    if (!query.client_id || !query.redirect_uri) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' });
    }
    reply.type('text/html; charset=utf-8');
    return loginForm(query);
  });

  fastify.post('/mock-idp/authorize', async (request, reply) => {
    // The webhook string content-type parser hands form posts through as raw
    // strings — parse both shapes here.
    const rawBody = request.body as unknown;
    const body: Record<string, unknown> =
      typeof rawBody === 'string' && rawBody.length > 0
        ? Object.fromEntries(new URLSearchParams(rawBody).entries())
        : (rawBody as Record<string, unknown>) ?? {};
    const query = (request.query ?? {}) as AuthorizationRequest;
    const state = String(body.state ?? query.state ?? '');
    const nonce = String(body.nonce ?? query.nonce ?? '');
    const clientId = String(body.client_id ?? query.client_id ?? '');
    const redirectUri = String(body.redirect_uri ?? query.redirect_uri ?? '');
    const email = String(body.email ?? request.headers['x-demo-email'] ?? 'demo@acme.test');

    if (!clientId || !redirectUri) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: 'invalid_request', error_description: 'a valid email is required' });
    }
    // Loopback-only guard: never bounce back to an arbitrary host.
    const target = new URL(redirectUri);
    if (target.hostname !== 'localhost' && target.hostname !== '127.0.0.1' && target.hostname !== '[::1]') {
      const appUrl = process.env.FF_APP_URL ? (() => { try { return new URL(process.env.FF_APP_URL).hostname; } catch { return ''; } })() : '';
      if (!appUrl || target.hostname !== appUrl) {
        return reply.code(400).send({ error: 'invalid_request', error_description: 'redirect_uri host is not the app' });
      }
    }

    const code = randomUUID();
    const name = email.split('@')[0].replace(/[._-]+/g, ' ');
    CODES.set(code, {
      sub: email,
      email,
      name,
      ...(nonce ? { nonce } : {}),
      client_id: clientId,
      redirect_uri: redirectUri,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', code);
    if (state) redirect.searchParams.set('state', state);
    return reply.code(302).redirect(redirect.toString());
  });

  fastify.post('/mock-idp/token', async (request, reply) => {
    const rawBody = request.body as unknown;
    const body: Record<string, unknown> =
      typeof rawBody === 'string' && rawBody.length > 0
        ? Object.fromEntries(new URLSearchParams(rawBody).entries())
        : (rawBody as Record<string, unknown>) ?? {};
    if (body.grant_type !== 'authorization_code') {
      return reply.code(400).send({ error: 'unsupported_grant_type' });
    }
    const code = CODES.get(String(body.code ?? ''));
    if (!code || code.expiresAt < Date.now() || (body.client_id && code.client_id !== body.client_id)) {
      return reply.code(400).send({ error: 'invalid_grant' });
    }
    CODES.delete(String(body.code ?? ''));

    const accessToken = randomUUID();
    ACCESS.set(accessToken, code);
    const nowS = Math.floor(Date.now() / 1000);
    const idToken = signIdTokenHs256({
      iss: mockIssuerUrl(),
      sub: code.email,
      aud: code.client_id,
      exp: nowS + 600,
      iat: nowS,
      ...(code.nonce ? { nonce: code.nonce } : {}),
      email: code.email,
      name: code.name,
      email_verified: true,
    });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 600,
      id_token: idToken,
    };
  });

  fastify.get('/mock-idp/userinfo', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = ACCESS.get(token);
    if (!session) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'invalid_token' });
    }
    return {
      sub: session.sub,
      email: session.email,
      name: session.name,
      email_verified: true,
    };
  });

  fastify.get('/mock-idp/logout', async (_request, reply) => {
    const app = process.env.FF_APP_URL || '/';
    return reply.code(302).redirect(app);
  });
}

function loginForm(req: AuthorizationRequest): string {
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  const state = req.state ?? '';
  const nonce = req.nonce ?? '';
  const clientId = req.client_id ?? '';
  const redirectUri = req.redirect_uri ?? '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>FlowForge Mock IdP — Sign in</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; width: 360px; }
  label { display: block; font-size: 13px; color: #94a3b8; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; background: #0f172a; border: 1px solid #475569; color: #e2e8f0; border-radius: 8px; padding: 10px; }
  button { margin-top: 20px; width: 100%; background: #6366f1; border: 0; color: white; font-weight: 600; border-radius: 8px; padding: 12px; cursor: pointer; }
</style></head>
<body>
<form method="post" action="/mock-idp/authorize" data-testid="mock-idp-login-form">
  <h1 style="font-size:18px; margin:0 0 4px;">FlowForge Mock IdP</h1>
  <p style="font-size:13px; color:#94a3b8; margin:0;">Demo identity provider (HS256). Any email signs in.</p>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" value="demo@acme.test" required autofocus />
  <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
  <input type="hidden" name="state" value="${escapeHtml(state)}" />
  <input type="hidden" name="nonce" value="${escapeHtml(nonce)}" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;
}
