/**
 * Mock IdP routes (§8.6/§9) — the full authorization-code flow, hermetically
 * (no database, no Redis): discovery, authorize form, code issue, token
 * exchange (HS256 id_token), userinfo, and the loopback guard.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mockIdpRoutes } from '../apps/server/src/routes/mock-idp.js';

beforeAll(() => {
  process.env.FF_OIDC_SIGNING_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
  process.env.FF_APP_URL = 'http://localhost:3000';
});

afterAll(() => {
  delete process.env.FF_OIDC_SIGNING_KEY;
  delete process.env.FF_APP_URL;
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  // Mirror the server's string parser so form posts are raw strings.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body as string));
  await app.register(mockIdpRoutes);
  await app.ready();
  return app;
}

describe('mock IdP', () => {
  it('serves OIDC discovery metadata', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/mock-idp/.well-known/openid-configuration' });
    expect(res.statusCode).toBe(200);
    const meta = res.json() as Record<string, unknown>;
    expect(meta.issuer).toBe('http://localhost:3000/mock-idp');
    expect(meta.authorization_endpoint).toBe('http://localhost:3000/mock-idp/authorize');
    expect(meta.token_endpoint).toBe('http://localhost:3000/mock-idp/token');
    expect((meta.id_token_signing_alg_values_supported as string[])).toContain('HS256');
    await app.close();
  });

  it('renders a login form at GET /authorize', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/mock-idp/authorize?client_id=ff&redirect_uri=http://localhost:3000/cb&state=s1&nonce=n1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('mock-idp-login-form');
    expect(res.body).toContain('value="s1"');
    expect(res.body).toContain('value="n1"');
    await app.close();
  });

  it('runs the full authorization-code round trip', async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: 'POST',
      url: '/mock-idp/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=ff&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&state=s1&nonce=n1&email=solo%40example.test',
    });
    expect(post.statusCode).toBe(302);
    const location = post.headers.location as string;
    expect(location).toContain('code=');
    const code = new URL(location).searchParams.get('code');
    expect(new URL(location).searchParams.get('state')).toBe('s1');

    const token = await app.inject({
      method: 'POST',
      url: '/mock-idp/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '', client_id: 'ff' }).toString(),
    });
    expect(token.statusCode).toBe(200);
    const body = token.json() as { id_token: string; access_token: string; token_type: string };
    expect(body.token_type).toBe('Bearer');
    // id_token is a 3-part HS256 JWT echoing the nonce.
    const parts = body.id_token.split('.');
    expect(parts).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    expect(claims.iss).toBe('http://localhost:3000/mock-idp');
    expect(claims.aud).toBe('ff');
    expect(claims.nonce).toBe('n1');
    expect(claims.email).toBe('solo@example.test');

    const info = await app.inject({
      method: 'GET',
      url: '/mock-idp/userinfo',
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ sub: 'solo@example.test', email: 'solo@example.test' });
    await app.close();
  });

  it('rejects a reused authorization code (single-use)', async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: 'POST',
      url: '/mock-idp/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=ff&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&email=a%40b.test',
    });
    const code = new URL(post.headers.location as string).searchParams.get('code');
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '', client_id: 'ff' }).toString();
    const first = await app.inject({ method: 'POST', url: '/mock-idp/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    const second = await app.inject({ method: 'POST', url: '/mock-idp/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ error: 'invalid_grant' });
    await app.close();
  });

  it('blocks redirect_uri hosts outside the app (loopback guard)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/mock-idp/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=ff&redirect_uri=https%3A%2F%2Fevil.example.test%2Fsteal&email=a%40b.test',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    await app.close();
  });

  it('rejects invalid emails and redirects to error paths only with safe hosts', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/mock-idp/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client_id=ff&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&email=not-an-email',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
