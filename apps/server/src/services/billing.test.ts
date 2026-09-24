/**
 * §3.3 / §7 / D7 — terminal-run metering: one billable unit per run that
 * executed at least one step, recorded as usage_events + usage_daily +
 * subscriptions.runs_consumed in one transaction, idempotent on re-billing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- io seams ---------------------------------------------------------------

const { queryMock, withTransactionMock } = vi.hoisted(() => {
  const queryMock = vi.fn<(...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>>();
  const withTransactionMock = vi.fn<(<T>(fn: (tx: unknown) => Promise<T>) => Promise<T>)>();
  return { queryMock, withTransactionMock };
});

vi.mock('../db/pool.js', () => ({
  query: (sql: unknown, params?: unknown[]) => queryMock(sql, params),
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => withTransactionMock(fn),
}));

import { recordBillingForTerminalRun } from './billing.js';

interface FakeTx {
  calls: Array<{ text: string; params: unknown[] }>;
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** A tx fake routed by SQL fragment, with configurable run/step/usage state. */
function makeTx(opts: { started?: boolean; stepCount?: number; alreadyBilled?: boolean } = {}): FakeTx {
  const { started = true, stepCount = 3, alreadyBilled = false } = opts;
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params ?? [] });
      if (text.includes('FROM runs WHERE id')) return { rows: [{ started }] };
      if (text.includes('FROM run_steps')) return { rows: [{ n: stepCount }] };
      if (text.includes('INSERT INTO usage_events')) {
        return { rows: alreadyBilled ? [] : [{ id: 'usage-1' }] };
      }
      return { rows: [] };
    },
  };
}

describe('recordBillingForTerminalRun', () => {
  beforeEach(() => {
    queryMock.mockReset();
    withTransactionMock.mockReset().mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())
    );
  });

  it('skips runs that never started (canceled from queued — D7)', async () => {
    queryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM runs WHERE id')) return { rows: [{ started: false }] };
      return { rows: [] };
    });
    await recordBillingForTerminalRun('ws-1', 'run-1', 'run.canceled');
    const texts = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(texts.join(' ')).not.toContain('usage_events');
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('records all three writes for a terminal run with executed steps', async () => {
    queryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM runs WHERE id')) return { rows: [{ started: true }] };
      if (text.includes('FROM run_steps')) return { rows: [{ n: 7 }] };
      return { rows: [] };
    });
    const captured: FakeTx[] = [];
    withTransactionMock.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx({ stepCount: 7 });
      captured.push(tx);
      return fn(tx);
    });
    await recordBillingForTerminalRun('ws-1', 'run-1', 'run.succeeded');

    const tx = captured[0];
    expect(tx.calls.length).toBe(3);
    const [usage, daily, subs] = tx.calls.map((c) => c.text);
    expect(usage).toContain('INSERT INTO usage_events');
    expect(usage).toContain('ON CONFLICT (run_id, event_type) DO NOTHING');
    expect(tx.calls[0].params.slice(0, 3)).toEqual(['ws-1', 'run-1', 'run.succeeded']);
    expect(daily).toContain('INSERT INTO usage_daily');
    expect(daily).toContain('total_steps = usage_daily.total_steps + $2');
    expect(tx.calls[1].params[1]).toBe(7); // executed step count rides usage_daily
    expect(subs).toContain('UPDATE subscriptions');
    expect(subs).toContain("status = 'active'");
    expect(subs).toContain('current_period_start');
    expect(subs).toContain('current_period_end');
  });

  it('is idempotent: an already-recorded usage event never re-bills', async () => {
    queryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM runs WHERE id')) return { rows: [{ started: true }] };
      if (text.includes('FROM run_steps')) return { rows: [{ n: 2 }] };
      return { rows: [] };
    });
    const captured: FakeTx[] = [];
    withTransactionMock.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx({ alreadyBilled: true }); // reconciliation re-bill
      captured.push(tx);
      return fn(tx);
    });
    await recordBillingForTerminalRun('ws-1', 'run-1', 'run.failed');
    const texts = captured[0].calls.map((c) => c.text).join(' ');
    expect(texts).not.toContain('usage_daily');
    expect(texts).not.toContain('UPDATE subscriptions');
  });

  it('runs inside the caller-provided transaction when one is passed (cancel path)', async () => {
    const tx = makeTx();
    await recordBillingForTerminalRun('ws-1', 'run-1', 'run.canceled', tx as unknown as import('../db/pool.js').TxClient);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(tx.calls.length).toBe(5); // started check + step count + 3 writes
    expect(tx.calls[2].text).toContain('INSERT INTO usage_events');
    expect(tx.calls[2].params[2]).toBe('run.canceled');
  });

  it('passes the terminal event type through to usage_events', async () => {
    queryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM runs WHERE id')) return { rows: [{ started: true }] };
      if (text.includes('FROM run_steps')) return { rows: [{ n: 1 }] };
      return { rows: [] };
    });
    const eventTypes: string[] = [];
    withTransactionMock.mockImplementation(
      async (fn: (tx: FakeTx) => Promise<unknown>) => {
        await fn({
          calls: [],
          query: async (text: string, params?: unknown[]) => {
            if (text.includes('INSERT INTO usage_events')) {
              eventTypes.push(String(params?.[2]));
              return { rows: [{ id: 'u' }] };
            }
            return { rows: [] };
          },
        });
      }
    );
    await recordBillingForTerminalRun('ws-x', 'run-x', 'run.failed');
    expect(eventTypes).toEqual(['run.failed']);
  });
});
