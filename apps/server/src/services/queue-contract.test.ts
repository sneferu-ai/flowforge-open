/**
 * §6.3 scheduler_lease keys and §6.4 webhook replay hashing.
 */

import { describe, expect, it } from 'vitest';
import { schedulerLeaseKey } from './scheduler.js';
import { webhookReplayHash } from '../routes/webhooks.js';

describe('schedulerLeaseKey (§6.3)', () => {
  it('combines run id and the resume instant ISO', () => {
    const key = schedulerLeaseKey('11111111-2222-3333-4444-555555555555', '2026-09-19T12:00:00.000Z');
    expect(key).toBe('11111111-2222-3333-4444-555555555555:2026-09-19T12:00:00.000Z');
  });

  it('distinguishes two delay steps in the same run by resume timestamp', () => {
    const a = schedulerLeaseKey('run-1', '2026-09-19T12:00:00.000Z');
    const b = schedulerLeaseKey('run-1', '2026-09-19T12:05:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('webhookReplayHash (§6.4)', () => {
  const body = '{"hello":"world"}';

  it('hashes the raw body deterministically', () => {
    expect(webhookReplayHash(body, undefined)).toBe(webhookReplayHash(body, undefined));
  });

  it('includes the client idempotency key when present', () => {
    const plain = webhookReplayHash(body, undefined);
    const keyed = webhookReplayHash(body, 'idem-123');
    expect(keyed).not.toBe(plain);
  });

  it('distinguishes different bodies', () => {
    expect(webhookReplayHash('{}', undefined)).not.toBe(webhookReplayHash('{"a":1}', undefined));
  });
});
