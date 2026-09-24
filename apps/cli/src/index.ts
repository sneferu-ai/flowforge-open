#!/usr/bin/env node
/**
 * FlowForge Open CLI — validate, run, push, pull, and inspect workflows.
 *
 * Command surface (spec §11):
 *   forge init [name]           Create new workflow project
 *   forge validate <file>       Validate manifest
 *   forge run <file> [opts]     Execute locally
 *   forge login <url>           Authenticate hosted instance
 *   forge push [--workspace S]  Push local .ff.yaml files to hosted
 *   forge pull [--workspace S]  Pull workspace workflows to local files
 *   forge runs list             List recent runs (hosted)
 *   forge logs <runId>          Show run logs (hosted)
 *   forge export <workflowId>   Export workflow YAML
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import {
  parseManifest,
  evaluateExpression,
  resolveInterpolation,
  isTruthy,
  type Manifest,
  type Step,
  type EvalContext,
  ExpressionError,
} from '@flowforge/engine';
import { Command } from 'commander';

const program = new Command();

program
  .name('flowforge')
  .description('FlowForge Open CLI — workflow automation')
  .version('1.0.0');

// ─── Credentials helpers (§11 — ~/.flowforge/credentials.json) ──────────────

export interface Credentials {
  url: string;
  workspace_slug: string;
  token: string;
}

export function getConfigDir(): string {
  return process.env.FLOWFORGE_CONFIG_DIR || join(process.env.HOME || process.env.USERPROFILE || '.', '.flowforge');
}

export function getCredentials(): Credentials | null {
  const credPath = join(getConfigDir(), 'credentials.json');
  if (!existsSync(credPath)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(credPath, 'utf-8'));
    if (raw && typeof raw.url === 'string' && typeof raw.token === 'string') {
      return { url: raw.url, workspace_slug: raw.workspace_slug || '', token: raw.token };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'credentials.json'), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

const NOT_LOGGED_IN = 'Not logged in. Run `forge login` first.';

/** All hosted API calls go through /api/v1 (spec §9 base path). */
const API_BASE = '/api/v1';

/**
 * Sanitizes a slug or name for use as a filename component.
 * Strips path separators, parent-traversal sequences, and any character
 * that is not alphanumeric, hyphen, or underscore. Falls back to
 * 'workflow' when the result is empty.
 */
export function sanitizeSlug(raw: string): string {
  const sanitized = raw
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return sanitized || 'workflow';
}

/**
 * Derives a manifest-valid slug per §5.1 (`^[a-z][a-z0-9-]{2,63}$`):
 * lowercase, no leading digit/dash, 3–63 chars. Used by `forge init` so the
 * generated manifest always validates.
 */
export function toManifestSlug(raw: string): string {
  const base =
    sanitizeSlug(raw)
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+$/, '') || 'workflow';
  const trimmed = base.slice(0, 63).replace(/-+$/, '') || 'workflow';
  if (trimmed.length >= 3) return trimmed;
  return `${trimmed}${'-w'.repeat(Math.ceil((3 - trimmed.length) / 2))}`.replace(/-+$/, '');
}

/** The starter manifest written by `forge init` (§11) — always schema-valid. */
export function buildInitManifest(slug: string): string {
  return `api_version: flowforge/v1

name: ${slug}
summary: A sample workflow

inputs:
  - name: message
    type: string
    required: true
    default: "Hello from FlowForge"

triggers:
  - type: webhook
    path: ${slug}
    auth_mode: none
    require_signature: false
    sync: false

steps:
  - id: send_notification
    type: notify
    with:
      channel: inbox
      to: user@flowforge.dev
      subject: Workflow Triggered
      body: "{{ inputs.message }}"
`;
}

