/**
 * Fastify server — API server for FlowForge Open.
 *
 * API routes are mounted under BOTH /api and /api/v1 (§9 API contract),
 * non-API routes (hooks, health, mock-idp, demo, static SPA) at root.
 */

// MUST be imported before any module that reads FF_VAULT_KEY, FF_SESSION_SECRET,
// FF_OIDC_SIGNING_KEY, or FF_SEED_DEMO. Generates and persists secrets at first
// start under SOD_DATA_DIR when the deployment environment does not provide them.
import './env-bootstrap.js';
import { resolveAppUrl, isDemoSeedEnabled } from './env-bootstrap.js';

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { getPool, closePool } from './db/pool.js';
import { runMigrations } from './db/migration-runner.js';
import { authRoutes } from './routes/auth.js';
import { workflowRoutes } from './routes/workflows.js';
import { runRoutes } from './routes/runs.js';
import { triggerRoutes } from './routes/triggers.js';
import { credentialRoutes } from './routes/credentials.js';
import { memberRoutes } from './routes/members.js';
import { auditRoutes } from './routes/audit.js';
import { webhookRoutes } from './routes/webhooks.js';
import { healthRoutes } from './routes/health.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { templateRoutes } from './routes/templates.js';
import { notificationRoutes } from './routes/notifications.js';
import { secretRoutes } from './routes/webhook-secrets.js';
import { allowlistRoutes } from './routes/allowlist.js';
import { apiTokenRoutes } from './routes/api-tokens.js';
import { usageRoutes } from './routes/usage.js';
import { oidcRoutes } from './routes/oidc.js';
import { mockIdpRoutes } from './routes/mock-idp.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { publicRoutes, staticRoutes } from './routes/public.js';
import { demoRoutes } from './routes/demo.js';
import { openApiRoute } from './routes/openapi.js';
import { setupScheduler } from './services/scheduler.js';
import { setupNotificationProcessor } from './services/notification-processor.js';
import { startRunConsumer, closeQueues } from './services/queue.js';
import { startSystemJobConsumer } from './services/system-jobs.js';
import { seedPlans, seedSystemJobs, seedDemo } from './db/seed.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'error' : 'info',
    },
    bodyLimit: 256 * 1024, // 256KB for manifest size limit
  });

  // Plugins
  await fastify.register(cookie, {});
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Non-API routes at root (§4.3)
  await fastify.register(healthRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(mockIdpRoutes); // §8.6 — mock IdP lives at /mock-idp/*
  await fastify.register(publicRoutes);

  // Demo data is served at /demo/* (§9) and also under the API base so the
  // spec's canonical template URLs (`{{env.FF_APP_URL}}/api/v1/demo/...`) work.
  await fastify.register(demoRoutes);
  await fastify.register(demoRoutes, { prefix: '/api' });
  await fastify.register(demoRoutes, { prefix: '/api/v1' });

  const apiModules = [
    authRoutes,
    workflowRoutes,
    runRoutes,
    triggerRoutes,
    credentialRoutes,
    memberRoutes,
    workspaceRoutes,
    auditRoutes,
    dashboardRoutes,
    templateRoutes,
    notificationRoutes,
    secretRoutes,
    allowlistRoutes,
    apiTokenRoutes,
    usageRoutes,
    oidcRoutes,
  ];

  // Mount the API under both /api and /api/v1 (spec base path + harness base path).
  for (const module of apiModules) {
    await fastify.register(module, { prefix: '/api' });
    await fastify.register(module, { prefix: '/api/v1' });
  }

  // OpenAPI document at /openapi.json — registered BEFORE the static SPA
  // catch-all so GET /openapi.json can never be intercepted by it (§9).
  await fastify.register(openApiRoute);

  // Static SPA — catch-all for non-API routes, registered last.
  await fastify.register(staticRoutes);

  return fastify;
}

/**
 * Port precedence (§4.4): --port CLI flag > FF_PORT > PORT > default 8080.
 */
export function resolvePort(): number {
  const args = process.argv.slice(2);
  const portFlagIdx = args.indexOf('--port');
  if (portFlagIdx !== -1 && args[portFlagIdx + 1]) {
    const fromFlag = parseInt(args[portFlagIdx + 1], 10);
    if (Number.isFinite(fromFlag)) return fromFlag;
  }
  const envPort = process.env.FF_PORT || process.env.PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 8080;
}

export async function startServer() {
  const port = resolvePort();
  const host = process.env.HOST || '0.0.0.0';

  // Resolve FF_APP_URL using the actual listening port. If FF_APP_URL is
  // already set (operator override), keep it. If APP_BASE_URL is provided
  // (SOD public origin), use that. Otherwise derive from the port so demo
  // workflow HTTP steps target the correct server (not a hardcoded default).
  if (!process.env.FF_APP_URL) {
    process.env.FF_APP_URL = resolveAppUrl(port);
  }

  // Initialization (§14.3), same sequence as `seed.js all`: migrations +
  // plans (5 rows) + system jobs (7) on EVERY start, then the demo
  // workspace/data when FF_SEED_DEMO is enabled. FF_SEED_DEMO defaults to
  // '0' (spec §4.4: optional); the SOD launch proof sets it explicitly.
  // This keeps the product a single process — one entrypoint, one HTTP
  // port — and every step is idempotent (a partially-seeded database
  // self-heals).
  const pool = getPool();
  const migrationResult = await runMigrations(pool);
  if (migrationResult.applied.length > 0) {
    console.log(`Migrations: ${migrationResult.applied.length} applied, ${migrationResult.skipped.length} skipped`);
  }
  await seedPlans();
  await seedSystemJobs();
  if (isDemoSeedEnabled(process.env.FF_SEED_DEMO)) {
    await seedDemo();
  }

  // Build server
  const fastify = await buildServer();

  // §4.2 — embedded mode: API, scheduler tick, BullMQ run consumer, and the
  // outbox dispatcher share this process. Standalone mode leaves run
  // consumption + outbox dispatch to the separate worker process; the
  // scheduler tick stays here (its Redis lock serializes against the
  // worker's redundant ticker).
  const workerMode = process.env.FF_WORKER_MODE === 'standalone' ? 'standalone' : 'embedded';
  const scheduler = setupScheduler();
  const runConsumer = workerMode === 'embedded' ? startRunConsumer(getPool()) : null;
  const systemJobConsumer = workerMode === 'embedded' ? startSystemJobConsumer() : null;
  const notificationProcessor = workerMode === 'embedded' ? setupNotificationProcessor() : null;
  console.log(`FlowForge worker mode: ${workerMode}`);

  // Start listening
  await fastify.listen({ port, host });

  console.log(`FlowForge server listening on ${host}:${port}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    scheduler.stop();
    if (runConsumer) await runConsumer.close();
    if (systemJobConsumer) await systemJobConsumer.close();
    if (notificationProcessor) notificationProcessor.stop();
    await fastify.close();
    await closeQueues();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
