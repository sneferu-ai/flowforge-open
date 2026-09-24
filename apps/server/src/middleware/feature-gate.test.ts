/**
 * §3.3 — requireFeature preHandler: authorizes via the (mocked) entitlement
 * check and returns 403 plan_feature_required on denial, including the
 * fail-closed case where the underlying check denies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

const { featureEnabledMock } = vi.hoisted(() => ({
  featureEnabledMock: vi.fn<(workspaceId: string, feature: string) => Promise<boolean>>(),
}));
vi.mock('../auth/entitlements.js', () => ({
  featureEnabled: (workspaceId: string, feature: string) => featureEnabledMock(workspaceId, feature),
}));

import { requireFeature } from './auth.js';

function fakeRequest(): FastifyRequest {
  return {
    auth: { user: { id: 'u1', email: 'a@b.c', name: 'A' }, workspaceId: 'ws-1', role: 'owner', sessionId: 's1', csrfToken: 't' },
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
  };
  return reply as unknown as FastifyReply & { captured: Array<{ code: number; body: unknown }> };
}

describe('requireFeature', () => {
  beforeEach(() => {
    featureEnabledMock.mockClear();
  });

  it('passes when the workspace plan grants the feature', async () => {
    featureEnabledMock.mockResolvedValueOnce(true);
    const reply = fakeReply();
    await requireFeature('credential_vault')(fakeRequest(), reply);
    expect(reply.captured).toHaveLength(0);
    expect(featureEnabledMock).toHaveBeenCalledWith('ws-1', 'credential_vault');
  });

  it('denies with 403 plan_feature_required when the plan lacks the feature', async () => {
    featureEnabledMock.mockResolvedValueOnce(false);
    const reply = fakeReply();
    await requireFeature('audit_log')(fakeRequest(), reply);
    expect(reply.captured).toHaveLength(1);
    expect(reply.captured[0].code).toBe(403);
    expect((reply.captured[0].body as { error: { code: string } }).error.code).toBe('plan_feature_required');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const reply = fakeReply();
    const request = { auth: undefined } as unknown as FastifyRequest;
    await requireFeature('audit_log')(request, reply);
    expect(featureEnabledMock).not.toHaveBeenCalled();
    expect(reply.captured[0].code).toBe(401);
  });
});
