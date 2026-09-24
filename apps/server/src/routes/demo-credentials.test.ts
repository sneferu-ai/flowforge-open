/**
 * Contract tests for GET /demo/credentials (§9/§10.4).
 *
 * The route is ALWAYS registered (a conditionally absent route would be
 * answered by the SPA catch-all with 200 HTML — the exact failure the
 * in-handler 404 exists to prevent). It returns the configured pair verbatim
 * when demo seeding is enabled and a JSON 404 otherwise. The handler's only
 * dependency is getDemoSettings() — no DB, no direct process.env reads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoRoutes } from './demo.js';

const DEMO_VARS = ['FF_SEED_DEMO', 'FF_DEMO_EMAIL', 'FF_DEMO_PASSWORD'] as const;
const backup: Record<string, string | undefined> = {};

let app: FastifyInstance;

async function boot(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  await instance.register(demoRoutes);
  await instance.ready();
  return instance;
}

describe('GET /demo/credentials', () => {
  beforeEach(async () => {
    for (const key of DEMO_VARS) {
      backup[key] = process.env[key];
      delete process.env[key];
    }
    app = await boot();
  });

  afterEach(async () => {
    await app.close();
    for (const key of DEMO_VARS) {
      if (backup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = backup[key];
      }
    }
  });

  it('returns the committed defaults as raw JSON when enabled', async () => {
    process.env.FF_SEED_DEMO = 'true';
    const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ email: 'demo@acme.test', password: 'demo-pass-2026' });
  });

  it('echoes overridden env values verbatim', async () => {
    process.env.FF_SEED_DEMO = 'true';
    process.env.FF_DEMO_EMAIL = 'ops@demo.test';
    process.env.FF_DEMO_PASSWORD = 'custom-pass-99';
    const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'ops@demo.test', password: 'custom-pass-99' });
  });

  it('echoes a whitespace-significant password verbatim', async () => {
    process.env.FF_SEED_DEMO = 'true';
    process.env.FF_DEMO_PASSWORD = 'my pass 2026';
    const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { password: string }).password).toBe('my pass 2026');
  });

  it('predicate matrix: "1", "TRUE", and padded "  true  " enable', async () => {
    for (const flag of ['1', 'TRUE', '  true  ']) {
      process.env.FF_SEED_DEMO = flag;
      const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
      expect(res.statusCode, flag).toBe(200);
    }
  });

  it('predicate matrix: "0", "false", "yes", and unset answer 404 (narrowing)', async () => {
    for (const flag of ['0', 'false', 'yes']) {
      process.env.FF_SEED_DEMO = flag;
      const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
      expect(res.statusCode, flag).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
    delete process.env.FF_SEED_DEMO;
    const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
    expect(res.statusCode).toBe(404);
  });

  it('the disabled 404 is JSON, never SPA-fallback HTML', async () => {
    delete process.env.FF_SEED_DEMO;
    const res = await app.inject({ method: 'GET', url: '/demo/credentials' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('text/html');
    expect(res.body).not.toContain('<!DOCTYPE');
    expect(res.body).not.toContain('<html');
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('the demo data siblings keep working beside it (no route shadowing)', async () => {
    process.env.FF_SEED_DEMO = 'true';
    const res = await app.inject({ method: 'GET', url: '/demo/clients' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { clients: unknown[] }).clients)).toBe(true);
  });
});

describe('demo credentials route source pins', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'demo.ts'),
    'utf-8'
  );

  it('handler resolves through getDemoSettings() and checks settings.enabled', () => {
    expect(source).toContain(`import { getDemoSettings } from '../env-bootstrap.js'`);
    expect(source).toContain('const settings = getDemoSettings()');
    expect(source).toContain('if (!settings.enabled)');
    // The enabled check must flow through getDemoSettings() — the handler
    // never calls the raw predicate itself.
    expect(source).not.toContain('isDemoSeedEnabled(');
  });

  it('handler returns settings.email and settings.password from the resolved settings', () => {
    expect(source).toContain('return { email: settings.email, password: settings.password }');
  });

  it('route file never reads process.env.FF_DEMO_EMAIL / FF_DEMO_PASSWORD directly', () => {
    expect(source).not.toMatch(/process\.env\.FF_DEMO_EMAIL/);
    expect(source).not.toMatch(/process\.env\.FF_DEMO_PASSWORD/);
  });

  it('no logger call in the handler references the password', () => {
    const handlerStart = source.indexOf(`fastify.get('/demo/credentials'`);
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = source.slice(handlerStart);
    const logCalls = handler.match(/(?:console|logger?|log)\.\w+\([^)]*\)/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toContain('password');
      expect(call).not.toContain('settings.password');
    }
  });
});
