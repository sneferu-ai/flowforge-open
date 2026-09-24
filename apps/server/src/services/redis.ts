/**
 * Redis connectivity check — used by /readyz.
 * The queue plane is Redis 7.4 (§4.1). If FF_REDIS_URL is unset, readiness
 * reports false rather than pretending the queue plane exists.
 *
 * Implementation note: the SOD runtime environment generates a password for
 * the Redis service, so FF_REDIS_URL is typically
 * `redis://:password@redis:6379/0`. A raw-socket PING without AUTH gets
 * `-NOAUTH Authentication required.` and never sees +PONG — which made
 * /readyz permanently 503. We use ioredis (already a dependency, already
 * used by entitlements.ts and queue.ts) which parses the URL, sends AUTH
 * automatically, and exposes a clean ping().
 */

import { Redis } from 'ioredis';

let reportedUnavailable = false;

/**
 * Probe Redis by connecting with ioredis (handles AUTH from the URL),
 * waiting for the 'ready' event, then issuing PING.
 *
 * The whole probe is bounded by `timeoutMs`: if connect+AUTH+PING doesn't
 * complete within the timeout, we resolve false and tear down the client.
 */
export async function checkRedis(timeoutMs = 1500): Promise<boolean> {
  const url = process.env.FF_REDIS_URL;
  if (!url) return false;

  let client: Redis | null = null;
  let settled = false;

  const teardown = (): void => {
    if (client) {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  };

  try {
    return await new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };

      const timer = setTimeout(() => {
        done(false);
      }, timeoutMs);

      try {
        // retryStrategy returns null → don't reconnect after a failure;
        // we want a fast one-shot probe, not a resilient long-lived client.
        client = new Redis(url, {
          connectTimeout: timeoutMs,
          maxRetriesPerRequest: 0,
          retryStrategy: () => null,
        });
      } catch {
        done(false);
        return;
      }

      // 'ready' fires after TCP connect + AUTH (if needed) + SELECT.
      client.once('ready', async () => {
        try {
          const r = await client!.ping();
          done(r === 'PONG');
        } catch {
          done(false);
        }
      });

      // 'error' fires on connect failure, AUTH failure, etc.
      client.once('error', () => done(false));

      // 'close' fires if the connection drops before 'ready'.
      client.once('close', () => done(false));
    });
  } catch {
    if (!reportedUnavailable) {
      reportedUnavailable = true;
      console.warn(
        '[readyz] FF_REDIS_URL set but unprobeable; readiness will report redis=false',
      );
    }
    return false;
  } finally {
    teardown();
  }
}
