/**
 * CLI behavior tests (spec §11, test plan scenario 34):
 *   - credentials.json contract ({ url, workspace_slug, token }, 0600)
 *   - validate/parse helpers and typed --input values
 *   - forge run local engine (delay cap, non-interactive approval,
 *     dry-run approval skip, host_not_allowed without FF_APP_URL)
 *   - forge run --demo in-process server (query semantics + /api/v1 mount)
 *   - hosted commands (login/push/pull/runs/logs/export) against a mock server
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseManifest, type Manifest, type Step } from '@flowforge/engine';
import {
  apiRequest,
  buildInitManifest,
  collectInputs,
  fetchRunSteps,
  fetchWorkflowManifest,
  findAvailablePort,
  getCredentials,
  listRuns,
  loginToServer,
  parseInputValue,
  parseLocalDuration,
  pullWorkflows,
  pushWorkflows,
  runLocally,
  saveCredentials,
  sanitizeSlug,
  startDemoServer,
  toManifestSlug,
} from '../src/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPO_INVOICE_CHASER = fileURLToPath(
  new URL('../../../workflows/invoice-chaser.ff.yaml', import.meta.url),
);

let tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

function useConfigDir(): string {
  const dir = tempDir();
  process.env.FLOWFORGE_CONFIG_DIR = dir;
  return dir;
}

function step(id: string, type: string, withConfig: Record<string, unknown> = {}, extra: Partial<Step> = {}): Step {
  return { id, type, with: withConfig, ...extra } as Step;
}

function makeManifest(steps: Step[]): Manifest {
  return {
    api_version: 'flowforge/v1',
    name: 'local-fixture',
    triggers: [{ type: 'schedule', cron: '0 9 * * 1-5', timezone: 'UTC' }],
    steps,
  } as unknown as Manifest;
}

interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface MockInstance {
  url: string;
  requests: MockRequest[];
  close: () => Promise<void>;
  handler: (req: MockRequest, res: ServerResponse) => void;
}

function startMockServer(
  handler: (req: MockRequest, res: ServerResponse) => void,
): Promise<MockInstance> {
  const requests: MockRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body: unknown;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      const record: MockRequest = {
        method: req.method || 'GET',
        path: req.url || '/',
        headers: req.headers,
        body,
      };
      requests.push(record);
      handler(record, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        handler,
        close: () => new Promise<void>((r) => {
          // Drop keep-alive sockets so undici can never reuse a stale
          // connection after the port is re-bound by a later test.
          server.closeAllConnections();
          server.close(() => r());
        }),
      });
    });
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// Successive tests each get a DIFFERENT port so Node's global undici pool
// (keyed by origin host:port) can never hand a request a stale keep-alive
// socket left over from a previously closed demo server on the same port.
// 200 distinct origins (stride 130) before wrapping — far more than one run.
const DEMO_PORT_STRIDE = 130;
let demoPortCursor = 0;

async function nextDemoPort(): Promise<number | null> {
  const base = 33000 + (demoPortCursor++ % 200) * DEMO_PORT_STRIDE;
  const port = await findAvailablePort(base, Math.min(base + DEMO_PORT_STRIDE - 2, 61000));
  if (port !== null) return port;
  // Window exhausted — fall back to the CLI's own scan range.
  return findAvailablePort(32768, 61000);
}

async function withDemoServer(fn: (base: string, server: Server) => Promise<void> | void): Promise<void> {
  const port = await nextDemoPort();
  expect(port).not.toBeNull();
  const server = startDemoServer(port!);
  await once(server, 'listening');
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}

let mocks: MockInstance[] = [];

beforeEach(() => {
  process.env.FLOWFORGE_CONFIG_DIR = tempDir();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FLOWFORGE_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  for (const mock of mocks.splice(0)) {
    await mock.close();
  }
});

// ─── Credentials contract (§11) ──────────────────────────────────────────────

describe('credentials.json', () => {
  it('returns null when not logged in', () => {
    expect(getCredentials()).toBeNull();
  });

  it('round-trips { url, workspace_slug, token } with mode 0600', () => {
    const dir = useConfigDir();
    saveCredentials({ url: 'http://server:3000', workspace_slug: 'acme', token: 'ff_secret' });
    const file = join(dir, 'credentials.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(getCredentials()).toEqual({ url: 'http://server:3000', workspace_slug: 'acme', token: 'ff_secret' });
  });

  it('returns null for a corrupted credentials file', () => {
    const dir = useConfigDir();
    writeFileSync(join(dir, 'credentials.json'), '{ not json');
    expect(getCredentials()).toBeNull();
  });

  it('returns null for a credentials file missing url/token', () => {
    const dir = useConfigDir();
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ workspace_slug: 'acme' }));
    expect(getCredentials()).toBeNull();
  });
});

// ─── Input and duration parsing (§11) ────────────────────────────────────────

describe('input parsing', () => {
  it('parses JSON-valid --input values as native types, else strings', () => {
    expect(parseInputValue('5')).toBe(5);
    expect(parseInputValue('true')).toBe(true);
    expect(parseInputValue('"hello"')).toBe('hello');
    expect(parseInputValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseInputValue('[1,2]')).toEqual([1, 2]);
    expect(parseInputValue('not-json')).toBe('not-json');
    expect(parseInputValue('5x')).toBe('5x');
  });

  it('collectInputs aggregates repeated key=value pairs', () => {
    let acc: Record<string, string> = {};
    acc = collectInputs('a=1', acc);
    acc = collectInputs('b=x=y', acc);
    expect(acc).toEqual({ a: '1', b: 'x=y' });
    expect(collectInputs('novalue', {})).toEqual({});
  });

  it('parseLocalDuration covers s/m/h/d and rejects garbage', () => {
    expect(parseLocalDuration('30s')).toBe(30_000);
    expect(parseLocalDuration('5m')).toBe(300_000);
    expect(parseLocalDuration('2h')).toBe(2 * 3_600_000);
    expect(parseLocalDuration('1d')).toBe(86_400_000);
    expect(parseLocalDuration('bogus')).toBeNull();
    expect(parseLocalDuration('10w')).toBeNull();
  });
});

// ─── forge run --demo server (§11, §13.2) ───────────────────────────────────

describe('demo server', () => {
  it('serves /demo/invoices with status filter and opt-in escalation', async () => {
    await withDemoServer(async (base) => {
      const overdue = await (await fetch(`${base}/demo/invoices?status=overdue`)).json() as {
        invoices: Array<{ days_overdue: number }>;
      };
      expect(overdue.invoices).toHaveLength(2);
      for (const row of overdue.invoices) {
        expect(row.days_overdue).toBeGreaterThan(0);
        expect(row.days_overdue).toBeLessThan(45);
      }

      const escalated = await (await fetch(`${base}/demo/invoices?status=overdue&include_escalations=1`)).json() as {
        invoices: Array<{ days_overdue: number }>;
      };
      expect(escalated.invoices).toHaveLength(3);
      expect(escalated.invoices.filter((i) => i.days_overdue === 45)).toHaveLength(1);
    });
  });

  it('excludes the escalation fixture by default even without a status filter', async () => {
    await withDemoServer(async (base) => {
      const all = await (await fetch(`${base}/demo/invoices`)).json() as {
        invoices: Array<{ days_overdue: number }>;
      };
      expect(all.invoices).toHaveLength(3);
      expect(all.invoices.every((i) => i.days_overdue < 45)).toBe(true);
    });
  });

  it('serves the /api/v1/demo mount with the stuck→stalled alias for orders', async () => {
    await withDemoServer(async (base) => {
      const orders = await (await fetch(`${base}/api/v1/demo/orders?status=stuck`)).json() as {
        orders: Array<{ status: string }>;
      };
      expect(orders.orders).toHaveLength(2);
      expect(orders.orders.every((o) => o.status === 'stalled')).toBe(true);

      const clients = await (await fetch(`${base}/api/v1/demo/clients`)).json() as {
        clients: unknown[];
      };
      expect(clients.clients).toHaveLength(4);
    });
  });

  it('404s unknown demo endpoints', async () => {
    await withDemoServer(async (base) => {
      const res = await fetch(`${base}/demo/nope`);
      expect(res.status).toBe(404);
    });
  });

  it('scans a trusted port range for the first available port', async () => {
    const port = await findAvailablePort(32768, 61000);
    expect(port).not.toBeNull();
    expect(port).toBeGreaterThanOrEqual(32768);
    expect(port).toBeLessThanOrEqual(61000);
  });

  it('reports null when every port in the range is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(32768, '127.0.0.1', () => resolve()));
    try {
      expect(await findAvailablePort(32768, 32768)).toBeNull();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

// ─── forge run local engine ──────────────────────────────────────────────────

describe('run locally', () => {
  it('runs the shipped invoice-chaser manifest end to end against the demo server', async () => {
    const raw = readFileSync(REPO_INVOICE_CHASER, 'utf-8');
    const manifest = parseManifest(raw);
    await withDemoServer(async (base) => {
      const result = await runLocally(manifest, {}, { FF_APP_URL: base });
      expect(result.ok).toBe(true);
      // fetch_overdue + per_invoice + 2×(send_reminder, check_escalation) + log_completion
      expect(result.stepCount).toBe(7);
    });
  });

  it('escalation run needs an interactive terminal for manual_approval', async () => {
    const raw = readFileSync(REPO_INVOICE_CHASER, 'utf-8');
    const manifest = parseManifest(raw.replace('?status=overdue', '?status=overdue&include_escalations=1'));
    await withDemoServer(async (base) => {
      const result = await runLocally(manifest, {}, { FF_APP_URL: base });
      expect(result.ok).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('non_interactive_approval_unsupported'));
    });
  });

  it('--dry-run skips approval prompts and completes (step skipped)', async () => {
    const raw = readFileSync(REPO_INVOICE_CHASER, 'utf-8');
    const manifest = parseManifest(raw.replace('?status=overdue', '?status=overdue&include_escalations=1'));
    await withDemoServer(async (base) => {
      const result = await runLocally(manifest, {}, { FF_APP_URL: base }, { dryRun: true });
      expect(result.ok).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('skipped (dry-run)'));
    });
  });

  it('evaluates env.FF_APP_URL as null without --demo; relative http URL fails host_not_allowed', () => {
    const manifest = makeManifest([
      step('fetch', 'http', { method: 'GET', url: '{{ env.FF_APP_URL }}/demo/invoices' }),
    ]);
    return runLocally(manifest, {}, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('host_not_allowed'));
    });
  });

  it('rejects delays above the local 5-minute cap', () => {
    const manifest = makeManifest([step('nap', 'delay', { duration: '6m' })]);
    return runLocally(manifest, {}, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not supported in local mode'));
    });
  });

  it('sleeps through an in-cap delay', () => {
    const manifest = makeManifest([step('nap', 'delay', { duration: '1s' })]);
    return runLocally(manifest, {}, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(true);
    });
  });

  it('fails for_each with type_mismatch when over is not a list', () => {
    const manifest = makeManifest([step('loop', 'for_each', { over: '"nope"', steps: [] })]);
    return runLocally(manifest, {}, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('type_mismatch'));
    });
  });

  it('propagates a failed condition branch (on_error: continue) as a run failure', () => {
    const manifest = makeManifest([
      step('pick', 'condition', {
        when: 'true',
        then: [
          step('badhttp', 'http', { method: 'GET', url: '{{ env.FF_APP_URL }}/x' }, { on_error: 'continue' }),
        ],
      }),
    ]);
    return runLocally(manifest, {}, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(false);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('host_not_allowed'));
    });
  });

  it('records skipped iterations and still succeeds when all children are skipped', () => {
    const manifest = makeManifest([
      step('loop', 'for_each', { over: 'inputs.items' }, {
        steps: [step('body', 'log', { message: 'x' }, { if: '1 == 2' })],
      }),
      step('after', 'log', { message: 'last={{ steps.loop.output.results[1].status }}' }),
    ]);
    return runLocally(manifest, { items: [1, 2] }, { FF_APP_URL: null }).then((result) => {
      expect(result.ok).toBe(true);
      expect(console.log).toHaveBeenCalledWith('  • after: [info] last=skipped');
    });
  });
});

// ─── Hosted commands (§11) ───────────────────────────────────────────────────

describe('hosted commands', () => {
  it('apiRequest requires login', async () => {
    await expect(apiRequest('GET', '/workflows')).rejects.toThrow('Not logged in. Run `forge login` first.');
  });

  it('login mints an API token with the session cookie + CSRF and stores the workspace slug', async () => {
    let tokenRequest: MockRequest | null = null;
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST' && req.path === '/api/v1/auth/login') {
        res.setHeader('Set-Cookie', 'ff_session=sessionabc; Path=/; HttpOnly');
        json(res, 200, {
          data: { user: { name: 'Demo User' }, workspace: { slug: 'acme' }, csrf_token: 'csrftoken123' },
        });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/api-tokens') {
        tokenRequest = req;
        json(res, 200, { data: { token: 'ff_live_token' } });
        return;
      }
      json(res, 404, { error: { message: 'not found' } });
    });
    mocks.push(mock);

    const result = await loginToServer(mock.url, 'demo@acme.test', 'password123');
    expect(result).toEqual({ userName: 'Demo User', workspaceSlug: 'acme' });

    expect(tokenRequest).not.toBeNull();
    expect(tokenRequest!.headers.cookie).toBe('ff_session=sessionabc');
    expect(tokenRequest!.headers['x-csrf-token']).toBe('csrftoken123');

    expect(getCredentials()).toEqual({
      url: mock.url,
      workspace_slug: 'acme',
      token: 'ff_live_token',
    });
  });

  it('login reports the server error message on failure', async () => {
    const mock = await startMockServer((_req, res) => {
      json(res, 401, { error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
    });
    mocks.push(mock);
    await expect(loginToServer(mock.url, 'a@b.co', 'nope')).rejects.toThrow('Invalid email or password');
  });

  it('login normalizes a trailing-slash URL and stores the clean base', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST' && req.path === '/api/v1/auth/login') {
        res.setHeader('Set-Cookie', 'ff_session=sessionabc; Path=/; HttpOnly');
        json(res, 200, {
          data: { user: { name: 'Demo' }, workspace: { slug: 'acme' }, csrf_token: 'csrf' },
        });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/api-tokens') {
        json(res, 200, { data: { token: 'ff_live_token' } });
        return;
      }
      json(res, 404, { error: { message: 'not found' } });
    });
    mocks.push(mock);
    await loginToServer(`${mock.url}/`, 'demo@acme.test', 'password123');
    const loginReq = mock.requests.find((r) => r.path === '/api/v1/auth/login')!;
    expect(loginReq.path).toBe('/api/v1/auth/login'); // no double slash
    expect(getCredentials()!.url).toBe(mock.url);
  });

  it('push creates unknown workflows and versions existing ones by slug', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'GET' && req.path === '/api/v1/workflows') {
        json(res, 200, { data: [{ id: 'wf-1', name: 'existing-name', slug: 'existing' }] });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/workflows/wf-1/versions') {
        json(res, 201, { data: { id: 'v2', version_num: 2, is_current: false } });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/workflows') {
        json(res, 201, { data: { id: 'wf-new' } });
        return;
      }
      json(res, 404, { error: { message: 'unexpected' } });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });

    const dir = tempDir();
    const fixtureYaml = (name: string) =>
      `api_version: flowforge/v1\nname: ${name}\ntriggers:\n  - type: webhook\n    auth_mode: none\nsteps:\n  - id: hello\n    type: log\n    with: { level: info, message: "hi" }\n`;
    writeFileSync(join(dir, 'existing.ff.yaml'), fixtureYaml('existing-name'));
    writeFileSync(join(dir, 'fresh.ff.yaml'), fixtureYaml('fresh-name'));

    const rows = await pushWorkflows(dir);
    expect(rows).toHaveLength(2);
    const versioned = rows.find((r) => r.file === 'existing.ff.yaml')!;
    const created = rows.find((r) => r.file === 'fresh.ff.yaml')!;
    expect(versioned.action).toBe('versioned');
    expect(versioned.id).toBe('wf-1');
    expect(created.action).toBe('created');
    expect(created.id).toBe('wf-new');

    const createReq = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/v1/workflows')!;
    const createBody = createReq.body as { slug: string; name: string; manifest: string };
    expect(createBody.slug).toBe('fresh');
    expect(createBody.name).toBe('fresh-name');
    expect(createBody.manifest).toContain('fresh-name');

    const versionReq = mock.requests.find((r) => r.method === 'POST' && r.path === '/api/v1/workflows/wf-1/versions')!;
    expect((versionReq.body as { manifest: string }).manifest).toContain('existing-name');
    expect(mock.requests.every((r) => r.headers.authorization === 'Bearer ff_t')).toBe(true);
  });

  it('push fails fast with a clear message when the directory has no .ff.yaml files', async () => {
    saveCredentials({ url: 'http://unused:1', workspace_slug: 'acme', token: 'ff_t' });
    const dir = tempDir();
    await expect(pushWorkflows(dir)).rejects.toThrow('No .ff.yaml files found in current directory.');
  });

  it('pull writes {slug}.ff.yaml files authoritatively', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'GET' && req.path === '/api/v1/workflows') {
        json(res, 200, { data: [{ id: 'wf-a', name: 'Alpha', slug: 'alpha' }, { id: 'wf-b', name: 'Beta', slug: 'beta' }] });
        return;
      }
      if (req.method === 'GET' && req.path === '/api/v1/workflows/wf-a/manifest') {
        json(res, 200, { data: { manifest_yaml: 'yaml-alpha' } });
        return;
      }
      if (req.method === 'GET' && req.path === '/api/v1/workflows/wf-b/manifest') {
        json(res, 200, { data: { manifest_yaml: 'yaml-beta' } });
        return;
      }
      json(res, 404, { error: { message: 'unexpected' } });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });

    const dir = tempDir();
    const rows = await pullWorkflows(dir);
    expect(rows.map((r) => r.slug).sort()).toEqual(['alpha', 'beta']);
    expect(readFileSync(join(dir, 'alpha.ff.yaml'), 'utf-8')).toBe('yaml-alpha');
    expect(readFileSync(join(dir, 'beta.ff.yaml'), 'utf-8')).toBe('yaml-beta');
  });

  it('pull sanitizes slug to prevent path traversal', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'GET' && req.path === '/api/v1/workflows') {
        json(res, 200, { data: [{ id: 'wf-evil', name: '../../etc/passwd', slug: '../../etc/passwd' }] });
        return;
      }
      if (req.method === 'GET' && req.path === '/api/v1/workflows/wf-evil/manifest') {
        json(res, 200, { data: { manifest_yaml: 'yaml-evil' } });
        return;
      }
      json(res, 404, { error: { message: 'unexpected' } });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });

    const dir = tempDir();
    const rows = await pullWorkflows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).not.toContain('..');
    expect(rows[0].slug).not.toContain('/');
    // File written inside dir, not escaping it
    expect(readFileSync(join(dir, `${rows[0].slug}.ff.yaml`), 'utf-8')).toBe('yaml-evil');
  });

  it('runs list returns hosted rows', async () => {
    const mock = await startMockServer((req, res) => {
      json(res, 200, {
        data: [{ id: 'r1', status: 'succeeded', workflow_name: 'invoice-chaser', created_at: '2026-09-19', finished_at: null }],
      });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });
    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].workflow_name).toBe('invoice-chaser');
  });

  it('logs fetches run steps', async () => {
    const mock = await startMockServer((req, res) => {
      json(res, 200, { data: [{ step_id: 'fetch_overdue', status: 'succeeded', output: { status: 200 }, started_at: '2026-09-19' }] });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });
    const steps = await fetchRunSteps('r1');
    expect(steps).toHaveLength(1);
    expect(steps[0].step_id).toBe('fetch_overdue');
  });

  it('export returns the workflow YAML verbatim', async () => {
    const mock = await startMockServer((req, res) => {
      json(res, 200, { data: { manifest_yaml: 'api_version: flowforge/v1\nname: exported\n' } });
    });
    mocks.push(mock);
    saveCredentials({ url: mock.url, workspace_slug: 'acme', token: 'ff_t' });
    expect(await fetchWorkflowManifest('wf-x')).toBe('api_version: flowforge/v1\nname: exported\n');
  });
});

// ─── sanitizeSlug (path safety for pull/init) ──────────────────────────────────

describe('sanitizeSlug', () => {
  it('passes through clean slugs', () => {
    expect(sanitizeSlug('invoice-chaser')).toBe('invoice-chaser');
    expect(sanitizeSlug('my_workflow')).toBe('my_workflow');
    expect(sanitizeSlug('Workflow123')).toBe('Workflow123');
  });

  it('strips path separators and parent traversal', () => {
    expect(sanitizeSlug('../../etc/passwd')).not.toContain('..');
    expect(sanitizeSlug('../../etc/passwd')).not.toContain('/');
    expect(sanitizeSlug('a/b/c')).not.toContain('/');
  });

  it('replaces invalid characters with hyphens', () => {
    expect(sanitizeSlug('hello world!')).toBe('hello-world');
    expect(sanitizeSlug('foo.bar')).toBe('foo-bar');
  });

  it('collapses consecutive hyphens and trims edges', () => {
    expect(sanitizeSlug('---foo---bar---')).toBe('foo-bar');
  });

  it('falls back to workflow when empty after sanitization', () => {
    expect(sanitizeSlug('')).toBe('workflow');
    expect(sanitizeSlug('!!!')).toBe('workflow');
    expect(sanitizeSlug('..//..')).toBe('workflow');
  });
});

// ─── toManifestSlug / buildInitManifest (init manifests must validate §5.1) ────

describe('toManifestSlug', () => {
  const NAME_RE = /^[a-z][a-z0-9-]{2,63}$/;

  it('produces schema-valid slugs from arbitrary names', () => {
    for (const raw of ['invoice-chaser', 'My Workflow!', 'my_workflow', '24/7 Support', 'A', '---', '...', 'Workflow123']) {
      const slug = toManifestSlug(raw);
      expect(slug).toMatch(NAME_RE);
    }
  });

  it('lowercases and maps underscores to hyphens (underscores are not legal in schema names)', () => {
    expect(toManifestSlug('My_Invoice_Workflow')).toBe('my-invoice-workflow');
    expect(toManifestSlug('Workflow123')).toBe('workflow123');
  });

  it('never starts with a digit or dash', () => {
    expect(toManifestSlug('24/7')).toBe('workflow');
    expect(toManifestSlug('-leading-dash')).toBe('leading-dash');
  });

  it('falls back for degenerate input', () => {
    expect(toManifestSlug('!!!')).toBe('workflow');
    expect(toManifestSlug('')).toBe('workflow');
  });
});

describe('buildInitManifest', () => {
  it('emits a manifest that parses and validates against the engine schema', () => {
    const slug = toManifestSlug('Demo Init Name!');
    const yaml = buildInitManifest(slug);
    const manifest = parseManifest(yaml);
    expect(manifest.name).toBe(slug);
    if (manifest.triggers[0].type === 'webhook') {
      expect(manifest.triggers[0].path).toBe(slug);
    }
  });

  it('emits a manifest that parses for hostile names too', () => {
    const yaml = buildInitManifest(toManifestSlug('../../etc/passwd'));
    const manifest = parseManifest(yaml);
    expect(manifest.name).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
    expect(manifest.name).not.toContain('..');
  });
});

// ─── Repair regressions (BUG-008 / BUG-019 / BUG-020 / BUG-010 CLI half) ─────

describe('parseLocalDuration floor (BUG-019)', () => {
  it('rejects zero durations like the server contract', () => {
    expect(parseLocalDuration('0s')).toBeNull();
    expect(parseLocalDuration('0m')).toBeNull();
    expect(parseLocalDuration('0h')).toBeNull();
    expect(parseLocalDuration('0d')).toBeNull();
  });

  it('still accepts in-contract durations', () => {
    expect(parseLocalDuration('1s')).toBe(1000);
    expect(parseLocalDuration('30d')).toBe(30 * 86_400_000);
  });
});

describe('toManifestSlug digit-edge regression (BUG-008)', () => {
  const NAME_RE = /^[a-z][a-z0-9-]{2,63}$/;

  it('inputs that reduce to digits fall back to a schema-valid slug', () => {
    // The leading-non-letter strip is greedy, so digit-led inputs collapse to
    // the 'workflow' fallback or a letter-led remainder — never a digit start.
    expect(toManifestSlug('24/7')).toBe('workflow');
    expect(toManifestSlug('1-2-3')).toBe('workflow');
    expect(toManifestSlug('42')).toBe('workflow');
    expect(toManifestSlug('2be')).toBe('be-w');
    expect(toManifestSlug('0x')).toBe('x-w');
    for (const raw of ['24/7', '999', '1a', '12ab c', '-2-cool']) {
      expect(toManifestSlug(raw)).toMatch(NAME_RE);
    }
  });
});

describe('local secrets binding (BUG-020)', () => {
  it('secrets.* evaluates to null with a loud one-time warning (no vault locally)', async () => {
    const manifest = makeManifest([
      step('use_secret', 'transform', { set: { token: 'Bearer {{ secrets.API_KEY }}' } }),
      step('after', 'log', { message: 'token={{ steps.use_secret.output.token }}' }),
    ]);
    const result = await runLocally(manifest, {}, { FF_APP_URL: null });
    expect(result.ok).toBe(true);
    // null secret interpolates to an empty string (missing-secret contract §5.4)
    expect(console.log).toHaveBeenCalledWith('  • after: [info] token=Bearer ');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no credential vault'));
  });
});

describe('login with pre-workspace sessions (BUG-010)', () => {
  it('selects the workspace between login and token minting', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST' && req.path === '/api/v1/auth/login') {
        res.setHeader('Set-Cookie', 'ff_session=preworkspace; Path=/; HttpOnly');
        json(res, 200, {
          data: {
            id: 'u1',
            email: 'demo@acme.test',
            name: 'Demo User',
            user: { name: 'Demo User' },
            workspaces: [{ id: 'w1', name: 'Acme', slug: 'acme', plan_id: 'free', role: 'owner' }],
            csrf_token: 'csrf-pre',
          },
        });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/auth/select-workspace') {
        // The pre-workspace session + CSRF pair authorizes selection.
        expect(req.headers.cookie).toBe('ff_session=preworkspace');
        expect(req.headers['x-csrf-token']).toBe('csrf-pre');
        expect((req.body as { workspace_slug: string }).workspace_slug).toBe('acme');
        res.setHeader('Set-Cookie', 'ff_session=scoped; Path=/; HttpOnly');
        json(res, 200, { data: { workspace: { slug: 'acme' }, role: 'owner', csrf_token: 'csrf-scoped' } });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/api-tokens') {
        // Token minting runs on the SCOPED session, not the pre-workspace one.
        expect(req.headers.cookie).toBe('ff_session=scoped');
        expect(req.headers['x-csrf-token']).toBe('csrf-scoped');
        json(res, 200, { data: { token: 'ff_live_token' } });
        return;
      }
      json(res, 404, { error: { message: 'not found' } });
    });
    mocks.push(mock);

    const result = await loginToServer(mock.url, 'demo@acme.test', 'password123');
    expect(result).toEqual({ userName: 'Demo User', workspaceSlug: 'acme' });
    expect(getCredentials()).toEqual({ url: mock.url, workspace_slug: 'acme', token: 'ff_live_token' });
    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/select-workspace',
      'POST /api/v1/api-tokens',
    ]);
  });

  it('fails clearly when the account has no workspaces', async () => {
    const mock = await startMockServer((_req, res) => {
      res.setHeader('Set-Cookie', 'ff_session=pre; Path=/; HttpOnly');
      json(res, 200, { data: { user: { name: 'X' }, workspaces: [], csrf_token: 'c' } });
    });
    mocks.push(mock);
    await expect(loginToServer(mock.url, 'a@b.co', 'pw')).rejects.toThrow('No workspace found');
  });

  it('still works against legacy servers that return workspace directly', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST' && req.path === '/api/v1/auth/login') {
        res.setHeader('Set-Cookie', 'ff_session=legacy; Path=/; HttpOnly');
        json(res, 200, { data: { user: { name: 'D' }, workspace: { slug: 'acme' }, csrf_token: 'c' } });
        return;
      }
      if (req.method === 'POST' && req.path === '/api/v1/api-tokens') {
        json(res, 200, { data: { token: 'ff_tok' } });
        return;
      }
      json(res, 404, { error: { message: 'not found' } });
    });
    mocks.push(mock);
    const result = await loginToServer(mock.url, 'demo@acme.test', 'password123');
    expect(result.workspaceSlug).toBe('acme');
    expect(mock.requests.some((r) => r.path === '/api/v1/auth/select-workspace')).toBe(false);
  });
});