export async function apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(NOT_LOGGED_IN);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${creds.token}`,
  };

  const res = await fetch(`${creds.url}${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`);
  }
  return data;
}

// ─── login (§11) — POST /auth/login → mint API token over the session ────────

export interface LoginResult {
  /** Display name of the authenticated user. */
  userName: string;
  /** Workspace slug stored in credentials.json. */
  workspaceSlug: string;
}

/**
 * Authenticates against the hosted instance and stores { url, workspace_slug,
 * token } in ~/.flowforge/credentials.json (0600), per spec §11:
 * session login → POST /api-tokens with the session cookie + CSRF token.
 */
/** Extract the ff_session cookie value from a response's Set-Cookie header. */
function sessionCookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return '';
  const match = setCookie.match(/ff_session=([^;]+)/);
  return match ? match[1] : '';
}

export async function loginToServer(serverUrl: string, email: string, password: string): Promise<LoginResult> {
  // Normalize a trailing slash so <url>/api/v1 never double-slashes.
  const baseUrl = serverUrl.replace(/\/+$/, '');
  // Step 1: POST /api/v1/auth/login → PRE-WORKSPACE session cookie + CSRF
  // token + the user's workspace list (§8.1).
  const res = await fetch(`${baseUrl}${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message || 'Login failed');
  }

  const loginData = data as {
    data: {
      user: { name: string };
      workspaces?: Array<{ slug?: string | null; name: string }>;
      workspace?: { slug: string };
      csrf_token: string;
    };
  };
  let sessionCookie = sessionCookieFrom(res);
  let csrfToken = loginData.data.csrf_token;

  // Step 2 (§8.1): select the workspace, exchanging the pre-workspace session
  // for a scoped one. Servers predating the pre-workspace flow return
  // `workspace` directly and skip this step.
  let workspaceSlug: string;
  if (Array.isArray(loginData.data.workspaces)) {
    const first = loginData.data.workspaces[0];
    if (!first || !first.slug) {
      throw new Error('No workspace found for this account');
    }
    const selRes = await fetch(`${baseUrl}${API_BASE}/auth/select-workspace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `ff_session=${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ workspace_slug: first.slug }),
    });
    const selData = await selRes.json().catch(() => ({}));
    if (!selRes.ok) {
      throw new Error((selData as { error?: { message?: string } }).error?.message || 'Workspace selection failed');
    }
    // The scoped session replaces the pre-workspace one (cookie + CSRF pair).
    sessionCookie = sessionCookieFrom(selRes) || sessionCookie;
    csrfToken = (selData as { data?: { csrf_token?: string } }).data?.csrf_token ?? csrfToken;
    workspaceSlug = first.slug;
  } else {
    workspaceSlug = loginData.data.workspace?.slug ?? '';
    if (!workspaceSlug) {
      throw new Error('No workspace found for this account');
    }
  }

  // Step 3: POST /api/v1/api-tokens to mint a real API token (§8.4/§11)
  const tokenRes = await fetch(`${baseUrl}${API_BASE}/api-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `ff_session=${sessionCookie}`,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ name: `forge-cli-${Date.now()}` }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error((tokenData as { error?: { message?: string } }).error?.message || 'Failed to create API token');
  }

  const apiToken = (tokenData as { data: { token: string } }).data.token;

  // Step 3: Store credentials in ~/.flowforge/credentials.json (0600)
  saveCredentials({
    url: baseUrl,
    workspace_slug: workspaceSlug,
    token: apiToken,
  });

  return { userName: loginData.data.user.name, workspaceSlug };
}

program
  .command('login [url]')
  .description('Authenticate with a FlowForge server')
  .option('-s, --server <url>', 'Server URL (alternative to positional)')
  .option('-e, --email <email>', 'Email')
  .option('-p, --password <password>', 'Password')
  .action(async (url: string | undefined, options) => {
    const serverUrl = url || options.server || 'http://localhost:3000';
    const email = options.email || await prompt('Email: ');
    const password = options.password || await prompt('Password: ', true);

    try {
      const { userName, workspaceSlug } = await loginToServer(serverUrl, email, password);
      console.log(`✓ Logged in as ${userName}`);
      console.log(`  Workspace: ${workspaceSlug}`);
      console.log(`  Credentials saved to ~/.flowforge/credentials.json`);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── validate ────────────────────────────────────────────────────────────────

program
  .command('validate <file>')
  .description('Validate a workflow manifest YAML file')
  .action(async (file: string) => {
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(`✗ File not found: ${filePath}`);
      process.exit(1);
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const manifest = parseManifest(raw);

      console.log('✓ Valid manifest');
      console.log(`  Name: ${manifest.name}`);
      console.log(`  Summary: ${manifest.summary || '(none)'}`);
      console.log(`  Steps: ${manifest.steps.length}`);
      console.log(`  Triggers: ${manifest.triggers?.length || 0}`);
      console.log(`  Inputs: ${manifest.inputs?.length || 0}`);

      console.log('\n  Steps:');
      for (const step of manifest.steps) {
        console.log(`    ${step.id} (${step.type})`);
      }

      if (manifest.triggers && manifest.triggers.length > 0) {
        console.log('\n  Triggers:');
        for (const trigger of manifest.triggers) {
          console.log(`    ${trigger.type}${trigger.path ? ` → ${trigger.path}` : ''}`);
        }
      }
    } catch (err) {
      console.error(`✗ Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── push (§11) — deploy .ff.yaml files: create or new version ───────────────

export interface PushResultRow {
  file: string;
  action: 'created' | 'versioned';
  id: string;
  name: string;
  error?: string;
}

/**
 * Sends all .ff.yaml files in `dir` (create when the slug/name is unknown,
 * otherwise a new version — §11). Throws when not logged in or the workflow
 * listing fails; per-file failures are captured on the row.
 */
export async function pushWorkflows(dir: string, workspaceOverride?: string): Promise<PushResultRow[]> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(NOT_LOGGED_IN);
  }
  const workspaceSlug = workspaceOverride || creds.workspace_slug;
  if (!workspaceSlug) {
    throw new Error('No workspace slug in credentials. Use --workspace <slug> or re-login.');
  }

  const yamlFiles = readdirSync(dir)
    .filter((f) => f.endsWith('.ff.yaml'))
    .map((f) => join(dir, f));

  if (yamlFiles.length === 0) {
    throw new Error('No .ff.yaml files found in current directory.');
  }

  // Fetch existing workflows to match by slug/name
  const listRes = await apiRequest('GET', '/workflows') as { data: Array<{ id: string; name: string; slug?: string }> };
  const existingWorkflows = listRes.data || [];

  const rows: PushResultRow[] = [];
  for (const filePath of yamlFiles) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const manifest = parseManifest(raw);
      const slug = basename(filePath, '.ff.yaml');

      // Match by slug or name
      const existing = existingWorkflows.find(
        (w) => w.slug === slug || w.name === manifest.name,
      );

      if (existing) {
        // New version
        const res = await apiRequest('POST', `/workflows/${existing.id}/versions`, {
          manifest: raw,
        }) as { data: { version_num: number } };
        rows.push({ file: basename(filePath), action: 'versioned', id: existing.id, name: manifest.name });
      } else {
        // Create
        const res = await apiRequest('POST', '/workflows', {
          name: manifest.name,
          slug,
          manifest: raw,
        }) as { data: { id: string } };
        rows.push({ file: basename(filePath), action: 'created', id: res.data.id, name: manifest.name });
      }
    } catch (err) {
      rows.push({
        file: basename(filePath),
        action: 'created',
        id: '',
        name: '',
        error: (err as Error).message,
      });
    }
  }
  return rows;
}

