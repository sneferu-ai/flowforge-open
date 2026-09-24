/**
 * Duration parsing — `30s`..`30d` for the delay step (§5.3).
 * Returns milliseconds, or null when the duration is outside the contract.
 */

export function parseDurationMs(input: string): number | null {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  let ms: number;
  switch (unit) {
    case 's': ms = value * 1000; break;
    case 'm': ms = value * 60 * 1000; break;
    case 'h': ms = value * 60 * 60 * 1000; break;
    case 'd': ms = value * 24 * 60 * 60 * 1000; break;
    default: return null;
  }
  return ms;
}

/** True when the duration is within the local `forge run` cap of 5 minutes (D8). */
export function isWithinLocalDelayCap(input: string): boolean {
  const ms = parseDurationMs(input);
  return ms !== null && ms <= 5 * 60 * 1000;
}
