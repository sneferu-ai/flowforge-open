/**
 * Minimal 5-field cron support — enough for the template gallery and the
 * DB-led scheduler (§6.3). Computes the next occurrence as UTC seconds.
 *
 * Field order: minute hour day-of-month month day-of-week (0-7, 0/7=Sunday).
 * Supported syntax per field: star, step (star slash N), single value,
 * comma list, ranges.
 */

const FIELD_LIMITS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7],  // day of week (0=Sunday, 7=Sunday)
];

export function isValidCron(expr: string): boolean {
  try {
    parseCronFieldList(expr);
    return true;
  } catch {
    return false;
  }
}

function parseCronFieldList(expr: string): Set<number>[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields, got ${parts.length}`);
  }
  return parts.map((field, idx) => parseCronField(field, FIELD_LIMITS[idx][0], FIELD_LIMITS[idx][1], idx));
}

function parseCronField(field: string, min: number, max: number, _idx: number): Set<number> {
  const values = new Set<number>();
  for (const piece of field.split(',')) {
    if (piece === '*') {
      for (let v = min; v <= max; v++) values.add(v);
      continue;
    }
    const stepMatch = piece.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      if (step < 1 || step > max) throw new Error(`invalid step: ${piece}`);
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }
    const rangeMatch = piece.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < min || hi > max || lo > hi) throw new Error(`invalid range: ${piece}`);
      for (let v = lo; v <= hi; v++) values.add(v);
      continue;
    }
    if (/^\d+$/.test(piece)) {
      const v = parseInt(piece, 10);
      if (v < min || v > max) throw new Error(`value out of range ${min}-${max}: ${piece}`);
      values.add(v);
      continue;
    }
    throw new Error(`unparseable cron field: ${piece}`);
  }
  return values;
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Compute the next fire time strictly after `from` (millis since epoch), UTC.
 * Handles day-of-month + day-of-week as a union (standard vixie-cron OR
 * semantics: when both are restricted, a date matching either fires).
 */
export function computeNextFire(cronExpr: string, from: Date = new Date()): Date {
  const [mins, hours, doms, months, dows] = parseCronFieldList(cronExpr);
  const domConstrained = doms.size !== 31;
  const dowConstrained = !(dows.has(0) && dows.has(1) && dows.has(2) && dows.has(3) && dows.has(4) && dows.has(5) && dows.has(6))
    && !(dows.has(7));

  const start = new Date(from.getTime() + 60_000); // strictly after, minute granularity
  const candidate = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    start.getUTCHours(),
    start.getUTCMinutes(),
    0,
    0
  ));

  // Search forward day by day (bounded; worst case a few years).
  for (let dayIter = 0; dayIter < 366 * 6; dayIter++) {
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth() + 1;
    const dom = candidate.getUTCDate();
    const dow = candidate.getUTCDay();

    const monthOk = months.has(month);
    const domOk = doms.has(dom);
    const dowOk = dows.has(dow);
    // OR semantics between dom and dow restrictions.
    const dayOk = monthOk && ((!domConstrained && !dowConstrained) || (domConstrained && domOk) || (dowConstrained && dowOk));

    if (dayOk) {
      for (let h = 0; h < 24; h++) {
        if (!hours.has(h)) continue;
        for (let m = 0; m < 60; m++) {
          if (!mins.has(m)) continue;
          const at = Date.UTC(year, month - 1, dom, h, m, 0, 0);
          if (at > from.getTime()) return new Date(at);
        }
      }
    }

    candidate.setUTCDate(candidate.getUTCDate() + 1);
    candidate.setUTCHours(0, 0, 0, 0);
  }

  throw new Error(`no occurrence found within 6 years: ${cronExpr}`);
}

export { daysInMonth };
