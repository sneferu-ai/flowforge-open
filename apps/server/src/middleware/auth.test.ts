/**
 * BUG-024 regression: X-Forwarded-For is client-controllable and must only be
 * trusted behind a configured proxy (FF_TRUST_PROXY).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp } from './auth.js';
import type { FastifyRequest } from 'fastify';

function fakeRequest(xff: string | undefined, socketIp: string): FastifyRequest {
  return {
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    ip: socketIp,
    socket: { remoteAddress: socketIp },
  } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  const ORIGINAL = process.env.FF_TRUST_PROXY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FF_TRUST_PROXY;
    else process.env.FF_TRUST_PROXY = ORIGINAL;
  });

  it('ignores X-Forwarded-For by default (spoof-proof)', () => {
    delete process.env.FF_TRUST_PROXY;
    expect(getClientIp(fakeRequest('1.2.3.4', '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('ignores X-Forwarded-For when FF_TRUST_PROXY is 0/false', () => {
    process.env.FF_TRUST_PROXY = '0';
    expect(getClientIp(fakeRequest('1.2.3.4', '10.0.0.1'))).toBe('10.0.0.1');
    process.env.FF_TRUST_PROXY = 'false';
    expect(getClientIp(fakeRequest('1.2.3.4', '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('honors X-Forwarded-For when FF_TRUST_PROXY=1', () => {
    process.env.FF_TRUST_PROXY = '1';
    expect(getClientIp(fakeRequest('1.2.3.4, 10.0.0.1', '127.0.0.1'))).toBe('1.2.3.4');
  });

  it('honors X-Forwarded-For when the peer matches the trusted list', () => {
    process.env.FF_TRUST_PROXY = '10.0.0.0/8, 192.168.1.10';
    expect(getClientIp(fakeRequest('1.2.3.4', '10.9.8.7'))).toBe('1.2.3.4');
    expect(getClientIp(fakeRequest('1.2.3.4', '192.168.1.10'))).toBe('1.2.3.4');
  });

  it('ignores X-Forwarded-For from a peer outside the trusted list', () => {
    process.env.FF_TRUST_PROXY = '10.0.0.0/8';
    expect(getClientIp(fakeRequest('1.2.3.4', '203.0.113.9'))).toBe('203.0.113.9');
  });

  it('falls back to the socket address when no XFF header is present', () => {
    process.env.FF_TRUST_PROXY = '1';
    expect(getClientIp(fakeRequest(undefined, '10.0.0.5'))).toBe('10.0.0.5');
  });
});
