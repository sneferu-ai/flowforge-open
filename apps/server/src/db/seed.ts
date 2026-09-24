/**
 * Seed script — plans, subscriptions, demo workspace, and example workflows.
 * Usage: node dist/db/seed.js [plans|demo|all]
 */

// MUST be imported before crypto.ts — generates and persists secrets for
// FF_VAULT_KEY etc. when the environment does not provide them. Also the
// single resolver for the demo identity (FF_SEED_DEMO / FF_DEMO_EMAIL /
// FF_DEMO_PASSWORD) — no other module reads those env vars directly.
import { getDemoSettings, isDemoSeedEnabled } from '../env-bootstrap.js';

import { getPool, closePool } from './pool.js';
import { runMigrations } from './migration-runner.js';
import { invalidatePlanFeatureCache, closePlanFeatureCache } from '../auth/entitlements.js';
import { pathToFileURL } from 'node:url';
import { PLAN_DEFINITIONS } from '@flowforge/shared';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { encryptWithMeta } from '../crypto.js';
import { parseManifest } from '@flowforge/engine';
import { createWorkflowFromManifest, slugify } from '../routes/workflows.js';
import { TEMPLATES } from '../routes/templates.js';

export async function seedPlans() {
  const pool = getPool();
  for (const plan of PLAN_DEFINITIONS) {
    await pool.query(
      `INSERT INTO plans (id, name, price_cents, run_limit, seat_limit, overage_rate_cents,
        run_history_days, audit_retention_days, workflow_timeout_hours, rate_limit_per_min,
        concurrency_limit, feature_flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        price_cents = EXCLUDED.price_cents,
        run_limit = EXCLUDED.run_limit,
        seat_limit = EXCLUDED.seat_limit,
        overage_rate_cents = EXCLUDED.overage_rate_cents,
        run_history_days = EXCLUDED.run_history_days,
        audit_retention_days = EXCLUDED.audit_retention_days,
        workflow_timeout_hours = EXCLUDED.workflow_timeout_hours,
        rate_limit_per_min = EXCLUDED.rate_limit_per_min,
        concurrency_limit = EXCLUDED.concurrency_limit,
        feature_flags = EXCLUDED.feature_flags`,
      [
        plan.id,
        plan.name,
        plan.price_cents,
        plan.run_limit,
        plan.seat_limit,
        plan.overage_rate_cents,
        plan.run_history_days,
        plan.audit_retention_days,
        plan.workflow_timeout_hours,
        plan.rate_limit_per_min,
        plan.concurrency_limit,
        JSON.stringify(plan.feature_flags),
      ]
    );
  }
  // §3.3 — plan definitions changed; drop the cached feature flags so the
  // next entitlement check re-reads them (TTL bounds any missed invalidation).
  await Promise.all(PLAN_DEFINITIONS.map((plan) => invalidatePlanFeatureCache(plan.id)));
  console.log(`Seeded ${PLAN_DEFINITIONS.length} plans`);
}

/** §6.3/§14.3 — the seven DB-led system jobs (schedule of record). */
export async function seedSystemJobs() {
  const pool = getPool();
  const jobs: Array<{ type: string; next: string; config: Record<string, unknown> }> = [
    { type: 'billing_period_close', next: '1 month', config: { on: '1st of month 00:00 UTC' } },
    { type: 'retention_purge', next: '1 day', config: { on: 'daily 02:00 UTC' } },
    { type: 'approval_timeout_check', next: '60 seconds', config: { on: 'every 60s' } },
    { type: 'concurrency_retry', next: '30 seconds', config: { on: 'every 30s' } },
    { type: 'replay_log_cleanup', next: '5 minutes', config: { on: 'every 5m' } },
    { type: 'reconciliation', next: '60 seconds', config: { on: 'every 60s' } },
    { type: 'notification_dispatch', next: '30 seconds', config: { on: 'every 30s' } },
  ];
  for (const job of jobs) {
    await pool.query(
      `INSERT INTO system_jobs (job_type, next_run_at, config)
       VALUES ($1, now() + $2::interval, $3)
       ON CONFLICT (job_type) DO NOTHING`,
      [job.type, job.next, JSON.stringify(job.config)]
    );
  }
  console.log(`Seeded ${jobs.length} system jobs`);
}

