/**
 * Regression test for the /readyz Redis-auth failure (repair round 2,
 * 2026-09-20).
 *
 * Root cause: the SOD runtime environment generates a password for the Redis
 * service, so FF_REDIS_URL is `redis://:password@redis:6379/0`. The old
 * checkRedis sent a raw `PING\r\n` over a plain TCP socket WITHOUT
 * authenticating first. Redis responds to an unauthenticated PING with
 * `-NOAUTH Authentication required.` — never `+PONG` — so checkRedis always
 * returned false and /readyz was permanently 503 (33 of 35 probes failed).
 *
 * Fix: checkRedis now uses ioredis (already a dependency) which parses the
 * URL, sends AUTH automatically, and exposes a clean ping().
 *
 * This test pins:
 *   1. The source uses ioredis, NOT a raw socket (createConnection from net).
 *   2. checkRedis returns true when ioredis connects + ping returns PONG.
 *   3. checkRedis returns false when ioredis emits error (e.g. AUTH failure).
 *   4. checkRedis returns false when FF_REDIS_URL is unset.
 *   5. The client is disconnected after the check (no connection leak).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const redisSrcPath = join(root, 'apps/server/src/services/redis.ts');

// --- io seam: a FakeRedis that mimics ioredis enough for the probe ---------

interface FakeRedisCtor {
  new (url: string, opts?: Record<string, unknown>): FakeRedisInstance;
}

interface FakeRedisInstance {
  ping(): Promise<string>;
  disconnect(): void;
  once(event: string, cb: (...args: unknown[]) => void): this;
  on(event: string, cb: (...args: unknown[]) => void): this;
}

let lastInstance: FakeRedisInstance | null = null;
let ctorCallCount = 0;
let lastUrl: string | undefined;
let pingResult: string = 'PONG';
let pingError: Error | null = null;
let fireEvent: 'ready' | 'error' | 'close' | 'never' = 'ready';

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    constructor(url: string) {
      lastUrl = url;
      ctorCallCount++;
      lastInstance = this;
      // Fire the configured event on next tick to mimic ioredis async handshake.
      queueMicrotask(() => {
        if (fireEvent === 'ready') {
          this._readyListeners.forEach((cb) => cb());
        } else if (fireEvent === 'error') {
          this._errorListeners.forEach((cb) => cb(new Error('AUTH failed')));
        } else if (fireEvent === 'close') {
          this._closeListeners.forEach((cb) => cb());
        }
        // fireEvent === 'never' → no event fires; only the probe timer can settle.
      });
    }
    private _readyListeners: Array<() => void> = [];
    private _errorListeners: Array<(e: Error) => void> = [];
    private _closeListeners: Array<() => void> = [];
    private _disconnected = false;

    ping(): Promise<string> {
      // Reject lazily so the rejection is created AT await time (attached
      // happens same-turn) — a pre-made Promise.reject floats unhandled
      // between assignment and the probe's ping() call.
      if (pingError) {
        return new Promise<string>((_resolve, reject) => reject(pingError));
      }
      return Promise.resolve(pingResult);
    }
    disconnect(): void {
      this._disconnected = true;
    }
    get disconnected(): boolean {
      return this._disconnected;
    }
    once(event: string, cb: (...args: unknown[]) => void): this {
      if (event === 'ready') this._readyListeners.push(cb as () => void);
      if (event === 'error') this._errorListeners.push(cb as (e: Error) => void);
      if (event === 'close') this._closeListeners.push(cb as () => void);
      return this;
    }
    on(_event: string, _cb: (...args: unknown[]) => void): this {
      return this;
    }
  }
  return { FakeRedis };
});

vi.mock('ioredis', () => ({ Redis: FakeRedis as unknown as FakeRedisCtor }));

describe('/readyz Redis AUTH regression', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    ctorCallCount = 0;
    lastInstance = null;
    lastUrl = undefined;
    pingResult = 'PONG';
    pingError = null;
    fireEvent = 'ready';
    delete process.env.FF_REDIS_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.resetModules();
  });

  it('source uses ioredis, not a raw socket (createConnection from node:net)', () => {
    const src = readFileSync(redisSrcPath, 'utf8');
    expect(src).not.toContain('createConnection');
    expect(src).not.toContain("from 'node:net'");
    expect(src).toContain("from 'ioredis'");
    expect(src).toMatch(/new Redis\s*\(/);
  });

  it('returns false when FF_REDIS_URL is unset', async () => {
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis();
    expect(result).toBe(false);
    expect(ctorCallCount).toBe(0);
  });

  it('returns true when ioredis connects (ready) and ping returns PONG', async () => {
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6379/0';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis(2000);
    expect(result).toBe(true);
    expect(ctorCallCount).toBe(1);
    expect(lastUrl).toBe('redis://:secret@redis:6379/0');
  });

  it('returns false when ioredis emits error (e.g. AUTH failure)', async () => {
    process.env.FF_REDIS_URL = 'redis://:wrongpassword@redis:6379/0';
    fireEvent = 'error';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis(2000);
    expect(result).toBe(false);
  });

  it('returns false when ioredis emits close before ready', async () => {
    process.env.FF_REDIS_URL = 'redis://redis:6379/0';
    fireEvent = 'close';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis(2000);
    expect(result).toBe(false);
  });

  it('disconnects the client after the check (no connection leak)', async () => {
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6379/0';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    await checkRedis(2000);
    expect(lastInstance).not.toBeNull();
    expect((lastInstance as unknown as { disconnected: boolean }).disconnected).toBe(true);
  });

  it('returns false when ping returns a non-PONG response', async () => {
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6379/0';
    pingResult = 'BUSY';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis(2000);
    expect(result).toBe(false);
  });

  it('settles false from the probe timer when no event ever fires', async () => {
    // The SOD failure mode was a probe that never settled (handler > 2s →
    // orchestration read timeout). When neither ready/error/close fires, the
    // internal timer must be the thing that resolves — bounded and false.
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6379/0';
    fireEvent = 'never';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const start = Date.now();
    const result = await checkRedis(80);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(1000);
    expect(ctorCallCount).toBe(1);
  });

  it('disconnects the client when the probe timer expires', async () => {
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6379/0';
    fireEvent = 'never';
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    await checkRedis(80);
    expect(lastInstance).not.toBeNull();
    expect((lastInstance as unknown as { disconnected: boolean }).disconnected).toBe(true);
  });

  it('returns false when ioredis resolves ready but ping rejects', async () => {
    process.env.FF_REDIS_URL = 'redis://:secret@redis:6399/0';
    pingError = new Error('connection dropped mid-PING');
    const { checkRedis } = await import('../apps/server/src/services/redis.js');
    const result = await checkRedis(2000);
    expect(result).toBe(false);
  });
});
