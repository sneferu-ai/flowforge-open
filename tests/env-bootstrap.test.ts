/**
 * Regression test for env-bootstrap secret generation.
 *
 * Spec §4.4 lists FF_VAULT_KEY, FF_SESSION_SECRET, and FF_OIDC_SIGNING_KEY
 * as required. The SOD runtime note states these must be generated at first
 * start and persisted under SOD_DATA_DIR, or have safe defaults.
 *
 * This test verifies:
 * 1. Secrets are generated (not pinned constants) when env vars are absent
 * 2. Secrets are persisted to SOD_DATA_DIR and stable across "restarts"
 * 3. Explicit env vars are NOT overridden
 * 4. FF_SEED_DEMO defaults to '0' (spec §4.4: optional, "No")
 * 5. resolveAppUrl() respects precedence (FF_APP_URL > APP_BASE_URL > port)
 * 6. encryptWithMeta works end-to-end with bootstrap-generated keys
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const envBackup: Record<string, string | undefined> = {};

const SECRET_VARS = [
  'FF_VAULT_KEY',
  'FF_ENCRYPTION_KEY',
  'FF_SESSION_SECRET',
  'FF_OIDC_SIGNING_KEY',
  'FF_SEED_DEMO',
  'FF_APP_URL',
  'APP_BASE_URL',
  'SOD_DATA_DIR',
];

let tempDir: string;

describe('env-bootstrap', () => {
  beforeEach(() => {
    for (const key of SECRET_VARS) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), 'ff-env-test-'));
  });

  afterEach(() => {
    for (const key of SECRET_VARS) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    vi.resetModules();
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('generates a 32-byte FF_VAULT_KEY when not provided', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_VAULT_KEY).toBeTruthy();
    const decoded = Buffer.from(process.env.FF_VAULT_KEY!, 'base64');
    expect(decoded.length).toBe(32);
  });

  it('generates a non-empty FF_SESSION_SECRET when not provided', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SESSION_SECRET).toBeTruthy();
    expect(process.env.FF_SESSION_SECRET!.length).toBeGreaterThan(10);
  });

  it('generates a 32-byte FF_OIDC_SIGNING_KEY when not provided', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_OIDC_SIGNING_KEY).toBeTruthy();
    const decoded = Buffer.from(process.env.FF_OIDC_SIGNING_KEY!, 'base64');
    expect(decoded.length).toBe(32);
  });

  it('persists secrets to SOD_DATA_DIR and reuses them on subsequent loads', async () => {
    process.env.SOD_DATA_DIR = tempDir;

    // First import — generates and persists.
    await import('../apps/server/src/env-bootstrap.js');
    const firstVaultKey = process.env.FF_VAULT_KEY;
    const firstSessionSecret = process.env.FF_SESSION_SECRET;
    const firstOidcKey = process.env.FF_OIDC_SIGNING_KEY;
    expect(firstVaultKey).toBeTruthy();
    expect(firstSessionSecret).toBeTruthy();
    expect(firstOidcKey).toBeTruthy();

    // The secrets file should exist on disk.
    const secretsPath = join(tempDir, 'flowforge-secrets.json');
    expect(existsSync(secretsPath)).toBe(true);

    // Clear env vars and re-import — should load the persisted secrets.
    delete process.env.FF_VAULT_KEY;
    delete process.env.FF_SESSION_SECRET;
    delete process.env.FF_OIDC_SIGNING_KEY;
    vi.resetModules();
    await import('../apps/server/src/env-bootstrap.js');

    expect(process.env.FF_VAULT_KEY).toBe(firstVaultKey);
    expect(process.env.FF_SESSION_SECRET).toBe(firstSessionSecret);
    expect(process.env.FF_OIDC_SIGNING_KEY).toBe(firstOidcKey);
  });

  it('generates unique secrets per SOD_DATA_DIR (not pinned constants)', async () => {
    // First deployment.
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    const key1 = process.env.FF_VAULT_KEY!;

    // Second deployment with a fresh data dir.
    const tempDir2 = mkdtempSync(join(tmpdir(), 'ff-env-test2-'));
    try {
      delete process.env.FF_VAULT_KEY;
      delete process.env.FF_SESSION_SECRET;
      delete process.env.FF_OIDC_SIGNING_KEY;
      vi.resetModules();
      process.env.SOD_DATA_DIR = tempDir2;
      await import('../apps/server/src/env-bootstrap.js');
      const key2 = process.env.FF_VAULT_KEY!;

      // Keys must differ — no shared deterministic constant across deployments.
      expect(key2).not.toBe(key1);
    } finally {
      rmSync(tempDir2, { recursive: true, force: true });
    }
  });

  it('generates ephemeral secrets when SOD_DATA_DIR is absent (dev/test)', async () => {
    // SOD_DATA_DIR is deliberately NOT set.
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_VAULT_KEY).toBeTruthy();
    const decoded = Buffer.from(process.env.FF_VAULT_KEY!, 'base64');
    expect(decoded.length).toBe(32);
  });

  it('preserves an unreadable persisted secrets file instead of overwriting it', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    const secretsPath = join(tempDir, 'flowforge-secrets.json');

    // A corrupted persisted file — e.g. a truncated write or manual edit.
    writeFileSync(secretsPath, '{"FF_VAULT_KE', 'utf-8');
    const originalBytes = readFileSync(secretsPath);

    await import('../apps/server/src/env-bootstrap.js');

    // New secrets were generated...
    expect(process.env.FF_VAULT_KEY).toBeTruthy();
    // ...the unreadable original was preserved under a .corrupt-* sibling
    // (overwriting it would destroy the keys that encrypted existing data)...
    const corruptCopies = readdirSync(tempDir).filter((f) => f.startsWith('flowforge-secrets.json.corrupt-'));
    expect(corruptCopies.length).toBe(1);
    expect(readFileSync(join(tempDir, corruptCopies[0]))).toEqual(originalBytes);
    // ...and the canonical path now holds the fresh, parseable set.
    const fresh = JSON.parse(readFileSync(secretsPath, 'utf-8')) as Record<string, unknown>;
    expect(typeof fresh.FF_VAULT_KEY).toBe('string');
    expect(fresh.FF_VAULT_KEY).toBe(process.env.FF_VAULT_KEY);
  });

  it('treats a persisted file with empty secret fields as unusable', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    const secretsPath = join(tempDir, 'flowforge-secrets.json');
    writeFileSync(
      secretsPath,
      JSON.stringify({ FF_VAULT_KEY: '', FF_SESSION_SECRET: 'x', FF_OIDC_SIGNING_KEY: 'y' }),
      'utf-8'
    );

    await import('../apps/server/src/env-bootstrap.js');

    expect(process.env.FF_VAULT_KEY).toBeTruthy();
    expect(process.env.FF_VAULT_KEY).not.toBe('');
    const corruptCopies = readdirSync(tempDir).filter((f) => f.startsWith('flowforge-secrets.json.corrupt-'));
    expect(corruptCopies.length).toBe(1);
  });

  it('persists with an exclusive-create flag so concurrent processes cannot split the vault', async () => {
    // standalone mode runs the server AND the worker in two processes that
    // both import this bootstrap; last-write-wins on a plain write would let
    // each process encrypt with a different key. Source-pin the exclusive
    // create + adoption behavior.
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(testDir, '..', 'apps/server/src/env-bootstrap.ts'), 'utf-8');
    expect(source).toContain("flag: 'wx'");
    expect(source).toContain("code === 'EEXIST'");
    expect(source).toContain('Adopt its secrets');
  });

  it('defaults FF_SEED_DEMO to 0 when not provided', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SEED_DEMO).toBe('0');
  });

  it('does NOT override FF_VAULT_KEY when explicitly set', async () => {
    process.env.FF_VAULT_KEY = 'explicit-test-key-padded-to-32-bytes!!';
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_VAULT_KEY).toBe('explicit-test-key-padded-to-32-bytes!!');
  });

  it('records the operator-provided vault key in the persisted file', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    process.env.FF_VAULT_KEY = 'operator-vault-key-material-32-byte!!';
    await import('../apps/server/src/env-bootstrap.js');

    // The file must record the key the data is actually encrypted with —
    // persisting a random never-used key would silently break decryption
    // the first time the operator boots without the explicit env var.
    const file = JSON.parse(readFileSync(join(tempDir, 'flowforge-secrets.json'), 'utf-8')) as Record<string, unknown>;
    expect(file.FF_VAULT_KEY).toBe('operator-vault-key-material-32-byte!!');
    expect(process.env.FF_VAULT_KEY).toBe('operator-vault-key-material-32-byte!!');
    expect(typeof file.FF_SESSION_SECRET).toBe('string');

    // "Reboot" without the operator env var → the recorded key is restored
    // from disk, so encrypted data stays decryptable.
    delete process.env.FF_VAULT_KEY;
    delete process.env.FF_SESSION_SECRET;
    delete process.env.FF_OIDC_SIGNING_KEY;
    vi.resetModules();
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_VAULT_KEY).toBe('operator-vault-key-material-32-byte!!');
  });

  it('does NOT override FF_SESSION_SECRET when explicitly set', async () => {
    process.env.FF_SESSION_SECRET = 'my-explicit-secret';
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SESSION_SECRET).toBe('my-explicit-secret');
  });

  it('does NOT override FF_SEED_DEMO when explicitly set to 1', async () => {
    process.env.FF_SEED_DEMO = '1';
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SEED_DEMO).toBe('1');
  });

  it('does NOT set FF_VAULT_KEY when FF_ENCRYPTION_KEY is already set', async () => {
    process.env.FF_ENCRYPTION_KEY = 'legacy-encryption-key-padded-32-byte';
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_VAULT_KEY).toBeUndefined();
    expect(process.env.FF_ENCRYPTION_KEY).toBe('legacy-encryption-key-padded-32-byte');
  });

  it('resolveAppUrl: prefers FF_APP_URL when set', async () => {
    const { resolveAppUrl } = await import('../apps/server/src/env-bootstrap.js');
    process.env.FF_APP_URL = 'https://forge.example.com';
    expect(resolveAppUrl(9999)).toBe('https://forge.example.com');
  });

  it('resolveAppUrl: uses APP_BASE_URL when FF_APP_URL is absent', async () => {
    const { resolveAppUrl } = await import('../apps/server/src/env-bootstrap.js');
    process.env.APP_BASE_URL = 'https://sod.example.com';
    expect(resolveAppUrl(9999)).toBe('https://sod.example.com');
  });

  it('resolveAppUrl: derives from port when neither is set', async () => {
    const { resolveAppUrl } = await import('../apps/server/src/env-bootstrap.js');
    expect(resolveAppUrl(18080)).toBe('http://localhost:18080');
  });

  it('encryptWithMeta works end-to-end with bootstrap-generated keys', async () => {
    process.env.SOD_DATA_DIR = tempDir;
    await import('../apps/server/src/env-bootstrap.js');
    const { encryptWithMeta } = await import('../apps/server/src/crypto.js');
    const result = encryptWithMeta('test-secret-value', 'ws-test-id');
    expect(result.valueEnc).toBeTruthy();
    expect(result.nonce).toBeTruthy();
    expect(result.keyVersion).toBe(1);
  });
});

/**
 * §4.4/§10.4 demo identity resolution — isDemoSeedEnabled and
 * getDemoSettings read process.env AT CALL TIME, so these tests mutate the
 * env directly and never need module resets.
 */
