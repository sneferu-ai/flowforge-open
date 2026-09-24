/**
 * Standalone worker (§4.2) — BullMQ run consumer, scheduler tick, and outbox
 * dispatcher. Uses the same service modules as the embedded server so the two
 * modes execute runs identically. Health endpoints /healthz + /readyz per §4.2.
 */

// MUST be imported before any server module that reads FF_VAULT_KEY etc.
import '@flowforge/server/env-bootstrap';

import Fastify from 'fastify';
import { Pool } from 'pg';
import { startRunConsumer } from '@flowforge/server/services/queue';
import { setupScheduler } from '@flowforge/server/services/scheduler';
import { setupNotificationProcessor } from '@flowforge/server/services/notification-processor';
import { startSystemJobConsumer } from '@flowforge/server/services/system-jobs';

const dbUrl = process.env.FF_DATABASE_URL;
if (!dbUrl) {
  console.error('[worker] FF_DATABASE_URL is required');
  process.exit(1);
}
const port = parseInt(process.env.FF_WORKER_PORT || '8081', 10);

const pool = new Pool({ connectionString: dbUrl });

// Run consumer — durable executor shared with the embedded server.
const runConsumer = startRunConsumer(pool);

// System-jobs consumer (§7) — billing_period_close + retention_purge.
const systemJobConsumer = startSystemJobConsumer();

// DB-led scheduler tick (§6.3) — Redis-lock serialized, so the redundant
// server-side ticker and this one can never double-fire.
const scheduler = setupScheduler();

// Outbox dispatcher (§7/§4.1) — notification_outbox delivery + retries.
const notificationProcessor = setupNotificationProcessor();

// Health endpoints
const healthApp = Fastify();

healthApp.get<{ Reply: { status: string } }>('/healthz', async () => {
  return { status: 'ok' };
});

healthApp.get<{ Reply: { status: string; checks: Record<string, boolean> } }>('/readyz', async (_req, reply) => {
  const CHECK_TIMEOUT_MS = 1500;
  const withTimeout = <T>(p: Promise<T>, ms: number, fb: T): Promise<T> =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fb), ms))]);

  const pgOk = (async () => {
    try { await pool.query('SELECT 1'); return true; } catch { return false; }
  })();

  const redisOk = (async () => {
    try {
      const { checkRedis } = await import('@flowforge/server/services/redis');
      return await checkRedis(CHECK_TIMEOUT_MS);
    } catch { return false; }
  })();

  const [postgres, redis] = await Promise.all([
    withTimeout(pgOk, CHECK_TIMEOUT_MS, false),
    withTimeout(redisOk, CHECK_TIMEOUT_MS, false),
  ]);

  const checks: Record<string, boolean> = { postgres, redis };
  const ready = checks.postgres && checks.redis;
  if (!ready) return reply.code(503).send({ status: 'not_ready', checks });
  return { status: 'ok', checks };
});

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down…`);
  scheduler.stop();
  notificationProcessor.stop();
  await systemJobConsumer.close();
  await runConsumer.close();
  await healthApp.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start
await healthApp.listen({ port, host: '0.0.0.0' });
console.log(`[worker] health endpoints on :${port}`);
console.log('[worker] BullMQ consumer + scheduler + outbox dispatcher started');
