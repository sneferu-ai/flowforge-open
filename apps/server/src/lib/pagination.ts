/**
 * Query-string pagination parsing for list endpoints.
 *
 * `parseInt` alone admits NaN and negatives, which leak into SQL LIMIT/OFFSET
 * as query errors or silent full-table scans. These clamps guarantee sane
 * values: non-numeric/NaN → defaults; limit → [1, max]; offset → [0, ∞).
 */

export interface PageParams {
  limit: number;
  offset: number;
}

export function parsePageParams(
  query: Record<string, unknown>,
  opts: { defaultLimit: number; maxLimit: number }
): PageParams {
  return {
    limit: clampInt(query.limit, opts.defaultLimit, 1, opts.maxLimit),
    offset: clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