program
  .command('push')
  .description('Push local .ff.yaml workflow files to the hosted server')
  .option('--workspace <slug>', 'Override workspace slug from credentials')
  .action(async (options) => {
    try {
      const rows = await pushWorkflows(process.cwd(), options.workspace);
      for (const row of rows) {
        if (row.error) {
          console.error(`✗ Failed to push ${row.file}: ${row.error}`);
        } else if (row.action === 'versioned') {
          console.log(`✓ Pushed new version for "${row.name}" → ${row.id}`);
        } else {
          console.log(`✓ Created workflow "${row.name}" → ${row.id}`);
        }
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── pull (§11) — fetch workspace workflows to local .ff.yaml files ──────────

export interface PullResultRow {
  name: string;
  slug: string;
  file: string;
  error?: string;
}

/** Fetches every workspace workflow and writes {slug}.ff.yaml (authoritative). */
export async function pullWorkflows(dir: string, workspaceOverride?: string): Promise<PullResultRow[]> {
  let creds = getCredentials();
  if (!creds) {
    throw new Error(NOT_LOGGED_IN);
  }
  if (workspaceOverride && workspaceOverride !== creds.workspace_slug) {
    creds = { ...creds, workspace_slug: workspaceOverride };
  }
  if (!creds.workspace_slug) {
    throw new Error('No workspace slug in credentials. Use --workspace <slug> or re-login.');
  }

  const listRes = await apiRequest('GET', '/workflows') as { data: Array<{ id: string; name: string; slug?: string }> };
  const workflows = listRes.data || [];

  const rows: PullResultRow[] = [];
  for (const wf of workflows) {
    try {
      const manifestRes = await apiRequest('GET', `/workflows/${wf.id}/manifest`) as { data: { manifest_yaml: string } };
      const rawSlug = wf.slug || wf.name;
      const slug = sanitizeSlug(rawSlug);
      const outPath = join(dir, `${slug}.ff.yaml`);
      writeFileSync(outPath, manifestRes.data.manifest_yaml);
      rows.push({ name: wf.name, slug, file: outPath });
    } catch (err) {
      rows.push({ name: wf.name, slug: wf.slug || wf.name, file: '', error: (err as Error).message });
    }
  }
  return rows;
}

program
  .command('pull')
  .description('Pull workspace workflows from the hosted server to local .ff.yaml files')
  .option('--workspace <slug>', 'Override workspace slug from credentials')
  .action(async (options) => {
    try {
      const rows = await pullWorkflows(process.cwd(), options.workspace);
      if (rows.length === 0) {
        console.log('No workflows found.');
        return;
      }
      for (const row of rows) {
        if (row.error) {
          console.error(`✗ Failed to pull ${row.name}: ${row.error}`);
        } else {
          console.log(`✓ Pulled "${row.name}" → ${basename(row.file)}`);
        }
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── runs list (§11) — list recent hosted runs ──────────────────────────────

export interface HostedRunRow {
  id: string;
  status: string;
  workflow_name: string;
  created_at: string;
  finished_at: string | null;
}

export async function listRuns(): Promise<HostedRunRow[]> {
  const res = await apiRequest('GET', '/runs') as { data: HostedRunRow[] };
  return res.data || [];
}

const runsCmd = program.command('runs').description('Manage hosted runs');
runsCmd
  .command('list')
  .description('List recent runs (hosted)')
  .action(async () => {
    try {
      const runs = await listRuns();
      if (runs.length === 0) {
        console.log('No runs found.');
        return;
      }
      console.log('Recent runs:');
      for (const run of runs) {
        console.log(`  ${run.id}  ${run.status}  ${run.workflow_name}  ${run.created_at}`);
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── logs (§11) — show run step logs ─────────────────────────────────────────

export interface HostedStepRow {
  step_id: string;
  status: string;
  output: unknown;
  started_at: string;
}

export async function fetchRunSteps(runId: string): Promise<HostedStepRow[]> {
  const res = await apiRequest('GET', `/runs/${runId}/steps`) as { data: HostedStepRow[] };
  return res.data || [];
}

program
  .command('logs <runId>')
  .description('Show run step logs (hosted)')
  .action(async (runId: string) => {
    try {
      const steps = await fetchRunSteps(runId);
      if (steps.length === 0) {
        console.log('No steps executed yet.');
        return;
      }
      for (const step of steps) {
        console.log(`\n[${step.step_id}] ${step.status} @ ${step.started_at}`);
        if (step.output) {
          console.log(JSON.stringify(step.output, null, 2));
        }
      }
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── export (§11) — export a workflow's manifest YAML ────────────────────────

export async function fetchWorkflowManifest(workflowId: string): Promise<string> {
  const res = await apiRequest('GET', `/workflows/${workflowId}/manifest`) as { data: { manifest_yaml: string } };
  return res.data.manifest_yaml;
}

program
  .command('export <workflowId>')
  .description('Export a workflow manifest as YAML (hosted)')
  .action(async (workflowId: string) => {
    try {
      console.log(await fetchWorkflowManifest(workflowId));
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── init ────────────────────────────────────────────────────────────────────

program
  .command('init [name]')
  .description('Create a starter workflow manifest')
  .option('-o, --output <file>', 'Output file (defaults to {slug}.ff.yaml)')
  .action(async (name: string | undefined, options) => {
    const slug = toManifestSlug(name || 'my-workflow');
    const outputFile = options.output || `${slug}.ff.yaml`;
    const manifest = buildInitManifest(slug);

    writeFileSync(outputFile, manifest);
    console.log(`✓ Created ${outputFile}`);
  });

// ─── run (§D8/§11) — execute a manifest locally ──────────────────────────────

export function parseInputValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

program
  .command('run <file>')
  .description('Run a workflow manifest locally with the in-memory engine')
  .option('-i, --input <key=value>', 'Input parameter (repeatable)', collectInputs, {})
  .option('--demo', 'Start an in-process demo server so env.FF_APP_URL resolves to /demo/* services')
  .option('--dry-run', 'Execute locally but skip manual_approval prompts (steps marked skipped)')
  .action(async (file: string, options) => {
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(`✗ File not found: ${filePath}`);
      process.exit(1);
    }
    let manifest: Manifest;
    try {
      manifest = parseManifest(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`✗ Invalid manifest: ${(err as Error).message}`);
      process.exit(1);
    }

    // §11: --input values parsed as JSON if valid, else string
    const rawInputs = (options.input as Record<string, string>) || {};
    const inputs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawInputs)) {
      inputs[key] = parseInputValue(value);
    }

    // §11: --demo starts an in-process server on the first available port in
    // 32768–61000, sets env.FF_APP_URL to http://localhost:{port}, and serves
    // /demo/* with deterministic schemas.
    let demoServer: Server | null = null;
    // §11: without --demo, env.FF_APP_URL is null. With --demo, an in-process
    // server starts and env.FF_APP_URL is set to http://localhost:{port}.
    let ffAppUrl: string | null = null;

    if (options.demo) {
      const port = await findAvailablePort(32768, 61000);
      if (port === null) {
        console.error('✗ No available port in range 32768–61000.');
        process.exit(1);
      }
      demoServer = startDemoServer(port);
      ffAppUrl = `http://localhost:${port}`;
      console.log(`  Demo server on ${ffAppUrl}`);
    }

    const env = { FF_APP_URL: ffAppUrl };
    const dryRun = (options.dryRun as boolean) === true;
    console.log(`▶ Running "${manifest.name}" locally (${manifest.steps.length} steps, ${Object.keys(inputs).length} inputs${dryRun ? ', dry-run' : ''})`);

    const result = await runLocally(manifest, inputs, env, { dryRun });
    if (result.ok) {
      console.log(`✓ Run completed (${result.stepCount} steps)`);
    } else {
      console.error(`✗ Run failed: ${result.error}`);
    }

    if (demoServer) {
      demoServer.close();
    }
    if (!result.ok) {
      process.exit(1);
    }
  });

// ─── Local run engine ────────────────────────────────────────────────────────

export interface LocalRunResult {
  ok: boolean;
  stepCount: number;
  error?: string;
}

export interface LocalRunOptions {
  /** §11: skip manual_approval prompts (step `skipped`) instead of prompting. */
  dryRun?: boolean;
}

interface LocalContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { output: unknown; status: string }>;
  loop: { item: unknown; index: number; outer: LocalContext['loop'] | null } | null;
  env: { FF_APP_URL: string | null };
}

export async function runLocally(
  manifest: Manifest,
  inputs: Record<string, unknown>,
  env: { FF_APP_URL: string | null },
  opts: LocalRunOptions = {},
): Promise<LocalRunResult> {
  // Apply manifest input defaults (§5.1) — the hosted engine resolves
  // defaults the same way, and the invoice-chaser depends on
  // escalation_threshold default 30.
  const resolvedInputs: Record<string, unknown> = { ...inputs };
  for (const def of manifest.inputs ?? []) {
    if (resolvedInputs[def.name] === undefined && def.default !== undefined) {
      resolvedInputs[def.name] = def.default;
    }
  }
  const ctx: LocalContext = { inputs: resolvedInputs, steps: {}, loop: null, env };
  let stepCount = 0;
  let secretsWarningShown = false;

  const evalCtx = (c: LocalContext): EvalContext => ({
    inputs: c.inputs,
    steps: c.steps,
    loop: c.loop ? { item: c.loop.item, index: c.loop.index, outer: c.loop.outer } : null,
    // §5.4: local mode has no vault binding — `secrets.*` evaluates to null
    // (the hosted-missing-secret contract), announced once per run so a
    // manifest that depends on secrets fails loudly instead of silently
    // interpolating empty strings.
    secrets: (name: string) => {
      if (!secretsWarningShown) {
        secretsWarningShown = true;
        console.error(`  ⚠ secrets.* referenced (${name}) — local runs have no credential vault; secrets evaluate to null`);
      }
      return null;
    },
    env: c.env,
    run: { id: 'local', scheduled_at: null },
    trigger: { type: 'manual', payload: null },
  });

  async function executeSteps(steps: Step[], c: LocalContext): Promise<'ok' | 'skipped' | 'abort' | 'failed'> {
    let anyFailure = false;
    let anyExecuted = false;
    for (const step of steps) {
      if (step.if) {
        let cond: unknown = false;
        try {
          cond = evaluateExpression(step.if, evalCtx(c));
        } catch (err) {
          console.error(`  ✗ ${step.id}: ${(err as ExpressionError).message}`);
          return 'failed';
        }
        if (!isTruthy(cond)) {
          console.log(`  ↷ ${step.id}: skipped (if)`);
          c.steps[step.id] = { output: null, status: 'skipped' };
          continue;
        }
      }

      const status = await executeOne(step, c);
      stepCount++;
      if (status === 'abort') return 'abort';
      if (status === 'failed') anyFailure = true;
      else anyExecuted = true;
    }
    if (anyFailure) return 'failed';
    return anyExecuted ? 'ok' : 'skipped';
  }

  async function executeOne(step: Step, c: LocalContext): Promise<'ok' | 'skipped' | 'abort' | 'failed'> {
    const withConfig = (step.with || {}) as Record<string, unknown>;
    const label = `  ${step.type === 'log' ? '•' : '▶'} ${step.id} (${step.type})`;
    // on_error defaults to abort (§5.1)
    const onError = step.on_error ?? 'abort';
    try {
      switch (step.type) {
        case 'log': {
          const msg = resolveInterpolation(String(withConfig.message || ''), evalCtx(c));
          console.log(`  • ${step.id}: [${withConfig.level || 'info'}] ${msg}`);
          c.steps[step.id] = { output: { message: msg }, status: 'succeeded' };
          return 'ok';
        }
        case 'notify': {
          const to = resolveInterpolation(String(withConfig.to || ''), evalCtx(c));
          const subject = withConfig.subject ? resolveInterpolation(String(withConfig.subject), evalCtx(c)) : '';
          const body = resolveInterpolation(String(withConfig.body || ''), evalCtx(c));
          console.log(`  ✉ ${step.id}: ${withConfig.channel} → ${to} "${subject}"`);
          console.log(`        ${body.slice(0, 160)}${body.length > 160 ? '…' : ''}`);
          c.steps[step.id] = { output: { message_id: 'local', status: 'enqueued' }, status: 'succeeded' };
          return 'ok';
        }
        case 'transform': {
          const created: Record<string, unknown> = {};
          const set = (withConfig.set || {}) as Record<string, string>;
          for (const [key, expr] of Object.entries(set)) {
            created[key] = resolveInterpolation(expr, evalCtx(c));
          }
          c.steps[step.id] = { output: created, status: 'succeeded' };
          console.log(`${label} → ${JSON.stringify(created).slice(0, 140)}`);
          return 'ok';
        }
        case 'condition': {
          const when = String(withConfig.when || '');
          const fl = isTruthy(evaluateExpression(when, evalCtx(c)));
          const branch = (fl ? withConfig.then : withConfig.else) as Step[] | undefined;
          const branchName = fl ? 'then' : 'else';
          let output: unknown = null;
          let status: 'ok' | 'skipped' | 'abort' | 'failed' = 'ok';
          if (branch && branch.length > 0) {
            status = await executeSteps(branch, c);
            const lastId = branch[branch.length - 1].id;
            output = c.steps[lastId]?.output ?? null;
          }
          // A failed branch (on_error: continue) must fail the condition too,
          // not vanish into a "succeeded" record.
          c.steps[step.id] = {
            output: { branch: branchName, output },
            status: status === 'failed' ? 'failed' : 'succeeded',
          };
          if (status === 'abort') return 'abort';
          return status === 'failed' ? 'failed' : 'ok';
        }
        case 'for_each': {
          const items = evaluateExpression(String(withConfig.over || ''), evalCtx(c));
          if (items === null || items === undefined) {
            c.steps[step.id] = { output: { results: [] }, status: 'succeeded' };
            return 'ok';
          }
          if (!Array.isArray(items)) {
            console.error(`  ✗ ${step.id} failed: type_mismatch: for_each.over must evaluate to a list`);
            return onError === 'continue' ? 'failed' : 'abort';
          }
          const limit = Math.max(1, Number(withConfig.limit ?? 100));
          const bounded = items.slice(0, limit);
          const results: Array<Record<string, unknown>> = [];
          let anyFailed = false;
          let anyExecutedIteration = false;
          for (let i = 0; i < bounded.length; i++) {
            const childCtx: LocalContext = { ...c, loop: { item: bounded[i], index: i, outer: c.loop } };
            const st = await executeSteps(step.steps || [], childCtx);
            if (st === 'abort') {
              results.push({ index: i, status: 'failed' });
              c.steps[step.id] = {
                output: { results, truncated: items.length > limit, dropped_count: Math.max(0, items.length - limit) },
                status: 'failed',
              };
              return 'abort';
            }
            const iterStatus = st === 'ok' ? 'succeeded' : st === 'skipped' ? 'skipped' : 'failed';
            results.push({ index: i, status: iterStatus });
            if (st === 'failed') anyFailed = true;
            else if (st === 'ok') anyExecutedIteration = true;
          }
          const stepStatus = anyFailed && !anyExecutedIteration ? 'failed' : 'succeeded';
          c.steps[step.id] = {
            output: { results, truncated: items.length > limit, dropped_count: Math.max(0, items.length - limit) },
            status: stepStatus,
          };
          return stepStatus === 'failed' ? 'failed' : 'ok';
        }
        case 'delay': {
          const duration = String(withConfig.duration || '');
          const ms = parseLocalDuration(duration);
          if (ms === null) {
            console.error(`  ✗ ${step.id} failed: invalid duration "${duration}"`);
            return onError === 'continue' ? 'failed' : 'abort';
          }
          if (ms > 5 * 60 * 1000) {
            console.error(`  ✗ ${step.id} failed: delay ${duration} is not supported in local mode (5-minute cap)`);
            return onError === 'continue' ? 'failed' : 'abort';
          }
          console.log(`  ⏱ ${step.id}: waiting ${duration}`);
          await new Promise((r) => setTimeout(r, ms));
          c.steps[step.id] = { output: { resumed_at: new Date().toISOString() }, status: 'succeeded' };
          return 'ok';
        }
        case 'http': {
          const method = String(withConfig.method || 'GET').toUpperCase();
          const url = resolveInterpolation(String(withConfig.url || ''), evalCtx(c));
          // §11: a relative/empty resolved URL fails with host_not_allowed.
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(url);
          } catch {
            parsedUrl = undefined as unknown as URL;
          }
          if (!parsedUrl || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
            console.error(`  ✗ ${step.id} failed: host_not_allowed: resolved URL is not an absolute http(s) URL`);
            c.steps[step.id] = { output: null, status: 'failed' };
            return onError === 'continue' ? 'failed' : 'abort';
          }
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries((withConfig.headers || {}) as Record<string, string>)) {
            headers[name] = resolveInterpolation(value, evalCtx(c));
          }
          const body = withConfig.body ? resolveInterpolation(String(withConfig.body), evalCtx(c)) : undefined;
          // §5.1: defaults.timeout_seconds is 60.
          const timeoutS = Math.max(1, Number(step.timeout_seconds ?? 60));
          console.log(`  ⤷ ${step.id}: ${method} ${url}`);
          const res = await fetch(url, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : body,
            signal: AbortSignal.timeout(timeoutS * 1000),
          });
          const text = await res.text();
          let parsedBody: unknown = text;
          if ((res.headers.get('content-type') || '').includes('application/json')) {
            try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
          }
          const output = { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: parsedBody };
          c.steps[step.id] = { output, status: res.ok ? 'succeeded' : 'failed' };
          console.log(`       → HTTP ${res.status}`);
          if (!res.ok) return onError === 'continue' ? 'failed' : 'abort';
          return 'ok';
        }
        case 'manual_approval': {
          // §11: --dry-run skips approval prompts (step `skipped`).
          if (opts.dryRun) {
            c.steps[step.id] = { output: { decision: 'skipped' }, status: 'skipped' };
            console.log(`  ↷ ${step.id}: skipped (dry-run)`);
            return 'skipped';
          }
          const promptText = resolveInterpolation(String(withConfig.prompt || 'Approve?'), evalCtx(c));
          if (!process.stdin.isTTY) {
            const message = `non_interactive_approval_unsupported: manual_approval needs an interactive terminal`;
            console.error(`  ✗ ${step.id} failed: ${message}`);
            c.steps[step.id] = { output: null, status: 'failed' };
            return onError === 'continue' ? 'failed' : 'abort';
          }
          const answer = (await prompt(`${promptText} [y/n]`)).toLowerCase();
          const approved = answer === 'y' || answer === 'yes';
          c.steps[step.id] = { output: { decision: approved ? 'approved' : 'rejected' }, status: approved ? 'succeeded' : 'failed' };
          if (!approved) return onError === 'continue' ? 'failed' : 'abort';
          return 'ok';
        }
        case 'reply': {
          const replyBody = resolveInterpolation(String(withConfig.body || ''), evalCtx(c));
          console.log(`  ⮑ ${step.id}: reply ${withConfig.status ?? 200}`);
          console.log(`     ${replyBody.slice(0, 200)}`);
          c.steps[step.id] = { output: { status: withConfig.status ?? 200, body: replyBody }, status: 'succeeded' };
          return 'ok';
        }
        default: {
          console.error(`  ✗ ${step.id}: step type ${step.type} is not supported locally`);
          return 'failed';
        }
      }
    } catch (err) {
      const message = err instanceof ExpressionError ? `${err.code}: ${err.message}` : (err as Error).message;
      console.error(`  ✗ ${step.id} failed: ${message}`);
      if (onError === 'continue') return 'failed';
      return 'abort';
    }
  }

  const status = await executeSteps(manifest.steps, ctx);
  if (status === 'abort' || status === 'failed') {
    return { ok: false, stepCount, error: status === 'abort' ? 'a step aborted the run' : 'one or more steps failed' };
  }
  return { ok: true, stepCount };
}

/**
 * Local-mode delay parsing — same contract as the server's parseDurationMs
 * (§5.3 `30s`–`30d`): zero and negative durations are rejected, not treated
 * as no-op sleeps.
 */
export function parseLocalDuration(input: string): number | null {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(input.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (m[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// ─── Demo server (§11 forge run --demo) ──────────────────────────────────────
//
// Starts a minimal HTTP server on the first available port in 32768–61000
// and serves /demo/* with the same deterministic schemas + query semantics as
// the server's demo routes (apps/server/src/routes/demo.ts, §13.2), mounted
// at root AND /api/v1 so the canonical template URLs
// (`{{ env.FF_APP_URL }}/api/v1/demo/...`) resolve.
// env.FF_APP_URL is set to http://localhost:{port}.

interface DemoInvoiceRow {
  number: string;
  client_name: string;
  client_email: string;
  amount: number;
  currency: string;
  issued_at: string;
  due_at: string;
  days_overdue: number;
  status: 'open' | 'overdue';
}

interface DemoOrderRow {
  number: string;
  client_name: string;
  client_email: string;
  placed_at: string;
  status: 'new' | 'stalled' | 'delivered';
  stalled_hours: number;
}

interface DemoClientRow {
  id: string;
  name: string;
  email: string;
  since: string;
  last_project: string;
  last_project_closed_at: string;
}

export async function findAvailablePort(start: number, end: number): Promise<number | null> {
  for (let port = start; port <= end; port++) {
    const available = await tryBindPort(port);
    if (available) return port;
  }
  return null;
}

function tryBindPort(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = createTcpServer();
    probe.once('error', () => {
      probe.close();
      resolvePromise(false);
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolvePromise(true));
    });
  });
}

const DEMO_PATHS = {
  invoices: ['/demo/invoices', '/api/v1/demo/invoices'],
  orders: ['/demo/orders', '/api/v1/demo/orders'],
  clients: ['/demo/clients', '/api/v1/demo/clients'],
} as const;

export function startDemoServer(port: number): Server {
  const server = createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://localhost');
    const path = parsed.pathname;

    if ((DEMO_PATHS.invoices as readonly string[]).includes(path)) {
      // Mirrors apps/server/src/routes/demo.ts: the 45-day escalation fixture
      // is opt-in via ?include_escalations=1; 'overdue' means days_overdue > 0.
      const withEscalation =
        parsed.searchParams.get('include_escalations') === '1' ||
        parsed.searchParams.get('include_escalations') === 'true';
      const status = parsed.searchParams.get('status');
      let invoices = DEMO_INVOICES;
      if (status) {
        if (status === 'overdue') {
          invoices = invoices.filter((i) => i.days_overdue > 0);
        } else {
          invoices = invoices.filter((i) => i.status === status);
        }
      }
      if (!withEscalation) {
        invoices = invoices.filter((i) => i.days_overdue < 45);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ invoices }));
      return;
    }
    if ((DEMO_PATHS.orders as readonly string[]).includes(path)) {
      // 'stuck' is the product-language alias for 'stalled'.
      const status = parsed.searchParams.get('status');
      const normalized = status === 'stuck' ? 'stalled' : status;
      const orders = normalized ? DEMO_ORDERS.filter((o) => o.status === normalized) : DEMO_ORDERS;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders }));
      return;
    }
    if ((DEMO_PATHS.clients as readonly string[]).includes(path)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ clients: DEMO_CLIENTS }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Unknown demo endpoint' } }));
  });

  server.listen(port, '127.0.0.1');
  return server;
}

// Deterministic demo data — mirrors apps/server/src/routes/demo.ts (§13.2)
const DEMO_INVOICES: DemoInvoiceRow[] = [
  { number: 'INV-1042', client_name: 'Acme Studio', client_email: 'billing@acme.test', amount: 1240, currency: 'USD', issued_at: '2026-08-01', due_at: '2026-08-15', days_overdue: 17, status: 'overdue' },
  { number: 'INV-1027', client_name: 'Northwind Ltd', client_email: 'ap@northwind.test', amount: 3200, currency: 'USD', issued_at: '2026-07-22', due_at: '2026-08-05', days_overdue: 27, status: 'overdue' },
  { number: 'INV-0990', client_name: 'Bloom Creative', client_email: 'finance@bloom.test', amount: 5600, currency: 'USD', issued_at: '2026-06-30', due_at: '2026-07-14', days_overdue: 45, status: 'open' },
  { number: 'INV-1080', client_name: 'Halcyon Books', client_email: 'accounts@halcyon.test', amount: 890, currency: 'USD', issued_at: '2026-08-20', due_at: '2026-09-03', days_overdue: 0, status: 'open' },
];

const DEMO_ORDERS: DemoOrderRow[] = [
  { number: 'ORD-5511', client_name: 'Acme Studio', client_email: 'ops@acme.test', placed_at: '2026-09-10', status: 'stalled', stalled_hours: 60 },
  { number: 'ORD-5518', client_name: 'Northwind Ltd', client_email: 'ops@northwind.test', placed_at: '2026-09-14', status: 'stalled', stalled_hours: 30 },
  { number: 'ORD-5520', client_name: 'Bloom Creative', client_email: 'ops@bloom.test', placed_at: '2026-09-18', status: 'new', stalled_hours: 0 },
  { number: 'ORD-5499', client_name: 'Halcyon Books', client_email: 'ops@halcyon.test', placed_at: '2026-09-01', status: 'delivered', stalled_hours: 0 },
];

const DEMO_CLIENTS: DemoClientRow[] = [
  { id: 'c-001', name: 'Acme Studio', email: 'hello@acme.test', since: '2025-03-11', last_project: 'Brand refresh', last_project_closed_at: '2026-09-12' },
  { id: 'c-002', name: 'Northwind Ltd', email: 'hello@northwind.test', since: '2025-07-02', last_project: 'Storefront build', last_project_closed_at: '2026-08-28' },
  { id: 'c-003', name: 'Bloom Creative', email: 'hello@bloom.test', since: '2026-01-15', last_project: 'Product shoot', last_project_closed_at: '2026-09-04' },
  { id: 'c-004', name: 'Halcyon Books', email: 'hello@halcyon.test', since: '2024-11-20', last_project: 'Catalogue layout', last_project_closed_at: '2026-07-30' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function prompt(message: string, hidden = false): Promise<string> {
  process.stdout.write(message);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf-8');
    if (hidden) {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.on('data', (data) => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeAllListeners('data');
        process.stdout.write('\n');
        resolve(data.toString().trim());
      });
    } else {
      process.stdin.on('data', (data) => {
        process.stdin.removeAllListeners('data');
        resolve(data.toString().trim());
      });
    }
  });
}

export function collectInputs(value: string, previous: Record<string, string>): Record<string, string> {
  const [key, ...rest] = value.split('=');
  if (key && rest.length > 0) {
    return { ...previous, [key.trim()]: rest.join('=').trim() };
  }
  return previous;
}

// Run the CLI only when executed directly (`node apps/cli/dist/index.js ...`),
// not when imported (tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}
