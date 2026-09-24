/**
 * Entitlements — plan-based feature gating and limit enforcement.
 *
 * Feature-flag checks (§3.3) are cached in Redis for 5 minutes and FAIL
 * CLOSED when the cache plane is unavailable: a gated feature is denied with
 * plan_feature_required rather than executing without authorization. The
 * dedicated cache client disables offline queueing and reconnects so a down
 * Redis rejects fast instead of hanging the request.
 *
 * TWO liveness rules keep fail-closed honest:
 *  1. Commands are never queued (enableOfflineQueue: false), so a check
 *     against a down Redis rejects immediately instead of hanging — but a
 *     command issued in the SAME TICK the lazy client is constructed races the
 *     TCP handshake and rejects even against a healthy Redis. Every first use
 *     therefore awaits a bounded `ready` window (awaitCacheClientReady)
 *     before sending its command.
 *  2. The reconnection strategy NEVER gives up (bounded backoff): after a
 *     real outage the client keeps dialing in the background, so once Redis
 *     returns the NEXT check succeeds. Per-check semantics stay fail-closed —
 *     only checks that run WHILE the cache plane is down are denied.
 */

import { getPlanDefinition, type PlanDefinition } from '@flowforge/shared';
import { Redis } from 'ioredis';
import { query } from '../db/pool.js';

export type FeatureKey = keyof PlanDefinition['feature_flags'];

export const PLAN_FEATURE_CACHE_TTL_S = 300;

/** Bounded wait for the cache client's first successful connection. */
const CACHE_CLIENT_READY_TIMEOUT_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let planFeatureCache: Redis | null = null;

/** One bounded Redis client for the feature-flag cache (NOT BullMQ's). */
export function getPlanFeatureCache(): Redis {
  if (!planFeatureCache) {
    planFeatureCache = new Redis(process.env.FF_REDIS_URL || 'redis://localhost:6379', {
      // Each command tries the connection once and rejects fast (no offline
      // queue) so a down Redis fails CLOSED instead of hanging the request.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Keep reconnecting with bounded backoff (liveness rule 2): commands
      // still fail closed while the plane is down, and the client transparently
      // heals so the next check succeeds once Redis returns.
      retryStrategy: (attempt) => Math.min(200 * attempt, 1000),
    });
  }
  return planFeatureCache;
}

function planFeatureCacheKey(planId: string): string {
  return `ff:plan:features:${planId}`;
}

/**
 * Give a freshly-created cache client one bounded beat to finish its first
 * connection (liveness rule 1). This only OBSERVES the ready event — the
 * client auto-connects on construction, and calling connect() again while the
 * auto-connect handshake is in flight stalls the client at status `connect`
 * (live-probed: every command then rejects against a healthy Redis).
 * The wait only engages for a client that has NEVER connected (`wait` /
 * `connecting`): a client that already reached ready and is now reconnecting
 * behind a genuine outage must keep failing closed fast (no 1.5s per check).
 * When the first connection keeps failing, the bounded wait expires and the
 * follow-up command fails closed right away.
 */
async function awaitCacheClientReady(client: Redis): Promise<void> {
  if (client.status !== 'wait' && client.status !== 'connecting') return;
  await Promise.race([
    new Promise<void>((resolve) => client.once('ready', () => resolve())),
    sleep(CACHE_CLIENT_READY_TIMEOUT_MS),
  ]);
}

/**
 * §3.3 — plan feature-flag check with the 5-minute Redis cache.
 *
 * Fail-closed contract: unreachable Redis, an unknown plan, or a missing
 * workspace all deny the feature. The cached flags blob is keyed by plan id
 * (feature definitions are plan-attached); workspace→plan changes are picked
 * up because the plan id is re-read from the (authoritative) DB on every
 * call, and plan-definition changes are covered by
 * `invalidatePlanFeatureCache` on re-seed plus the TTL.
 */
export async function featureEnabled(workspaceId: string, feature: FeatureKey): Promise<boolean> {
  const wsResult = await query<{ plan_id: string }>(
    'SELECT plan_id FROM workspaces WHERE id = $1 AND deleted_at IS NULL',
    [workspaceId]
  );
  if (wsResult.rows.length === 0) return false;
  const planId = wsResult.rows[0].plan_id;
  const cacheKey = planFeatureCacheKey(planId);

  try {
    const client = getPlanFeatureCache();
    await awaitCacheClientReady(client);
    let flagsJson = await client.get(cacheKey);
    if (flagsJson === null) {
      const plan = getPlanDefinition(planId);
      if (!plan) return false;
      flagsJson = JSON.stringify(plan.feature_flags);
      // Best-effort write; a failed set leaves the computed value below.
      await client.set(cacheKey, flagsJson, 'EX', PLAN_FEATURE_CACHE_TTL_S).catch(() => undefined);
    }
    const flags = JSON.parse(flagsJson) as Record<string, unknown>;
    return flags[feature] === true;
  } catch {
    // Redis unavailable → deny gated features (fail closed, §3.3).
    return false;
  }
}

