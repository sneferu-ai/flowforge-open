/**
 * Health check routes — liveness and readiness, plus the plain /health alias
 * used by the local packaging/e2e harness.
 */

import type { FastifyInstance } from 'fastify';
import { getPool } from '../db/pool.js';
import { checkMigrationsApplied } from '../db/migration-runner.js';
import { checkRedis } from '../services/redis.js';

async function dbOk(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Race a promise against a timeout, returning fallback if the timeout fires
 * first. This guarantees the /readyz handler responds within a bounded time
 * even when a downstream service (Redis, Postgres) is slow to connect.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const livenessHandler = async () => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', timestamp: new Date().toISOString() };
    }
  };

  // Liveness: process is serving (§4.3, < 5s)
  fastify.get('/health', livenessHandler);
  fastify.get('/healthz', livenessHandler);

  // Readiness: Postgres + Redis + migrations ready (§4.3, < 30s).
  //
  // All three checks run in PARALLEL with a per-check timeout cap of 1500ms.
  // This ensures the handler always responds within ~1.6s — well under the
  // SOD readiness probe's 2.0s per-request timeout — even when Redis is
  // unreachable and its socket probe would otherwise block for 3s.
  // Previous sequential execution (dbOk → checkRedis(3s) → migrations)
  // could take 3+ seconds, causing every readiness probe to time out and
  // the server to never become "ready" from the orchestrator's perspective.
  fastify.get('/readyz', async (_request, reply) => {
    const CHECK_TIMEOUT_MS = 1500;

    const [postgres, redis, migrations] = await Promise.all([
      withTimeout(dbOk(), CHECK_TIMEOUT_MS, false),
      withTimeout(checkRedis(CHECK_TIMEOUT_MS), CHECK_TIMEOUT_MS, false),
      withTimeout(checkMigrationsApplied(getPool()), CHECK_TIMEOUT_MS, false),
    ]);

    const checks = { postgres, redis, migrations };
    const ready = checks.postgres && checks.migrations && checks.redis;
    if (!ready) {
      return reply.code(503).send({
        status: 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
