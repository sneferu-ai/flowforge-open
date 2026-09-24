/**
 * §8.2/§8.4 — API-token auth: role_snapshot frozen at token creation.
 * requireAuth's bearer path resolves the holder's role from the snapshot on
 * the token row (never re-resolved from workspace_members), revokes instantly
 * on revoked_at, and skips the session-plane CSRF handshake entirely.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn<(...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>>(),
}));
vi.mock('../db/pool.js', () => ({
  query: (sql: unknown, params?: unknown[]) => queryMock(sql, params),
}));

const { getSessionMock, isCsrfValidMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve(null)),
  isCsrfValidMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve(true)),
}));
vi.mock('../auth/session.js', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  isCsrfValid: (...args: unknown[]) => isCsrfValidMock(...args),
  getSessionCookieName: () => 'ff_session',
}));

import { requireAuth } from './auth.js';

const TOKEN = 'ff_test-token-value-1234567890';

function fakeRequest(opts: { bearer?: string; cookies?: Record<string, string>; method?: string; csrf?: string } = {}): FastifyRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.csrf !== undefined) headers['x-csrf-token'] = opts.csrf;
  return {
    headers,
    cookies: opts.cookies ?? {},
    method: opts.method ?? 'GET',
  } as unknown as FastifyRequest;
}

function fakeReply() {
  const captured: Array<{ code: number; body: unknown }> = [];
  let lastCode = 0;
  const reply = {
    captured,
    code(c: number) {
      lastCode = c;
      return reply;
    },
    send(body: unknown) {
      captured.push({ code: lastCode, body });
      return reply;
    },
    clearCookie() {
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { captured: Array<{ code: number; body: unknown }> };
}

/** Routes pool queries by SQL fragment, defaulting to a valid frozen-owner token. */
function routeQueries(overrides: Partial<{ tokenRows: Array<Record<string, unknown>>; userRows: Array<Record<string, unknown>> }> = {}) {
  queryMock.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes('FROM api_tokens')) {
      return {
        rows:
          overrides.tokenRows ??
          [{ workspace_id: 'ws-1', user_id: 'user-1', role_snapshot: 'member' }],
      };
    }
    if (text.includes('FROM users')) {
      return { rows: overrides.userRows ?? [{ id: 'user-1', email: 'a@b.c', name: 'A' }] };
    }
    return { rows: [] };
  });
}

describe('requireAuth — bearer API-token path (§8.4 role_snapshot)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getSessionMock.mockClear();
    isCsrfValidMock.mockClear();
    routeQueries();
  });

  it('authenticates from the token row and freezes the role snapshot', async () => {
    const request = fakeRequest({ bearer: TOKEN });
    const reply = fakeReply();
    await requireAuth(request, reply);
    expect(reply.captured).toHaveLength(0);
    expect(request.auth).toMatchObject({
      workspaceId: 'ws-1',
      user: { id: 'user-1' },
      role: 'member', // from role_snapshot on the token, NOT live membership
    });
  });

  it('never re-resolves membership — the frozen snapshot survives role changes', async () => {
    // Live membership is owner; the snapshot says member. The bearer path must
    // use the snapshot and must not read workspace_members at all.
    routeQueries({
      tokenRows: [{ workspace_id: 'ws-1', user_id: 'user-1', role_snapshot: 'member' }],
    });
    const request = fakeRequest({ bearer: TOKEN });
    await requireAuth(request, fakeReply());
    expect(request.auth!.role).toBe('member');
    const sql = queryMock.mock.calls.map(([q]) => String(q)).join('\n');
    expect(sql).not.toContain('workspace_members');
  });

  it('rejects a revoked token with 401 and never touches last_used_at', async () => {
    routeQueries({ tokenRows: [] });
    const reply = fakeReply();
    await requireAuth(fakeRequest({ bearer: TOKEN }), reply);
    expect(reply.captured[0].code).toBe(401);
    expect((reply.captured[0].body as { error: { code: string } }).error.code).toBe('unauthorized');
    const sql = queryMock.mock.calls.map(([q]) => String(q)).join('\n');
    expect(sql).not.toContain('last_used_at');
  });

  it('rejects a token whose user was deleted with 401', async () => {
    routeQueries({ userRows: [] });
    const reply = fakeReply();
    await requireAuth(fakeRequest({ bearer: TOKEN }), reply);
    expect(reply.captured[0].code).toBe(401);
    const sql = queryMock.mock.calls.map(([q]) => String(q)).join('\n');
    expect(sql).not.toContain('last_used_at');
  });

  it('records last_used_at only after the token proved live', async () => {
    const request = fakeRequest({ bearer: TOKEN });
    await requireAuth(request, fakeReply());
    const touch = queryMock.mock.calls.find(([q]) => String(q).includes('last_used_at'));
    expect(touch).toBeDefined();
    expect((touch![1] as unknown[])[0]).toBe(TOKEN_TO_HASH(TOKEN));
  });

  it('skips the session CSRF handshake for bearer requests (state-changing POST)', async () => {
    const request = fakeRequest({ bearer: TOKEN, method: 'POST' }); // no X-CSRF-Token
    const reply = fakeReply();
    await requireAuth(request, reply);
    expect(reply.captured).toHaveLength(0);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(isCsrfValidMock).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no credentials are presented', async () => {
    const reply = fakeReply();
    await requireAuth(fakeRequest(), reply);
    expect(reply.captured[0].code).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

import { createHash } from 'node:crypto';

function TOKEN_TO_HASH(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
