/**
 * Regression test for the /readyz handler timeout (repair round 2026-09-20).
 *
 * Root cause: the readiness handler ran dbOk → checkRedis(3s) →
 * checkMigrationsApplied SEQUENTIALLY. When Redis was slow to connect,
 * the handler took 3+ seconds, exceeding the SOD readiness probe's 2.0s
 * per-request timeout. Every probe timed out (ReadTimeout) and the server
 * never became "ready" from the orchestrator's perspective — even though
 * /healthz returned 200 in <1ms.
 *
 * Fix: all three checks run in PARALLEL via Promise.all, each capped by a
 * 1500ms withTimeout race. Total handler time is max(1500ms) ≈ 1.5s,
 * comfortably under the 2.0s probe timeout.
 *
 * This test pins:
 *   1. The health route source uses Promise.all (parallel, not sequential).
 *   2. The per-check timeout is ≤ 1500ms.
 *   3. checkRedis accepts a timeout parameter (backward-compatible default).
 *   4. The withTimeout pattern actually resolves within the bounded time
 *      even when the inner promise never settles.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('/readyz parallel-check timeout regression', () => {
  const healthSrc = readFileSync(
    join(root, 'apps/server/src/routes/health.ts'),
    'utf-8',
  );
  const redisSrc = readFileSync(
    join(root, 'apps/server/src/services/redis.ts'),
    'utf-8',
  );

  it('uses Promise.all to run readiness checks in parallel', () => {
    expect(healthSrc).toContain('Promise.all');
  });

  it('does NOT run checks sequentially with await-per-line', () => {
    // The old pattern was:
    //   const checks = { postgres: await dbOk(), redis: await checkRedis(), ... };
    // The new pattern uses Promise.all with destructuring.
    expect(healthSrc).not.toMatch(
      /postgres:\s*await\s+dbOk\(\)/,
    );
  });

  it('caps each check at ≤ 1500ms via withTimeout', () => {
    expect(healthSrc).toContain('withTimeout');
    const match = healthSrc.match(/CHECK_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const timeoutMs = parseInt(match![1], 10);
    expect(timeoutMs).toBeLessThanOrEqual(1500);
  });

  it('checkRedis accepts a timeout parameter with a backward-compatible default', () => {
    expect(redisSrc).toMatch(/checkRedis\s*\(\s*timeoutMs\s*=\s*\d+\s*\)/);
  });

  it('checkRedis default timeout is ≤ 1500ms (was 3000ms)', () => {
    const match = redisSrc.match(/checkRedis\s*\(\s*timeoutMs\s*=\s*(\d+)\s*\)/);
    expect(match).not.toBeNull();
    const defaultMs = parseInt(match![1], 10);
    expect(defaultMs).toBeLessThanOrEqual(1500);
  });

  it('withTimeout pattern resolves within the bounded time when inner promise never settles', async () => {
    // Reproduce the exact pattern used in the health route
    const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    // A promise that never resolves (simulates Redis socket hang)
    const neverSettles = new Promise<boolean>(() => { /* never resolves */ });
    const start = Date.now();
    const result = await withTimeout(neverSettles, 1500, false);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    // Should resolve in ~1500ms, not 3000ms (the old Redis timeout)
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(2000);
  });

  it('withTimeout returns the real result when the inner promise resolves first', async () => {
    const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);

    const fastPromise = Promise.resolve(true);
    const result = await withTimeout(fastPromise, 1500, false);
    expect(result).toBe(true);
  });

  it('readyz responds 503 (never 500) when Postgres is unreachable and Redis is unset', async () => {
    // Behavioral pin of the API contract (§9: GET /readyz → 200 or 503).
    // A rejection escaping the handler would make Fastify answer 500, which
    // the readiness probe then misreads — the exact incident this fix closes.
    process.env.FF_DATABASE_URL = 'postgres://flowforge:flowforge@127.0.0.1:65534/ff_nowhere';
    delete process.env.FF_REDIS_URL;

    const { default: Fastify } = await import('fastify');
    const { healthRoutes } = await import('../apps/server/src/routes/health.js');

    const app = Fastify();
    await healthRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { status: string; checks: Record<string, boolean> };
    expect(body.status).toBe('not_ready');
    expect(body.checks).toEqual({ postgres: false, redis: false, migrations: false });

    await app.close();
  });
});
