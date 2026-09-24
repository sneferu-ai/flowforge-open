/**
 * §3.3 / §7 — GET /usage reads the active subscription's runs_consumed and
 * rolling-30-day period bounds (NOT the legacy usage_counters table), derives
 * the plan limit from the subscription's (authoritative) plan_id, and keeps
 * the UI contract fields (`overage`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn<(...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>>(),
}));
vi.mock('../db/pool.js', () => ({
  query: (sql: unknown, params?: unknown[]) => queryMock(sql, params),
}));
vi.mock('../middleware/auth.js', () => {
  const pass = () => Promise.resolve();
  return {
    requireAuth: async (request: { auth?: unknown }) => {
      request.auth = {
        user: { id: 'user-1', email: 'a@b.c', name: 'A' },
        workspaceId: 'ws-1',
        role: 'owner',
        sessionId: 's1',
        csrfToken: 't',
      };
    },
    requirePermission: () => pass,
  };
});
vi.mock('../audit/emit.js', () => ({ emitAuditEvent: vi.fn() }));

import { usageRoutes } from './usage.js';

function buildApp(): FastifyInstance {
  const app = Fastify();
  app.register(usageRoutes);
  return app;
}

/** Route the three queries GET /usage issues (subscription, active runs, sometimes workspace fallback). */
function routeQueries(opts: {
  sub?: Record<string, unknown> | null;
  active?: number;
  workspacePlan?: string;
}) {
  queryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes('FROM subscriptions')) {
      return { rows: opts.sub ? [opts.sub] : [] };
    }
    if (text.includes('FROM workspaces')) {
      return { rows: [{ plan_id: opts.workspacePlan ?? 'free' }] };
    }
    if (text.includes('FROM runs')) {
      return { rows: [{ n: opts.active ?? 0 }] };
    }
    return { rows: [] };
  });
}

describe('GET /usage — subscription-led billing period (§3.3)', () => {
  let app: FastifyInstance;
  beforeEach(() => {
    queryMock.mockReset();
    app = buildApp();
  });

  it('reports runs_consumed, the rolling period reset, and projected usage', async () => {
    routeQueries({
      sub: {
        plan_id: 'pro',
        runs_consumed: 12,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      active: 3,
    });
    const res = await app.inject({ method: 'GET', url: '/usage' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>;
    expect(data.used).toBe(12);
    expect(data.active).toBe(3);
    expect(data.limit).toBe(10000); // Pro run_limit from the shared plan table
    expect(data.projected).toBe(15);
    expect(data.reset_at).toBe('2026-10-01T00:00:00.000Z');
    expect(data.overage).toBe(0);
  });

  it('computes overage for plans with a positive overage rate past the allowance', async () => {
    routeQueries({
      sub: {
        plan_id: 'pro',
        runs_consumed: 10050,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      active: 0,
    });
    const res = await app.inject({ method: 'GET', url: '/usage' });
    expect(res.json().data.overage).toBe(50);
  });

  it('shows zero used with a null reset when no active subscription exists (Free fallback)', async () => {
    routeQueries({ sub: null, workspacePlan: 'free', active: 1 });
    const res = await app.inject({ method: 'GET', url: '/usage' });
    const data = res.json().data as Record<string, unknown>;
    expect(data.used).toBe(0);
    expect(data.reset_at).toBeNull();
    expect(data.limit).toBe(500); // Free cap from the shared plan table
    expect(data.overage).toBe(0); // Free has a hard cap, never overage
  });

  it('derives the limit from the subscription plan_id, not the workspace cache', async () => {
    // The denormalized workspaces.plan_id says free; the wallet's active
    // subscription says studio. §7: subscriptions.plan_id is authoritative.
    routeQueries({
      sub: {
        plan_id: 'studio',
        runs_consumed: 1,
        current_period_start: '2026-09-01T00:00:00.000Z',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      workspacePlan: 'free',
      active: 0,
    });
    const res = await app.inject({ method: 'GET', url: '/usage' });
    const data = res.json().data as Record<string, unknown>;
    expect(data.limit).toBeGreaterThan(500);
    expect(data.plan).toMatchObject({ id: 'studio' });
  });

  it('never reads the legacy usage_counters table', async () => {
    routeQueries({ sub: null });
    await app.inject({ method: 'GET', url: '/usage' });
    const sql = queryMock.mock.calls.map(([q]) => String(q)).join('\n');
    expect(sql).not.toContain('usage_counters');
  });
});
