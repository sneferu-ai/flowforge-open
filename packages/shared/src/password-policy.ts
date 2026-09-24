/**
 * Password policy: min 12 chars, max 128, at least one letter + one number,
 * top-10K breached passwords rejected (SHA-1 hashes loaded into Set at startup).
 * Seeding bypasses policy via direct SQL.
 *
 * Fail-closed rule: if the breached-password list cannot be loaded, every
 * password is treated as breached — an unreadable list must never silently
 * admit known-compromised passwords.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

let breachedHashSet: Set<string> | null = null;
let breachedListUnavailable = false;

function defaultListPath(): string {
  return join(__dirname, '..', 'data', 'breached-passwords.txt');
}

function loadBreachedHashes(filePath?: string): Set<string> {
  if (breachedHashSet && filePath === undefined) return breachedHashSet;
  try {
    const content = readFileSync(filePath ?? defaultListPath(), 'utf-8');
    const set = new Set(
      content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => l.toUpperCase())
    );
    breachedHashSet = set;
    breachedListUnavailable = false;
    return set;
  } catch {
    // Fail closed: mark the list unavailable and cache an empty set so the
    // failure is sticky (not a per-call disk retry storm).
    breachedHashSet = new Set();
    breachedListUnavailable = true;
    return breachedHashSet;
  }
}

/** True when the breached-password list could not be loaded (fail-closed state). */
export function isBreachedListUnavailable(): boolean {
  loadBreachedHashes();
  return breachedListUnavailable;
}

export function isBreachedPassword(password: string): boolean {
  loadBreachedHashes();
  if (breachedListUnavailable) return true; // fail closed
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  return breachedHashSet!.has(hash);
}

export interface PasswordPolicyResult {
  valid: boolean;
  /** Stable machine code: 'password_too_common' only for breached passwords;
   *  'validation_error' for length/complexity policy failures. */
  code?: 'password_too_common' | 'validation_error';
  error?: string;
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 12) {
    return { valid: false, code: 'validation_error', error: 'Password must be at least 12 characters' };
  }
  if (password.length > 128) {
    return { valid: false, code: 'validation_error', error: 'Password must be at most 128 characters' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, code: 'validation_error', error: 'Password must contain at least one letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, code: 'validation_error', error: 'Password must contain at least one number' };
  }
  if (isBreachedPassword(password)) {
    if (breachedListUnavailable) {
      return { valid: false, code: 'password_too_common', error: 'Password breach list is unavailable; password safety cannot be verified' };
    }
    return { valid: false, code: 'password_too_common', error: 'password_too_common' };
  }
  return { valid: true };
}

/**
 * Re-read the breached list from disk. `filePath` overrides the bundled list
 * location — used by tests to exercise the fail-closed path.
 */
export function reloadBreachedHashes(filePath?: string): void {
  breachedHashSet = null;
  breachedListUnavailable = false;
  loadBreachedHashes(filePath);
}
