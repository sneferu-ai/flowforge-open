/**
 * BUG-022 regression: list endpoints must never feed NaN or negative
 * limit/offset into SQL.
 */

import { describe, it, expect } from 'vitest';
import { parsePageParams } from './pagination.js';

const OPTS = { defaultLimit: 50, maxLimit: 100 };

describe('parsePageParams', () => {
  it('defaults when params are absent', () => {
    expect(parsePageParams({}, OPTS)).toEqual({ limit: 50, offset: 0 });
  });

  it('rejects NaN and non-numeric input with the defaults', () => {
    expect(parsePageParams({ limit: 'abc', offset: 'xyz' }, OPTS)).toEqual({ limit: 50, offset: 0 });
    expect(parsePageParams({ limit: 'NaN' }, OPTS).limit).toBe(50);
  });

  it('clamps negatives to the floor', () => {
    expect(parsePageParams({ limit: '-5', offset: '-1' }, OPTS)).toEqual({ limit: 1, offset: 0 });
  });

  it('clamps to the max limit', () => {
    expect(parsePageParams({ limit: '99999' }, OPTS).limit).toBe(100);
  });

  it('passes through sane values', () => {
    expect(parsePageParams({ limit: '25', offset: '100' }, OPTS)).toEqual({ limit: 25, offset: 100 });
  });

  it('floors fractional values', () => {
    expect(parsePageParams({ limit: '10.9', offset: '3.7' }, OPTS)).toEqual({ limit: 10, offset: 3 });
  });
});
