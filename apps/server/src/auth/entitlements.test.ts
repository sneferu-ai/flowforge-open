/**
 * §3.3 — plan feature-gate enforcement: 5-minute Redis cache, fail-closed on
 * Redis outage, cache invalidation. Drives the io seams (DB plan lookup + the
 * dedicated Redis client) with fakes; no live services are needed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- io seams (hoisted: vi.mock factories are evaluated at import time) --------

const { queryMock, redisGet, redisSet, redisDel, FakeRedis } = vi.hoisted(() => {
  const queryMock = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>>(
    async () => ({ rows: [] })
  );
  const redisGet = vi.fn<(key: string) => Promise<string | null>>();
  const redisSet = vi.fn<(key: string, value: string, mode: string, ttl: number) => Promise<string>>();
  const redisDel = vi.fn<(key: string) => Promise<number>>();
  class FakeRedis {
    get(key: string) {
      return redisGet(key);
    }
    set(key: string, value: string, mode: string, ttl: number) {
      return redisSet(key, value, mode, ttl);
    }
    del(key: string) {
      return redisDel(key);
    }
    status = 'ready';
    private readyListeners: Array<() => void> = [];
    once(event: string, cb: () => void): this {
      if (event === 'ready') this.readyListeners.push(cb);
      return this;
    }
    /** Test seam: simulate the auto-connect handshake finishing. */
    emitReady(): void {
      this.status = 'ready';
      for (const cb of this.readyListeners.splice(0)) cb();
    }
  }
  return { queryMock, redisGet, redisSet, redisDel, FakeRedis };
});

vi.mock('../db/pool.js', () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));
vi.mock('ioredis', () => ({ Redis: FakeRedis }));

import { featureEnabled, invalidatePlanFeatureCache, getPlanFeatureCache, hasHardRunCap, checkRunLimit, type EntitlementContext } from './entitlements.js';
import { getPlanDefinition } from '@flowforge/shared';

describe('featureEnabled (§3.3 fail-closed plan feature gates)', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue({ rows: [{ plan_id: 'pro' }] });
    redisGet.mockReset().mockImplementation(async () => null);
    redisSet.mockReset().mockImplementation(async () => 'OK');
    redisDel.mockReset().mockImplementation(async () => 1);
    (getPlanFeatureCache() as unknown as { status: string }).status = 'ready';
  });

  it('serves a cached feature flag without recomputing', async () => {
    redisGet.mockResolvedValueOnce(JSON.stringify({ credential_vault: true, audit_log: true }));
    expect(await featureEnabled('ws-1', 'audit_log')).toBe(true);
    expect(redisGet).toHaveBeenCalledWith('ff:plan:features:pro');
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('computes flags from the plan table and caches them with the 5-minute TTL', async () => {
    redisGet.mockResolvedValueOnce(null);
    expect(await featureEnabled('ws-1', 'credential_vault')).toBe(true);

    expect(redisSet).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = redisSet.mock.calls[0];
    expect(key).toBe('ff:plan:features:pro');
    expect(mode).toBe('EX');
    expect(ttl).toBe(300);
    const cached = JSON.parse(value as string) as Record<string, boolean>;
    expect(cached.credential_vault).toBe(true);
    expect(cached.audit_log).toBe(true);
  });

  it('denies features the plan does not grant (Free: no vault, no audit)', async () => {
    queryMock.mockResolvedValue({ rows: [{ plan_id: 'free' }] });
    redisGet.mockResolvedValue(null); // recompute from the real plan table each call
    expect(await featureEnabled('ws-1', 'credential_vault')).toBe(false);
    expect(await featureEnabled('ws-1', 'audit_log')).toBe(false);
    expect(await featureEnabled('ws-1', 'api_tokens')).toBe(true);
  });

  it('fails closed when Redis is unavailable', async () => {
    queryMock.mockResolvedValue({ rows: [{ plan_id: 'demo' }] });
    redisGet.mockRejectedValue(new Error('ECONNREFUSED'));
    // The Demo plan grants every feature — but a down cache plane must deny.
    expect(await featureEnabled('ws-1', 'credential_vault')).toBe(false);
    expect(await featureEnabled('ws-1', 'manual_approval')).toBe(false);
  });

  it('fails closed on a missing workspace or unknown plan', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await featureEnabled('ws-gone', 'audit_log')).toBe(false);

    queryMock.mockResolvedValue({ rows: [{ plan_id: 'nonexistent-plan' }] });
    redisGet.mockResolvedValue(null);
    expect(await featureEnabled('ws-1', 'audit_log')).toBe(false);
  });

  it('invalidatePlanFeatureCache deletes the plan key and survives Redis errors', async () => {
    redisDel.mockResolvedValueOnce(1);
    await invalidatePlanFeatureCache('pro');
    expect(redisDel).toHaveBeenCalledWith('ff:plan:features:pro');

    redisDel.mockRejectedValueOnce(new Error('down'));
    await expect(invalidatePlanFeatureCache('pro')).resolves.toBeUndefined();
  });

  it('waits for the first ready event before the first command (same-tick connect race)', async () => {
    // With enableOfflineQueue: false a command racing the auto-connect rejects
    // even against a healthy Redis. The ready gate must hold the command until
    // the client's own handshake finishes — purely by observing `ready`.
    const client = getPlanFeatureCache() as unknown as { status: string; emitReady(): void };
    client.status = 'wait';
    setTimeout(() => client.emitReady(), 5);
    expect(await featureEnabled('ws-1', 'credential_vault')).toBe(true);
    // A ready client must skip the wait on subsequent checks.
    expect(await featureEnabled('ws-1', 'credential_vault')).toBe(true);
    expect(redisGet).toHaveBeenCalledTimes(2);
  });

  it('bounds the ready wait when the handshake never finishes', async () => {
    vi.useFakeTimers();
    try {
      const client = getPlanFeatureCache() as unknown as { status: string };
      client.status = 'wait'; // no emitReady — the handshake hangs
      // With the client stuck connecting, commands reject (no offline queue).
      redisGet.mockRejectedValue(new Error('ECONNREFUSED'));
      const promise = featureEnabled('ws-1', 'credential_vault');
      // The 1.5s wait bound expires; the command then rejects → fail closed.
      await vi.advanceTimersByTimeAsync(2000);
      expect(await promise).toBe(false);
      // No hanging command: the get() rejected immediately after the bound.
      expect(redisGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      (getPlanFeatureCache() as unknown as { status: string }).status = 'ready';
    }
  });
});

