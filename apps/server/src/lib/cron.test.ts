import { describe, it, expect } from 'vitest';
import { isValidCron, computeNextFire } from './cron.js';
import { parseDurationMs, isWithinLocalDelayCap } from './durations.js';
import { isValidCronExpression } from '@flowforge/engine';

describe('cron parser', () => {
  it('accepts valid 5-field expressions', () => {
    expect(isValidCron('30 9 * * 1-5')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('0 0 1 1 *')).toBe(true);
    expect(isValidCron('15,45 8-18 * * 1')).toBe(true);
  });

  it('rejects malformed expressions', () => {
    expect(isValidCron('61 9 * * *')).toBe(false);
    expect(isValidCron('9 * * *')).toBe(false);
    expect(isValidCron('a b c d e')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false);
  });

  it('computes the next weekday fire strictly after the given time', () => {
    // Tuesday 2026-09-15T10:00Z; next "9:30 weekdays" is Wednesday 09:30Z.
    const from = new Date('2026-09-15T10:00:00Z');
    const next = computeNextFire('30 9 * * 1-5', from);
    expect(next.toISOString()).toBe('2026-09-16T09:30:00.000Z');
  });

  it('skips weekends for weekday crons', () => {
    // Friday 2026-09-18 09:00Z → next Monday 2026-09-21 09:00Z.
    const next = computeNextFire('0 9 * * 1-5', new Date('2026-09-18T09:00:00Z'));
    expect(next.toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });

  it('handles steps', () => {
    const from = new Date('2026-09-19T12:03:00Z');
    const next = computeNextFire('*/10 * * * *', from);
    expect(next.getUTCMinutes() % 10).toBe(0);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('day-of-month and day-of-week union semantics', () => {
    // "0 0 1 * 0" = midnight on the 1st OR any Sunday.
    const next = computeNextFire('0 0 1 * 0', new Date('2026-09-05T12:00:00Z'));
    // 2026-09-06 is a Sunday → next fire Sunday midnight.
    expect(next.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });
});

describe('duration parser', () => {
  it('parses the supported units', () => {
    expect(parseDurationMs('30s')).toBe(30000);
    expect(parseDurationMs('5m')).toBe(300000);
    expect(parseDurationMs('2h')).toBe(7200000);
    expect(parseDurationMs('1d')).toBe(86400000);
  });

  it('rejects out-of-contract durations', () => {
    expect(parseDurationMs('1w')).toBeNull();
    expect(parseDurationMs('0s')).toBeNull();
    expect(parseDurationMs('-3s')).toBeNull();
    expect(parseDurationMs('soon')).toBeNull();
  });

  it('local delay cap honors the 5-minute rule', () => {
    expect(isWithinLocalDelayCap('4m')).toBe(true);
    expect(isWithinLocalDelayCap('10m')).toBe(false);
    expect(isWithinLocalDelayCap('bad')).toBe(false);
  });
});

// BUG-007 guard: the manifest validator's cron grammar must agree EXACTLY with
// the scheduler's grammar — a manifest that validates must be schedulable.
describe('validator/scheduler cron grammar consistency', () => {
  const CASES: Array<[string, boolean]> = [
    ['* * * * *', true],
    ['30 9 * * 1-5', true],
    ['*/5 * * * *', true],
    ['0 0 1 1 *', true],
    ['15,45 8-18 * * 1', true],
    ['0 9 * * 0,7', true],
    ['61 9 * * *', false],
    ['9 * * *', false],
    ['* * * * * *', false],
    ['a b c d e', false],
    ['0 9 * * MON-FRI', false], // names unsupported by the scheduler
    ['*/0 * * * *', false],
    ['5-1 * * * *', false],
    ['* * 0 * *', false],
    ['* 24 * * *', false],
    ['0 9 * * 8', false],
    ['', false],
  ];
  it.each(CASES)('%j → %s', (expr, expected) => {
    expect(isValidCronExpression(expr), 'validator').toBe(expected);
    expect(isValidCron(expr), 'scheduler').toBe(expected);
  });
});
