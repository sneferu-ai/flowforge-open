/**
 * Delivery-contract regression pins (repair round 2026-09-20).
 *
 * packaging.json is the file the SOD/native runtime contract reads at the
 * tree root. These tests keep every seat in the cooperative loop from
 * drifting it back into a refused build:
 *
 *  - every required top-level key, with the exact shapes the contract
 *    checker enforces (`{port}` literal, absolute health path, list-typed
 *    system_deps/env_var_names, integer container_port);
 *  - one entrypoint, one port: the declared start command is a single
 *    node process — the interface validator refuses any command with an
 *    ampersand (a second listener or a shell chain);
 *  - the Dockerfile entrypoint and the declared command name the same
 *    process, and that process performs its own initialization (migrations
 *    + plans + system jobs, demo gated on FF_SEED_DEMO) — importing the
 *    seed module must not execute its CLI main;
 *  - the browser smoke plan the declaration points at exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), 'utf-8')) as Record<string, unknown>;
}

describe('packaging.json delivery contract', () => {
  const packaging = readJson('packaging.json');

  it('declares a start command with the literal {port} placeholder', () => {
    const command = packaging.runtime_test_command;
    expect(typeof command).toBe('string');
    expect((command as string).trim().length).toBeGreaterThan(0);
    expect(command as string).toContain('{port}');
  });

  it('starts exactly one process, no shell chaining or ampersands', () => {
    const command = packaging.runtime_test_command as string;
    expect(command).not.toContain('&');
    expect(command).not.toContain(';');
    expect(command).not.toContain('|');
  });

  it('names the compiled single-process entrypoint', () => {
    expect(packaging.runtime_test_command).toBe('node apps/server/dist/index.js --port {port}');
  });

  it('declares an absolute health endpoint the server implements', () => {
    const health = packaging.health_endpoint;
    expect(typeof health).toBe('string');
    expect(health as string).toBe('/readyz');
    const route = readFileSync(join(root, 'apps/server/src/routes/health.ts'), 'utf-8');
    expect(route).toContain(`'/readyz'`);
  });

  it('declares playwright proof mode (a browser-UI interface)', () => {
    expect(packaging.runtime_test_mode).toBe('playwright');
  });

  it('declares a requirements_file that exists in the tree', () => {
    expect(packaging.requirements_file).toBe('package.json');
    expect(existsSync(join(root, packaging.requirements_file as string))).toBe(true);
  });

  it('declares a browser_smoke_plan that names a present file', () => {
    const plan = packaging.browser_smoke_plan;
    expect(typeof plan).toBe('string');
    const path = join(root, plan as string);
    expect(statSync(path).isFile()).toBe(true);
  });

  it('declares list-typed system_deps and env_var_names', () => {
    expect(Array.isArray(packaging.system_deps)).toBe(true);
    expect(Array.isArray(packaging.env_var_names)).toBe(true);
    for (const name of packaging.env_var_names as unknown[]) {
      expect(typeof name).toBe('string');
    }
  });

  it('declares the env vars the server actually reads', () => {
    const names = new Set(packaging.env_var_names as string[]);
    for (const required of [
      'FF_DATABASE_URL',
      'FF_REDIS_URL',
      'FF_PORT',
      'PORT',
      'FF_VAULT_KEY',
      'FF_SESSION_SECRET',
      'FF_APP_URL',
      'FF_SEED_DEMO',
      'FF_DEMO_PASSWORD',
      'FF_OIDC_SIGNING_KEY',
      'FF_WORKER_MODE',
      'FF_WORKER_CONCURRENCY',
      'FF_CONNECTOR_URL',
      'FF_CONNECTOR_TOKEN',
      'FF_HTTP_ALLOWLIST',
      'HOST',
    ]) {
      expect(names.has(required), required).toBe(true);
    }
  });

  it('declares an integer container_port matching the Dockerfile EXPOSE', () => {
    const port = packaging.container_port;
    expect(Number.isInteger(port)).toBe(true);
    expect(port as number).toBeGreaterThanOrEqual(1);
    expect(port as number).toBeLessThanOrEqual(65535);
    expect(readFileSync(join(root, 'Dockerfile'), 'utf-8')).toContain(`EXPOSE ${port}`);
  });
});

describe('single entrypoint owns initialization', () => {
  it('the Dockerfile entrypoint is the same single process', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf-8');
    expect(dockerfile).toContain('CMD ["node", "apps/server/dist/index.js"]');
  });

  it('the entrypoint wires migrations + plans + jobs + demo seeding in-process', () => {
    const index = readFileSync(join(root, 'apps/server/src/index.ts'), 'utf-8');
    expect(index).toContain('runMigrations');
    expect(index).toContain('seedPlans()');
    expect(index).toContain('seedSystemJobs()');
    expect(index).toContain('seedDemo()');
    // The demo gate flows through the shared narrow predicate ('1'/'true'),
    // so every lane (CLI seed, server boot) evaluates the flag identically.
    expect(index).toContain('isDemoSeedEnabled(process.env.FF_SEED_DEMO)');
  });

  it('importing the seed module does not execute its CLI main', async () => {
    // getPool() throws when FF_DATABASE_URL is unset, so importing the
    // module succeeds only if its main() is guarded to direct execution.
    delete process.env.FF_DATABASE_URL;
    await import('../apps/server/src/db/seed.js');
  });

  it('the seed CLI stays available for operators', () => {
    const seed = readFileSync(join(root, 'apps/server/src/db/seed.ts'), 'utf-8');
    // pathToFileURL: process.argv[1] is the path AS TYPED (relative on every
    // documented invocation), so a bare string compare would never match.
    expect(seed).toContain(
      'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)'
    );
    expect(seed).toContain("const target = process.argv[2] || 'all'");
  });
});

describe('no credentials in the source tree', () => {
  // SOD delivery contract: no private keys, certificates, or other credential
  // material may be committed to the repository. Tests that need such material
  // (e.g. OIDC RS256 keypairs) must generate it at test time.
  const CRED_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx'];
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', '.tmp', 'test-results', 'playwright-report']);

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, files);
      } else if (CRED_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        files.push(full);
      }
    }
    return files;
  }

  it('contains no .pem/.key/.p12/.pfx files outside node_modules/dist/.git', () => {
    const found = walk(root);
    expect(found, `Found credential files in source tree: ${found.join(', ')}`).toEqual([]);
  });
});

/**
 * Demo-env relocation contract (repair round 2026-09-21): the three demo
 * variables live in top-level `env_defaults` — which Sneferu injects into
 * EVERY run lane (launch proof, preview, workers, delivered installation;
 * orchestrator/sod/runtime_binding.py provided_runtime_inputs) — and never
 * under `runtime_test`, which only the proof lane reads.
 */