/** Drop the cached flags for a plan (called by seed after plan upserts). */
export async function invalidatePlanFeatureCache(planId: string): Promise<void> {
  try {
    const client = getPlanFeatureCache();
    await awaitCacheClientReady(client);
    await client.del(planFeatureCacheKey(planId));
  } catch {
    // Redis down — the TTL bounds staleness.
  }
}

/**
 * Detach the cache client so short-lived processes (seed, scripts) can exit —
 * the lazy client's socket would otherwise keep the event loop alive. Safe to
 * call on a live server too: the next entitlement check transparently
 * re-creates the client.
 */
export function closePlanFeatureCache(): void {
  if (planFeatureCache) {
    planFeatureCache.disconnect();
    planFeatureCache = null;
  }
}


export interface EntitlementContext {
  planId: string;
  plan: PlanDefinition;
  runsConsumed: number;
  activeRunCount: number;
}

/**
 * §3.3 — a plan enforces a HARD run cap only when overage billing is
 * disabled (`overage_rate_cents` null). That is exactly one plan: Free
 * (500/mo, hard cap). Pro/Studio `run_limit` values are SOFT thresholds —
 * at 100% overage billing activates (`billing_period_close` invoices the
 * excess at `overage_rate_cents`) and runs are still admitted. Community
 * and Demo are unlimited (`run_limit` null).
 */
export function hasHardRunCap(plan: PlanDefinition): boolean {
  return plan.run_limit !== null && (plan.overage_rate_cents ?? 0) <= 0;
}

export async function getWorkspaceEntitlement(workspaceId: string): Promise<EntitlementContext> {
  // Get workspace plan
  const wsResult = await query<{ plan_id: string }>(
    'SELECT plan_id FROM workspaces WHERE id = $1 AND deleted_at IS NULL',
    [workspaceId]
  );
  if (wsResult.rows.length === 0) {
    throw new Error('Workspace not found');
  }
  const planId = wsResult.rows[0].plan_id;
  const plan = getPlanDefinition(planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${planId}`);
  }

  // §3.3/§7: runs_consumed lives on the subscriptions row; it is the
  // authoritative billing-period counter incremented atomically at terminal
  // transition. subscriptions.current_period_start/end define a rolling
  // 30-day window (NOT a calendar month).
  const subResult = await query<{ runs_consumed: number }>(
    `SELECT runs_consumed FROM subscriptions
     WHERE workspace_id = $1 AND status = 'active'
       AND now() >= current_period_start AND now() < current_period_end
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  const runsConsumed = subResult.rows[0]?.runs_consumed ?? 0;

  // Get active run count (§6.5 — all non-terminal states; concurrency-blocked
  // runs are excluded, they are not active).
  const activeResult = await query<{ count: string }>(
    `SELECT count(*) as count FROM runs
     WHERE workspace_id = $1 AND status IN ('queued', 'running', 'waiting', 'paused')
       AND concurrency_block = false`,
    [workspaceId]
  );
  const activeRunCount = parseInt(activeResult.rows[0]?.count ?? '0', 10);

  return { planId, plan, runsConsumed, activeRunCount };
}

/**
 * §3.3 — Free-plan hard cap: runs_consumed + active_count >= run_limit.
 * Only plans without overage billing (Free) reject; Pro/Studio soft
 * thresholds admit and activate overage, unlimited plans always admit.
 */
export function checkRunLimit(ctx: EntitlementContext): { allowed: boolean; remaining: number | null } {
  if (!hasHardRunCap(ctx.plan) || ctx.plan.run_limit === null) {
    return { allowed: true, remaining: null };
  }
  const consumed = ctx.runsConsumed + ctx.activeRunCount;
  const remaining = ctx.plan.run_limit - consumed;
  return { allowed: remaining > 0, remaining };
}

export function checkConcurrencyLimit(ctx: EntitlementContext): boolean {
  if (ctx.plan.concurrency_limit === null) return true;
  return ctx.activeRunCount < ctx.plan.concurrency_limit;
}

export function checkFeature(ctx: EntitlementContext, feature: keyof PlanDefinition['feature_flags']): boolean {
  return ctx.plan.feature_flags[feature];
}


