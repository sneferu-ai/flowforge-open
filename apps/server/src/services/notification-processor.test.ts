/**
 * notification_outbox dispatch contract (§7, OBL-21): exponential backoff
 * 30s → 2m → 10m → 1h → 6h, five-retry cap, re-claimed sends.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../db/pool.js', () => ({ query: queryMock }));

import {
  OUTBOX_BACKOFF_MS,
  OUTBOX_MAX_ATTEMPTS,
  nextRetryDelayMs,
  processOutboxDue,
} from './notification-processor.js';

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'out-1',
  channel: 'email',
  recipient: 'demo@acme.test',
  subject: 'Approval required',
  body: 'Approve me',
  attempts: 0,
  ...overrides,
});

function lastQueryFor(sqlFragment: string): { text: string; params: unknown[] } {
  const call = [...queryMock.mock.calls].reverse().find(([text]) => String(text).includes(sqlFragment));
  if (!call) throw new Error(`No query call containing ${JSON.stringify(sqlFragment)}`);
  return { text: call[0] as string, params: call[1] as unknown[] };
}

describe('outbox backoff ladder', () => {
  it('matches the spec ladder 30s, 2m, 10m, 1h, 6h', () => {
    expect([...OUTBOX_BACKOFF_MS]).toEqual([30_000, 120_000, 600_000, 3_600_000, 21_600_000]);
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(120_000);
    expect(nextRetryDelayMs(3)).toBe(600_000);
    expect(nextRetryDelayMs(4)).toBe(3_600_000);
    expect(nextRetryDelayMs(5)).toBe(21_600_000);
  });

  it('caps at five retries (six total attempts)', () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(6);
    expect(nextRetryDelayMs(6)).toBe(21_600_000); // clamped, terminal reached below
  });
});

describe('processOutboxDue', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks a successful send sent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // reclaim
    queryMock.mockResolvedValueOnce({ rows: [row()], rowCount: 1 }); // claim
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const sentSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const processed = await processOutboxDue();

    expect(processed).toBe(1);
    expect(sentSpy).toHaveBeenCalled();
    const sent = lastQueryFor('status = \'sent\'');
    expect(sent.params[0]).toBe('out-1');
  });

  it('reschedules a failed send with the next backoff rung', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // reclaim
    queryMock.mockResolvedValueOnce({ rows: [row({ attempts: 2 })], rowCount: 1 }); // claim
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    const processed = await processOutboxDue(async () => {
      throw new Error('SMTP down');
    });

    expect(processed).toBe(1);
    const pending = lastQueryFor('status = \'pending\', attempts = attempts + 1');
    expect(pending.params[0]).toBe('out-1');
    expect(pending.params[1]).toBe('SMTP down');
    expect(pending.params[2]).toBe(nextRetryDelayMs(3)); // 3rd attempt → 10m
  });

  it('marks a row failed once the five-retry cap is exhausted', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // reclaim
    queryMock.mockResolvedValueOnce({ rows: [row({ attempts: OUTBOX_MAX_ATTEMPTS - 1 })], rowCount: 1 }); // claim
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await processOutboxDue(async () => {
      throw new Error('SMTP down');
    });

    const failed = lastQueryFor('status = \'failed\'');
    expect(failed.params[0]).toBe('out-1');
    expect(failed.params[1]).toBe('SMTP down');
    // No retry row was scheduled for this attempt.
    expect(queryMock.mock.calls.some(([t]) => String(t).includes("status = 'pending', attempts = attempts + 1"))).toBe(false);
  });

  it('reclaims rows stranded in sending by a crashed dispatcher', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // reclaim
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // claim (none)

    await processOutboxDue();

    const reclaim = queryMock.mock.calls[0][0] as string;
    expect(reclaim).toContain("status = 'sending'");
    expect(reclaim).toContain("updated_at < now()");
  });
});