describe('§3.3 run-cap semantics (Free hard cap, Pro/Studio soft threshold)', () => {
  const ctx = (planId: string, runsConsumed: number, activeRunCount: number): EntitlementContext => {
    const plan = getPlanDefinition(planId);
    if (!plan) throw new Error(`unknown plan ${planId}`);
    return { planId, plan, runsConsumed, activeRunCount };
  };

  it('hasHardRunCap: only plans without overage billing enforce a hard cap', () => {
    expect(hasHardRunCap(getPlanDefinition('free')!)).toBe(true);
    expect(hasHardRunCap(getPlanDefinition('pro')!)).toBe(false);
    expect(hasHardRunCap(getPlanDefinition('studio')!)).toBe(false);
    expect(hasHardRunCap(getPlanDefinition('community')!)).toBe(false);
    expect(hasHardRunCap(getPlanDefinition('demo')!)).toBe(false);
  });

  it('checkRunLimit rejects the Free plan at the 500 cap (consumed + active)', () => {
    expect(checkRunLimit(ctx('free', 499, 1)).allowed).toBe(false);
    expect(checkRunLimit(ctx('free', 498, 1)).allowed).toBe(true);
    expect(checkRunLimit(ctx('free', 0, 500)).allowed).toBe(false);
  });

  it('checkRunLimit never rejects Pro/Studio at 100% — overage billing activates instead', () => {
    // §3.3: Pro/Studio carry a SOFT threshold; at >= 100% overage activates
    // and runs are still admitted. Only Free hard-caps.
    expect(checkRunLimit(ctx('pro', 10000, 0)).allowed).toBe(true);
    expect(checkRunLimit(ctx('pro', 15000, 50)).allowed).toBe(true);
    expect(checkRunLimit(ctx('studio', 60000, 80)).allowed).toBe(true);
  });

  it('checkRunLimit admits unlimited plans without a ceiling', () => {
    const community = checkRunLimit(ctx('community', 9999, 500));
    expect(community.allowed).toBe(true);
    expect(community.remaining).toBeNull();
    expect(checkRunLimit(ctx('demo', 0, 5000)).allowed).toBe(true);
  });
});