export async function seedDemo() {
  const pool = getPool();
  // The demo identity is env-driven (§4.4/§10.4): getDemoSettings() resolves
  // FF_SEED_DEMO / FF_DEMO_EMAIL / FF_DEMO_PASSWORD with their defaults. The
  // email is already normalized (trimmed + lowercased) to match the auth
  // login route's lowercase-before-query behavior (auth.ts).
  const settings = getDemoSettings();

  // Every section is independent and idempotent: a partially-seeded database
  // self-heals on the next run instead of skipping the remainder.
  // The demo user's password hash is RECONCILED on every seed run via
  // verify-then-update: argon2.verify against settings.password decides —
  //   verify true  → zero writes (the row is byte-unchanged; a converged
  //                  restart is free, and a same-password/different-salt hash
  //                  is left exactly as stored);
  //   verify false → rewrite password_hash so the advertised credential
  //                  always authenticates (password rotation, tampered row,
  //                  or a hash from a previous default).
  const existing = await pool.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [settings.email]
  );
  let userId: string;
  if (existing.rows.length > 0) {
    userId = existing.rows[0].id;
    const matches = await argon2.verify(existing.rows[0].password_hash, settings.password);
    if (!matches) {
      const reconciledHash = await argon2.hash(settings.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      // Never touch name — an operator's rename survives reconciliation.
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
        [reconciledHash, userId]
      );
      // Clear any login-attempt lock so a prior failed-login storm doesn't
      // leave the demo account locked (HTTP 423) after the password reset.
      await pool.query('DELETE FROM login_attempts WHERE email = $1', [settings.email]);
      console.log('Demo user reconciled (password hash updated, login lock cleared)');
    }
  } else {
    // Demo user — direct SQL bypasses the password policy (spec §3.3).
    const seededHash = await argon2.hash(settings.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const userResult = await pool.query<{ id: string }>(
        'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
        [settings.email, seededHash, 'Demo User']
      );
      userId = userResult.rows[0].id;
    } catch (err) {
      // users.email carries a UNIQUE constraint (migration 001): a concurrent
      // boot that loses the insert race lands here. Adopt the winner's row
      // and continue to membership reconciliation (single-instance boot is
      // the load-bearing assumption; this only covers rolling-deploy overlap).
      if ((err as { code?: string }).code === '23505') {
        console.warn('Demo user already exists, skipping insert');
        const raced = await pool.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [settings.email]
        );
        if (raced.rows.length === 0) {
          // A 23505 with no visible row means the winning transaction rolled
          // back between our failed insert and this read — nothing to adopt.
          throw new Error(`Demo user insert raced and no row is visible for ${settings.email}`);
        }
        userId = raced.rows[0].id;
      } else {
        throw err;
      }
    }
  }

  // Demo workspace on the Demo plan with a subscriptions row (§3.3).
  // Spec §10.4: the demo workspace must be named "Acme Creative".
  const DEMO_SLUG = 'acme-creative';
  const LEGACY_SLUG = 'demo-workspace';

  // Look up by canonical slug first, then legacy slug — databases seeded
  // before the rename self-heal instead of orphaning the old workspace
  // (with its workflows, memberships, subscription, webhook secrets, etc.).
  let wsExisting = await pool.query<{ id: string; slug: string | null }>(
    'SELECT id, slug FROM workspaces WHERE slug = $1',
    [DEMO_SLUG]
  );
  if (wsExisting.rows.length === 0) {
    wsExisting = await pool.query<{ id: string; slug: string | null }>(
      'SELECT id, slug FROM workspaces WHERE slug = $1',
      [LEGACY_SLUG]
    );
  }
  let workspaceId: string;
  if (wsExisting.rows.length > 0) {
    workspaceId = wsExisting.rows[0].id;
  } else {
    const apiSecret = randomUUID() + randomUUID();
    const wsResult = await pool.query(
      `INSERT INTO workspaces (name, slug, plan_id, api_secret)
       VALUES ('Acme Creative', $1, 'demo', $2) RETURNING id`,
      [DEMO_SLUG, apiSecret]
    );
    workspaceId = wsResult.rows[0].id;
  }
  // Reconcile name and slug on every seed run — migrates legacy
  // "Demo Workspace"/"demo-workspace" rows and fills NULL slugs from
  // pre-slug-column migrations to the spec-required values.
  await pool.query(
    `UPDATE workspaces SET name = 'Acme Creative', slug = $1
     WHERE id = $2 AND (name <> 'Acme Creative' OR slug IS NULL OR slug <> $1)`,
    [DEMO_SLUG, workspaceId]
  );

  // Membership reconcile: ON CONFLICT DO UPDATE (never DO NOTHING) so a demo
  // user demoted to 'member' via the UI is restored to 'owner' on the next
  // seeded boot, and a removed membership row is re-inserted.
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`,
    [workspaceId, userId]
  );

  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1, 1);
  const sub = await pool.query('SELECT 1 FROM subscriptions WHERE workspace_id = $1', [workspaceId]);
  if (sub.rows.length === 0) {
    await pool.query(
      `INSERT INTO subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, 'demo', 'active', $2, $3)`,
      [workspaceId, periodStart, periodEnd]
    );
  }

  // Demo webhook secret, referenced by name in manifests.
  const secret = await pool.query("SELECT 1 FROM webhook_secrets WHERE workspace_id = $1 AND name = 'WH_SECRET'", [workspaceId]);
  if (secret.rows.length === 0) {
    const webhookSecretValue = randomUUID();
    const sealed = encryptWithMeta(webhookSecretValue, workspaceId);
    await pool.query(
      `INSERT INTO webhook_secrets (workspace_id, name, value_enc, nonce, key_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, 'WH_SECRET', sealed.valueEnc, sealed.nonce, sealed.keyVersion]
    );
  }

  // Five example workflows from the template gallery (§3.2, §10.4) so the
  // dashboard is alive and the spec's 5-enabled-templates requirement is met.
  // Uses the human-readable template display names (e.g. "Invoice Chaser")
  // so the workflow list shows proper names, not slug-style identifiers.
  const examples: Array<{ templateId: string; name: string }> = [
    { templateId: 'invoice-chaser', name: 'Invoice Chaser' },
    { templateId: 'client-onboarding', name: 'Client Onboarding' },
    { templateId: 'order-follow-up', name: 'Order Follow-Up' },
    { templateId: 'review-request', name: 'Review Request' },
    { templateId: 'renewal-reminder', name: 'Renewal Reminder' },
  ];
  for (const example of examples) {
    const slug = slugify(example.name);
    const already = await pool.query('SELECT 1 FROM workflows WHERE workspace_id = $1 AND slug = $2', [workspaceId, slug]);
    if (already.rows.length > 0) {
      // Reconcile the legacy slug-style name to the human-readable display
      // name. Only rows still carrying the exact legacy seed value
      // (templateId === the old seed name) are touched, so user renames are
      // never overwritten. slugify(display) === slugify(templateId), so the
      // dedup above already found pre-rename rows.
      await pool.query(
        `UPDATE workflows SET name = $1 WHERE workspace_id = $2 AND slug = $3 AND name = $4`,
        [example.name, workspaceId, slug, example.templateId]
      );
      continue;
    }
    const template = TEMPLATES.find((t) => t.id === example.templateId);
    if (!template) {
      console.warn(`Seed: template ${example.templateId} missing, skipping`);
      continue;
    }
    const manifest = parseManifest(template.manifest);
    try {
      const created = await createWorkflowFromManifest({
        workspaceId,
        name: example.name,
        summary: manifest.summary || template.summary,
        manifestYaml: template.manifest,
        manifest,
        actorId: userId,
      });
      console.log(`Seeded example workflow '${example.name}' (${created.workflowId})`);
    } catch (err) {
      console.warn(`Seed: could not create example workflow '${example.name}': ${(err as Error).message}`);
    }
  }

  console.log(`Seeded demo workspace: ${workspaceId}`);
  console.log(`Demo user: ${settings.email}`);
}

async function main() {
  const target = process.argv[2] || 'all';

  try {
    if (target === 'all' || target === 'migrate') {
      const result = await runMigrations(getPool());
      console.log(`Migrations: ${result.applied.length} applied, ${result.skipped.length} skipped`);
    }
    if (target === 'all' || target === 'plans') {
      await seedPlans();
    }
    if (target === 'all' || target === 'jobs') {
      await seedSystemJobs();
    }
    if ((target === 'all' || target === 'demo') && isDemoSeedEnabled(process.env.FF_SEED_DEMO)) {
      await seedDemo();
    }
  } catch (err) {
    console.error('Seed failed:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    closePlanFeatureCache();
    await closePool();
  }
}

// CLI entry: `node dist/db/seed.js [migrate|plans|jobs|demo|all]`.
// The server performs this same initialization in-process at startup
// (index.ts), so importing this module runs nothing. pathToFileURL is
// required — process.argv[1] is the path AS TYPED, which is relative on
// every documented invocation (OPERATIONS.md), so a bare string compare
// against import.meta.url would never match.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