describe('demo settings (getDemoSettings / isDemoSeedEnabled)', () => {
  const DEMO_VARS = ['FF_SEED_DEMO', 'FF_DEMO_EMAIL', 'FF_DEMO_PASSWORD'] as const;
  const demoBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of DEMO_VARS) {
      demoBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of DEMO_VARS) {
      if (demoBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = demoBackup[key];
      }
    }
  });

  it('returns the committed defaults when all three env vars are unset', async () => {
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    const settings = getDemoSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.email).toBe('demo@acme.test');
    expect(settings.password).toBe('demo-pass-2026');
  });

  it('runtime default guard: no FF_DEMO_PASSWORD in env yields demo-pass-2026', async () => {
    delete process.env.FF_DEMO_PASSWORD;
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().password).toBe('demo-pass-2026');
  });

  it('passes overrides through verbatim (email lowercased to match the login route)', async () => {
    process.env.FF_DEMO_EMAIL = 'ops@demo.test';
    process.env.FF_DEMO_PASSWORD = 'custom-pass-99';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    const settings = getDemoSettings();
    expect(settings.email).toBe('ops@demo.test');
    expect(settings.password).toBe('custom-pass-99');
  });

  it('preserves internal whitespace in passwords', async () => {
    process.env.FF_DEMO_PASSWORD = 'my pass 2026';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().password).toBe('my pass 2026');
  });

  it('preserves a whitespace-only password (passwords are whitespace-significant)', async () => {
    process.env.FF_DEMO_PASSWORD = '   ';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().password).toBe('   ');
  });

  it('preserves leading and trailing whitespace in passwords', async () => {
    process.env.FF_DEMO_PASSWORD = ' pass2026 ';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().password).toBe(' pass2026 ');
  });

  it('defaults an empty-string password', async () => {
    process.env.FF_DEMO_PASSWORD = '';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().password).toBe('demo-pass-2026');
  });

  it('defaults an empty-string email', async () => {
    process.env.FF_DEMO_EMAIL = '';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().email).toBe('demo@acme.test');
  });

  it('defaults a whitespace-only email (email trims; password does not)', async () => {
    process.env.FF_DEMO_EMAIL = '   ';
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    expect(getDemoSettings().email).toBe('demo@acme.test');
  });

  it('enabled follows FF_SEED_DEMO through the narrow predicate', async () => {
    const { getDemoSettings } = await import('../apps/server/src/env-bootstrap.js');
    process.env.FF_SEED_DEMO = 'true';
    expect(getDemoSettings().enabled).toBe(true);
    process.env.FF_SEED_DEMO = '1';
    expect(getDemoSettings().enabled).toBe(true);
    process.env.FF_SEED_DEMO = 'yes';
    expect(getDemoSettings().enabled).toBe(false);
  });

  it('isDemoSeedEnabled accepts only "1" and "true" (case-insensitive, trimmed)', async () => {
    const { isDemoSeedEnabled } = await import('../apps/server/src/env-bootstrap.js');
    for (const truthy of ['1', 'true', 'TRUE', 'True', '  true  ', ' 1 ']) {
      expect(isDemoSeedEnabled(truthy), truthy).toBe(true);
    }
    for (const falsy of ['0', 'false', 'FALSE', '', 'yes', 'no', 'on', 'off', '2', 'truthy']) {
      expect(isDemoSeedEnabled(falsy), falsy).toBe(false);
    }
    expect(isDemoSeedEnabled(undefined)).toBe(false);
    expect(isDemoSeedEnabled(null)).toBe(false);
  });

  it('canonicalizes enabled FF_SEED_DEMO spellings to "1" at import so every reader agrees', async () => {
    // The import-time side effect must rewrite case-variant enabled spellings
    // so run-executor's literal `!== 'true' && !== '1'` loopback-exemption
    // gate (server AND worker processes) agrees with the seeding predicate —
    // otherwise a `TRUE` env seeds the demo workspace whose workflows all
    // fail with private_ip_blocked.
    process.env.FF_SEED_DEMO = 'TRUE';
    vi.resetModules();
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SEED_DEMO).toBe('1');
    // A spread spelling is trimmed by the predicate and canonicalized too.
    process.env.FF_SEED_DEMO = '  true  ';
    vi.resetModules();
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SEED_DEMO).toBe('1');
    // Non-enabled spellings pass through untouched (both readers stay off).
    process.env.FF_SEED_DEMO = 'yes';
    vi.resetModules();
    await import('../apps/server/src/env-bootstrap.js');
    expect(process.env.FF_SEED_DEMO).toBe('yes');
  });
});