describe('packaging.json env_defaults relocation', () => {
  const packaging = readJson('packaging.json');

  it('env_defaults carries the three demo variables with the committed values', () => {
    const defaults = packaging.env_defaults as Record<string, string>;
    expect(defaults).toBeTruthy();
    expect(defaults.FF_SEED_DEMO).toBe('true');
    expect(defaults.FF_DEMO_EMAIL).toBe('demo@acme.test');
    expect(defaults.FF_DEMO_PASSWORD).toBe('demo-pass-2026');
  });

  it('the runtime_test subtree contains zero occurrences of the demo variables', () => {
    const runtimeTest = JSON.stringify(packaging.runtime_test ?? {});
    for (const name of ['FF_SEED_DEMO', 'FF_DEMO_EMAIL', 'FF_DEMO_PASSWORD']) {
      expect(runtimeTest, name).not.toContain(name);
    }
  });

  it('env_var_names remains a superset of the three names', () => {
    const names = new Set(packaging.env_var_names as string[]);
    for (const name of ['FF_SEED_DEMO', 'FF_DEMO_EMAIL', 'FF_DEMO_PASSWORD']) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('runtime_test_command is byte-identical to the pinned single-process entrypoint', () => {
    expect(packaging.runtime_test_command).toBe('node apps/server/dist/index.js --port {port}');
  });
});

describe('browser_smoke_plan demo-login journey', () => {
  const packaging = readJson('packaging.json');

  it('the smoke plan is an ordered, executable login journey over the on-page credentials', () => {
    // Schema-adaptive: browser_smoke_plan may be an inline step list under
    // an actions/steps/journey/scenarios key, or a path to a file holding
    // the journey (the current contract: a markdown file of ordered steps).
    const planRef = packaging.browser_smoke_plan;
    let lines: string[] = [];
    if (typeof planRef === 'string') {
      const fileText = readFileSync(join(root, planRef), 'utf-8');
      lines = fileText.split('\n').filter((l) => /^\s*(\d+\.|[a-z]\.)\s+/.test(l));
    } else if (planRef && typeof planRef === 'object') {
      const container = planRef as Record<string, unknown>;
      const key = ['actions', 'steps', 'journey', 'scenarios'].find((k) => Array.isArray(container[k]));
      const steps = key ? (container[key] as Array<Record<string, unknown>>) : [];
      lines = steps.map((s) => `${s.action ?? s.type ?? ''} ${s.target ?? ''} ${s.selector ?? ''} ${JSON.stringify(s)}`);
    }
    expect(lines.length).toBeGreaterThan(0);

    // Vocabulary: every action type must be a recognized executable verb —
    // unknown action types (e.g. noop) fail here.
    const VOCAB = /navigate|goto|assert|visible|read|text|fill|type|click|submit|press|url|dashboard/i;
    const loginSteps = lines.filter((l) => /demo-credentials|login-(email|password|submit)|\/login|dashboard/i.test(l));
    for (const step of loginSteps) {
      expect(VOCAB.test(step), `unrecognized action: ${step.trim()}`).toBe(true);
    }

    // The three data-testids appear in the journey.
    const joined = loginSteps.join('\n');
    expect(joined).toContain('demo-credentials-email');
    expect(joined).toContain('demo-credentials-password');
    expect(joined).toMatch(/demo-credentials/);

    // Ordering: navigate → assert visible → read → fill → submit → dashboard.
    const order = [
      { name: 'navigate to /login', re: /navigate.*\/login/i },
      { name: 'assert credentials visible', re: /assert.*demo-credentials.*visible|visible.*demo-credentials/i },
      { name: 'read email text', re: /read.*demo-credentials-email/i },
      { name: 'read password text', re: /read.*demo-credentials-password/i },
      { name: 'fill email', re: /fill.*login-email/i },
      { name: 'fill password', re: /fill.*login-password/i },
      { name: 'submit', re: /(click|submit|press).*login-submit/i },
      { name: 'assert dashboard', re: /(assert|url).*dashboard|dashboard.*(url|loaded)/i },
    ];
    let cursor = -1;
    for (const { name, re } of order) {
      const idx = lines.findIndex((l, i) => i > cursor && re.test(l));
      expect(idx, `${name} found after step ${cursor}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });
});
