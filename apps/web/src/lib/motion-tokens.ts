/**
 * Motion values read from the closed token layer (tokens.css).
 *
 * DESIGN.md §9/#14: no raw duration or easing values outside tokens.css.
 * Framer Motion needs numeric seconds / bezier arrays, and CSS custom
 * properties are strings — so this module reads the tokens from the live
 * stylesheet at call time (after CSS has loaded) and converts them.
 *
 * Because tokens.css zeroes every duration under prefers-reduced-motion,
 * reading the computed values here also honors that preference for free:
 * reduced-motion users get 0s durations even from Framer.
 */

type EaseTuple = [number, number, number, number];

/* Typed values from DESIGN.md §7 — used only when the stylesheet has not
 * loaded yet (an extreme edge case); the live token layer is authoritative. */
const DUR_MS_FALLBACK: Record<string, number> = {
  'dur-instant': 50,
  'dur-fast': 150,
  'dur-base': 200,
  'dur-slow': 350,
  'dur-pulse': 1500,
  'stagger-step': 40,
  'dur-copied-hint': 1500,
  'dur-redirect': 1200,
  'dur-poll-run': 1500,
  'dur-poll-notifications': 30000,
};

/** Names of the runtime-pacing tokens (transient hints, redirects, polls). */
export interface PacingToken {
  'dur-copied-hint': number;
  'dur-redirect': number;
  'dur-poll-run': number;
  'dur-poll-notifications': number;
}
export type PacingName = keyof PacingToken;
const EASE_FALLBACK: Record<string, EaseTuple> = {
  'ease-default': [0.4, 0, 0.2, 1],
  'ease-emphasized': [0.2, 0, 0, 1],
};

const ENTER_OFFSET_FALLBACK = 8;

let cached: {
  durations: Record<string, number>;
  eases: Record<string, EaseTuple>;
  enterOffset: number;
} | null = null;

function readTokens() {
  if (cached) return cached;
  const style =
    typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null;
  const durations: Record<string, number> = {};
  for (const name of Object.keys(DUR_MS_FALLBACK)) {
    const raw = style?.getPropertyValue(`--${name}`).trim() ?? '';
    const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
    durations[name] = Number.isFinite(ms) ? ms : DUR_MS_FALLBACK[name] ?? 0;
  }
  const eases: Record<string, EaseTuple> = {};
  for (const name of Object.keys(EASE_FALLBACK)) {
    const raw = style?.getPropertyValue(`--${name}`).trim() ?? '';
    const match = raw.match(/cubic-bezier\(([^)]+)\)/);
    if (match) {
      const values = match[1].split(',').map((v) => parseFloat(v.trim()));
      if (values.length === 4 && values.every((v) => Number.isFinite(v))) {
        eases[name] = values as EaseTuple;
        continue;
      }
    }
    eases[name] = EASE_FALLBACK[name];
  }
  const enterRaw = style?.getPropertyValue('--enter-offset').trim() ?? '';
  const enterPx = enterRaw.endsWith('px') ? parseFloat(enterRaw) : NaN;
  const enterOffset = Number.isFinite(enterPx) ? enterPx : ENTER_OFFSET_FALLBACK;
  cached = { durations, eases, enterOffset };
  return cached;
}

/** Seconds for a duration token — e.g. `dur('base')` → 0.2 */
export function dur(name: 'instant' | 'fast' | 'base' | 'slow' | 'pulse' | 'stagger'): number {
  const key = name === 'stagger' ? 'stagger-step' : `dur-${name}`;
  return readTokens().durations[key] / 1000;
}

/** Bezier tuple for an easing token — e.g. `ease('default')` → [0.4, 0, 0.2, 1] */
export function ease(name: 'default' | 'emphasized'): EaseTuple {
  return readTokens().eases[`ease-${name}`];
}

/** Milliseconds for a duration token — used by setTimeout/setInterval callers. */
export function durMs(name: 'instant' | 'fast' | 'base' | 'slow' | 'pulse' | 'stagger'): number {
  const key = name === 'stagger' ? 'stagger-step' : `dur-${name}`;
  return readTokens().durations[key];
}

/** Milliseconds for a runtime-pacing token — poll intervals and transient
 *  hints read from the same token layer. */
export function pacing(name: PacingName): number {
  return readTokens().durations[name];
}

/** Pixel value of the entrance-motion vertical offset token (--enter-offset).
 *  Use for Framer Motion `y` in page/section entrance animations instead of
 *  hardcoding `y: 8` or `y: 12`. DESIGN.md §7 centralizes entrance distance
 *  here alongside duration and easing. */
export function enterOffset(): number {
  return readTokens().enterOffset;
}
