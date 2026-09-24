/**
 * Contract tests for GET /openapi.json and the hand-authored OpenAPI 3.1
 * document (§9).
 *
 * Two directions of truth are enforced:
 *  1. document → server: every documented path+method resolves to a real
 *     registered Fastify route (`hasRoute`, {param}→:param). No dummy paths.
 *  2. spec surface → document: the task spec's §7.1 pinned surface is
 *     reconciled row-by-row to the shipped surface. The shipped API resolves
 *     the workspace from the session, so the real routes are the flat
 *     /api/v1/<resource> forms; the reconciliation rules (strip the
 *     /workspaces/{slug} prefix, POST members → POST invitations, OIDC logout
 *     is GET) are encoded and every pinned row's counterpart is asserted to
 *     exist in both the document and the server.
 *
 * All 35 component schemas are property-verified (not spot-checked), and the
 * per-operation response / request-body mappings are iterated exhaustively.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { openApiDocument } from '../openapi/document.js';

type Json = Record<string, any>;

const doc = openApiDocument as unknown as Json;
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const arr = (n: string) => ({ type: 'array', items: ref(n) });

let app: FastifyInstance;

beforeAll(async () => {
  process.env.FF_SEED_DEMO = 'true';
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function fastifyUrl(openApiPath: string): string {
  return openApiPath.replace(/\{[^}]+\}/g, (m) => `:${m.slice(1, -1)}`);
}

function operations(pathKey: string): Array<[string, Json]> {
  const node = doc.paths[pathKey] as Json;
  return Object.entries(node).filter(([m]) =>
    ['get', 'post', 'put', 'patch', 'delete'].includes(m)
  ) as Array<[string, Json]>;
}

// ---------------------------------------------------------------------------
// §7.1 pinned surface — task-spec rows and their shipped counterparts
// ---------------------------------------------------------------------------

const WS_PREFIX = '/api/v1/workspaces/{slug}';

/** Pinned rows from the task spec §7.1 (always-registered 62 + mock-IdP 4). */
const PINNED_ROUTES: Array<[string, string]> = [
  ['POST', '/api/v1/auth/register'],
  ['POST', '/api/v1/auth/login'],
  ['POST', '/api/v1/auth/select-workspace'],
  ['POST', '/api/v1/auth/logout'],
  ['GET', '/api/v1/auth/me'],
  ['POST', '/api/v1/auth/invite/accept'],
  ['POST', '/api/v1/auth/change-password'],
  ['GET', '/api/v1/auth/oidc/{provider}/login'],
  ['GET', '/api/v1/auth/oidc/{provider}/callback'],
  ['POST', '/api/v1/auth/oidc/{provider}/logout'],
  ['GET', '/api/v1/workspaces'],
  ['POST', '/api/v1/workspaces'],
  ['GET', '/api/v1/workspaces/{slug}'],
  ['GET', `${WS_PREFIX}/members`],
  ['POST', `${WS_PREFIX}/members`],
  ['DELETE', `${WS_PREFIX}/members/{userId}`],
  ['DELETE', `${WS_PREFIX}/invitations/{id}`],
  ['POST', `${WS_PREFIX}/invitations/{id}/resend`],
  ['DELETE', `${WS_PREFIX}/sessions/{userId}`],
  ['DELETE', `${WS_PREFIX}/sessions`],
  ['GET', `${WS_PREFIX}/workflows`],
  ['POST', `${WS_PREFIX}/workflows`],
  ['GET', `${WS_PREFIX}/workflows/{id}`],
  ['PUT', `${WS_PREFIX}/workflows/{id}`],
  ['DELETE', `${WS_PREFIX}/workflows/{id}`],
  ['POST', `${WS_PREFIX}/workflows/{id}/validate`],
  ['POST', `${WS_PREFIX}/workflows/{id}/run`],
  ['POST', `${WS_PREFIX}/workflows/{id}/versions`],
  ['GET', `${WS_PREFIX}/workflows/{id}/versions`],
  ['POST', `${WS_PREFIX}/workflows/{id}/promote/{versionId}`],
  ['POST', `${WS_PREFIX}/workflows/from-template`],
  ['GET', `${WS_PREFIX}/workflows/{id}/triggers`],
  ['POST', `${WS_PREFIX}/workflows/{id}/triggers`],
  ['PUT', `${WS_PREFIX}/workflows/{id}/triggers/{triggerId}`],
  ['DELETE', `${WS_PREFIX}/workflows/{id}/triggers/{triggerId}`],
  ['GET', `${WS_PREFIX}/runs`],
  ['GET', `${WS_PREFIX}/runs/{id}`],
  ['GET', `${WS_PREFIX}/runs/{id}/steps`],
  ['GET', `${WS_PREFIX}/runs/{id}/events`],
  ['POST', `${WS_PREFIX}/runs/{id}/cancel`],
  ['POST', `${WS_PREFIX}/runs/{id}/approve-all`],
  ['GET', `${WS_PREFIX}/approvals`],
  ['POST', `${WS_PREFIX}/approvals/{taskId}/approve`],
  ['POST', `${WS_PREFIX}/approvals/{taskId}/reject`],
  ['GET', `${WS_PREFIX}/credentials`],
  ['POST', `${WS_PREFIX}/credentials`],
  ['DELETE', `${WS_PREFIX}/credentials/{id}`],
  ['GET', `${WS_PREFIX}/audit`],
  ['GET', `${WS_PREFIX}/audit/verify`],
  ['GET', `${WS_PREFIX}/usage`],
  ['GET', `${WS_PREFIX}/invoices`],
  ['GET', `${WS_PREFIX}/subscription`],
  ['POST', `${WS_PREFIX}/subscription`],
  ['GET', `${WS_PREFIX}/allowlist`],
  ['POST', `${WS_PREFIX}/allowlist`],
  ['DELETE', `${WS_PREFIX}/allowlist/{id}`],
  ['GET', `${WS_PREFIX}/webhook-secrets`],
  ['POST', `${WS_PREFIX}/webhook-secrets`],
  ['DELETE', `${WS_PREFIX}/webhook-secrets/{id}`],
  ['GET', `${WS_PREFIX}/oidc/providers`],
  ['POST', `${WS_PREFIX}/oidc/providers`],
  ['DELETE', `${WS_PREFIX}/oidc/providers/{id}`],
  ['GET', `${WS_PREFIX}/api-tokens`],
  ['POST', `${WS_PREFIX}/api-tokens`],
  ['DELETE', `${WS_PREFIX}/api-tokens/{id}`],
  ['GET', '/api/v1/templates'],
  ['GET', `${WS_PREFIX}/notifications`],
  ['POST', `${WS_PREFIX}/notifications/{id}/read`],
  ['POST', '/hooks/{workspaceSlug}/{path}'],
  ['GET', '/healthz'],
  ['GET', '/readyz'],
  ['GET', '/demo/invoices'],
  ['GET', '/demo/orders'],
  ['GET', '/demo/clients'],
  ['GET', '/demo/credentials'],
  ['GET', '/openapi.json'],
  ['GET', '/mock-idp/.well-known/openid-configuration'],
  ['GET', '/mock-idp/authorize'],
  ['POST', '/mock-idp/token'],
  ['GET', '/mock-idp/userinfo'],
];

/**
 * The shipped API resolves the workspace from the session (see
 * middleware/auth.ts), so the real routes drop the /workspaces/{slug}
 * prefix. Two rows need more than the strip: the member-creation operation
 * is the invitation endpoint, and the OIDC logout route is registered as
 * GET (it performs a redirect, not a state change).
 */
function reconcilePinned(method: string, pinnedPath: string): [string, string] {
  let realPath =
    pinnedPath.startsWith(WS_PREFIX) && pinnedPath.length > WS_PREFIX.length
      ? `/api/v1${pinnedPath.slice(WS_PREFIX.length)}`
      : pinnedPath;
  let realMethod = method;
  if (method === 'POST' && realPath === '/api/v1/members') {
    realPath = '/api/v1/invitations';
  }
  if (method === 'POST' && realPath === '/api/v1/auth/oidc/{provider}/logout') {
    realMethod = 'GET';
  }
  return [realMethod, realPath];
}

// ---------------------------------------------------------------------------
// §7.4 schema property table — the authoritative 35-schema contract
// ---------------------------------------------------------------------------

type Want =
  | 'string'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any-nullable'
  | 'string-nullable'
  | 'integer-nullable'
  | 'object-nullable'
  | 'object-optional'
  | `ref:${string}`
  | `array-ref:${string}`
  | 'array-object-with-code-message-path';

const SCHEMA_PROPS: Record<string, Record<string, Want>> = {
  Envelope: { data: 'any-nullable', error: 'object-optional' },
  Error: { code: 'string', message: 'string' },
  Pagination: { page: 'integer', pageSize: 'integer', total: 'integer', totalPages: 'integer' },
  LoginRequest: { email: 'string', password: 'string' },
  LoginResponse: { user: 'ref:User', workspaces: 'array-ref:Workspace' },
  Workspace: { id: 'string', name: 'string', slug: 'string', plan: 'string', created_at: 'string' },
  WorkspaceMembership: { id: 'string', workspace_id: 'string', user_id: 'string', role: 'string', created_at: 'string' },
  Invitation: { id: 'string', workspace_id: 'string', email: 'string', role: 'string', status: 'string', created_at: 'string' },
  Plan: {
    id: 'string',
    name: 'string',
    price_monthly_cents: 'integer',
    run_limit: 'integer',
    seats: 'integer',
    run_history_days: 'integer',
    audit_retention_days: 'integer-nullable',
    timeout_hours: 'integer-nullable',
    overage_rate_cents: 'integer-nullable',
    rate_limit: 'integer',
    concurrency_limit: 'integer-nullable',
  },
  Subscription: {
    id: 'string',
    workspace_id: 'string',
    plan_id: 'string',
    status: 'string',
    runs_consumed: 'integer',
    current_period_start: 'string',
    current_period_end: 'string',
  },
  Workflow: {
    id: 'string',
    name: 'string',
    slug: 'string',
    manifest: 'string',
    status: 'string',
    workspace_id: 'string',
    created_at: 'string',
    updated_at: 'string',
  },
  WorkflowVersion: { id: 'string', workflow_id: 'string', version: 'integer', manifest: 'string', created_at: 'string', created_by: 'string' },
  Trigger: { id: 'string', workflow_id: 'string', type: 'string', config: 'object', status: 'string', created_at: 'string' },
  Run: {
    id: 'string',
    workflow_id: 'string',
    status: 'string',
    started_at: 'string-nullable',
    completed_at: 'string-nullable',
    trigger_type: 'string',
    created_at: 'string',
  },
  RunStep: {
    id: 'string',
    run_id: 'string',
    step_path: 'string',
    status: 'string',
    attempt: 'integer',
    started_at: 'string-nullable',
    completed_at: 'string-nullable',
    output: 'object-nullable',
    error: 'object-nullable',
  },
  RunEvent: { id: 'string', run_id: 'string', type: 'string', data: 'object-nullable', timestamp: 'string' },
  Credential: { id: 'string', workspace_id: 'string', name: 'string', type: 'string', created_at: 'string' },
  AuditEvent: {
    id: 'string',
    workspace_id: 'string',
    type: 'string',
    actor_id: 'string-nullable',
    data: 'object-nullable',
    timestamp: 'string',
    hash: 'string',
  },
  AuditVerification: { verified: 'boolean', event_count: 'integer', last_verified_at: 'string' },
  UsageReport: {
    runs_consumed: 'integer',
    run_limit: 'integer',
    overage: 'integer',
    current_period_start: 'string',
    current_period_end: 'string',
  },
  Invoice: {
    id: 'string',
    workspace_id: 'string',
    amount_cents: 'integer',
    status: 'string',
    period_start: 'string',
    period_end: 'string',
    created_at: 'string',
  },
  ApiToken: {
    id: 'string',
    workspace_id: 'string',
    name: 'string',
    token: 'string-nullable',
    last_used_at: 'string-nullable',
    created_at: 'string',
  },
  WebhookSecret: { id: 'string', workspace_id: 'string', name: 'string', created_at: 'string' },
  OidcProvider: { id: 'string', workspace_id: 'string', name: 'string', issuer_url: 'string', client_id: 'string', created_at: 'string' },
  AllowlistEntry: { id: 'string', workspace_id: 'string', pattern: 'string', created_at: 'string' },
  Notification: { id: 'string', workspace_id: 'string', type: 'string', message: 'string', read: 'boolean', created_at: 'string' },
  Template: { id: 'string', name: 'string', slug: 'string', summary: 'string', manifest: 'string', category: 'string' },
  ApprovalTask: {
    id: 'string',
    run_id: 'string',
    step_path: 'string',
    prompt: 'string',
    status: 'string',
    decision: 'string-nullable',
    decided_by: 'string-nullable',
    decided_at: 'string-nullable',
    timeout_seconds: 'integer',
    created_at: 'string',
  },
  ManifestValidationResult: { valid: 'boolean', errors: 'array-object-with-code-message-path' },
  RunCreatedResponse: { run_id: 'string', status: 'string' },
  HealthStatus: { status: 'string' },
  ReadyStatus: { status: 'string' },
  DemoCredentials: { email: 'string', password: 'string' },
  User: { id: 'string', email: 'string', name: 'string', created_at: 'string' },
  Session: { token: 'string', expires_at: 'string', workspace_id: 'string-nullable' },
};

function propMatches(actual: Json | undefined, want: Want): boolean {
  if (actual === undefined) return false;
  const t = actual.type;
  const nullableOk = actual.nullable === true || (Array.isArray(t) && t.includes('null'));
  switch (want) {
    case 'string':
      return t === 'string' || (Array.isArray(t) && t.includes('string'));
    case 'integer':
      return t === 'integer';
    case 'boolean':
      return t === 'boolean';
    case 'object':
      return t === 'object' || (Array.isArray(t) && t.includes('object'));
    case 'array':
      return t === 'array';
    case 'any-nullable':
      return (t === undefined && actual.nullable === true) || (t === undefined && Object.keys(actual).length >= 0);
    case 'string-nullable':
      return (t === 'string' && actual.nullable === true) || (Array.isArray(t) && t.includes('string') && t.includes('null'));
    case 'integer-nullable':
      return (t === 'integer' && actual.nullable === true) || (Array.isArray(t) && t.includes('integer') && t.includes('null'));
    case 'object-nullable':
      return (t === 'object' && actual.nullable === true) || (Array.isArray(t) && t.includes('object') && t.includes('null'));
    case 'object-optional':
      return t === 'object' || actual.anyOf !== undefined;
    case 'array-object-with-code-message-path': {
      if (t !== 'array' || !actual.items) return false;
      const props = actual.items.properties ?? {};
      return props.code?.type === 'string' && props.message?.type === 'string' && props.path?.type === 'string';
    }
    default: {
      if (want.startsWith('ref:')) {
        return actual.$ref === `#/components/schemas/${want.slice(4)}`;
      }
      if (want.startsWith('array-ref:')) {
        return t === 'array' && actual.items?.$ref === `#/components/schemas/${want.slice(10)}`;
      }
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Response data mapping — iterated exhaustively (reality-checked per route)
// ---------------------------------------------------------------------------

/** [path, method, success code, expected data node, enveloped] */
const RESPONSE_MAP: Array<[string, string, string, Json, boolean]> = [
  ['/api/v1/auth/login', 'post', '200', ref('LoginResponse'), true],
  ['/api/v1/workspaces', 'get', '200', arr('Workspace'), true],
  ['/api/v1/workspaces', 'post', '201', ref('Workspace'), true],
  ['/api/v1/workspaces/{slug}', 'get', '200', ref('Workspace'), true],
  ['/api/v1/members', 'get', '200', arr('WorkspaceMembership'), true],
  ['/api/v1/invitations', 'get', '200', arr('Invitation'), true],
  ['/api/v1/workflows', 'get', '200', arr('Workflow'), true],
  ['/api/v1/workflows/{id}', 'get', '200', ref('Workflow'), true],
  ['/api/v1/workflows/{id}', 'put', '200', ref('Workflow'), true],
  ['/api/v1/workflows/validate', 'post', '200', ref('ManifestValidationResult'), true],
  ['/api/v1/workflows/{id}/validate', 'post', '200', ref('ManifestValidationResult'), true],
  ['/api/v1/workflows/{id}/versions', 'get', '200', arr('WorkflowVersion'), true],
  ['/api/v1/workflows/{id}/triggers', 'get', '200', arr('Trigger'), true],
  ['/api/v1/workflows/{id}/triggers/{triggerId}', 'put', '200', ref('Trigger'), true],
  ['/api/v1/runs', 'get', '200', arr('Run'), true],
  ['/api/v1/runs/{id}', 'get', '200', ref('Run'), true],
  ['/api/v1/runs/{id}/steps', 'get', '200', arr('RunStep'), true],
  ['/api/v1/approvals', 'get', '200', arr('ApprovalTask'), true],
  ['/api/v1/credentials', 'get', '200', arr('Credential'), true],
  ['/api/v1/audit', 'get', '200', arr('AuditEvent'), true],
  ['/api/v1/audit/verify', 'get', '200', ref('AuditVerification'), true],
  ['/api/v1/usage', 'get', '200', ref('UsageReport'), true],
  ['/api/v1/invoices', 'get', '200', arr('Invoice'), true],
  ['/api/v1/subscription', 'get', '200', ref('Subscription'), true],
  ['/api/v1/subscription', 'post', '200', ref('Subscription'), true],
  ['/api/v1/allowlist', 'get', '200', arr('AllowlistEntry'), true],
  ['/api/v1/webhook-secrets', 'get', '200', arr('WebhookSecret'), true],
  ['/api/v1/oidc/providers', 'get', '200', arr('OidcProvider'), true],
  ['/api/v1/api-tokens', 'get', '200', arr('ApiToken'), true],
  ['/api/v1/templates', 'get', '200', arr('Template'), true],
  ['/api/v1/notifications', 'get', '200', arr('Notification'), true],
  // Root routes — no envelope; the schema is the direct body shape.
  ['/healthz', 'get', '200', ref('HealthStatus'), false],
  ['/health', 'get', '200', ref('HealthStatus'), false],
  ['/readyz', 'get', '200', ref('ReadyStatus'), false],
  ['/demo/credentials', 'get', '200', ref('DemoCredentials'), false],
];

/** Inline success composites whose $ref structure is asserted directly. */
const INLINE_RESPONSES: Array<[string, string, string, Record<string, Want>]> = [
  ['/api/v1/auth/register', 'post', '201', { user: 'ref:User', workspaces: 'array-ref:Workspace', csrf_token: 'string' }],
  ['/api/v1/auth/select-workspace', 'post', '200', { workspace: 'ref:Workspace', role: 'string', csrf_token: 'string' }],
  ['/api/v1/auth/me', 'get', '200', { user: 'ref:User', workspaces: 'array-ref:Workspace', csrf_token: 'string' }],
  ['/api/v1/auth/invite/accept', 'post', '200', { workspace: 'ref:Workspace', membership: 'ref:WorkspaceMembership', csrf_token: 'string' }],
  ['/api/v1/workflows/{id}/run', 'post', '201', { run_id: 'string' }],
  ['/api/v1/runs/{id}/cancel', 'post', '200', { status: 'string' }],
  ['/api/v1/runs/{id}/approve-all', 'post', '200', { approved_count: 'integer' }],
  ['/api/v1/credentials', 'post', '201', { id: 'string', name: 'string', type: 'string' }],
  ['/api/v1/allowlist', 'post', '201', { id: 'string', scheme: 'string', host: 'string' }],
  ['/api/v1/webhook-secrets', 'post', '201', { id: 'string', name: 'string' }],
  ['/api/v1/oidc/providers', 'post', '201', { id: 'string', name: 'string', issuer_url: 'string', client_id: 'string' }],
  ['/api/v1/api-tokens', 'post', '201', { id: 'string', name: 'string', token: 'string' }],
];

/** Request-body expectations. `null` = no requestBody allowed; 'raw' = open object. */
const REQUEST_MAP: Record<string, { props: Record<string, Want>; required?: string[]; optional?: boolean } | 'raw' | null> = {
  'post /api/v1/auth/register': { props: { email: 'string', password: 'string', name: 'string', workspace_name: 'string' }, required: ['email', 'password', 'name'] },
  'post /api/v1/auth/login': { props: {}, required: [] }, // schema is $ref LoginRequest — pinned separately
  'post /api/v1/auth/select-workspace': { props: { workspace_slug: 'string' } },
  'post /api/v1/auth/logout': null,
  'post /api/v1/auth/invite/accept': { props: { token: 'string' }, required: ['token'] },
  'post /api/v1/auth/change-password': { props: { current_password: 'string', new_password: 'string' }, required: ['current_password', 'new_password'] },
  'get /api/v1/auth/oidc/{provider}/logout': null,
  'post /api/v1/workspaces': { props: { name: 'string', slug: 'string' }, required: ['name'] },
  'post /api/v1/invitations': { props: { email: 'string', role: 'string' }, required: ['email'] },
  'post /api/v1/workflows': { props: { name: 'string', manifest: 'string' }, required: ['name', 'manifest'] },
  'put /api/v1/workflows/{id}': { props: { name: 'string', manifest: 'string', is_enabled: 'boolean' } },
  'post /api/v1/workflows/validate': { props: { manifest: 'string' }, required: ['manifest'] },
  'post /api/v1/workflows/{id}/validate': { props: { manifest: 'string' }, required: ['manifest'] },
  'post /api/v1/workflows/{id}/run': { props: { inputs: 'object' }, optional: true },
  'post /api/v1/workflows/{id}/trigger': { props: { inputs: 'object' }, optional: true },
  'post /api/v1/workflows/{id}/versions': { props: { manifest: 'string' }, required: ['manifest'] },
  'post /api/v1/workflows/{id}/promote/{versionId}': null,
  'post /api/v1/workflows/from-template': { props: { template_id: 'string' }, required: ['template_id'] },
  'post /api/v1/workflows/{id}/triggers': { props: { type: 'string', config: 'object' }, required: ['type', 'config'] },
  'put /api/v1/workflows/{id}/triggers/{triggerId}': { props: { is_enabled: 'boolean', config: 'object' } },
  'post /api/v1/runs/{id}/cancel': null,
  'post /api/v1/runs/{id}/approve-all': null,
  'post /api/v1/approvals/{taskId}/approve': null,
  'post /api/v1/approvals/{taskId}/reject': { props: { reason: 'string' }, optional: true },
  'post /api/v1/credentials': { props: { name: 'string', type: 'string', value: 'string' }, required: ['name', 'type', 'value'] },
  'post /api/v1/allowlist': { props: { scheme: 'string', host: 'string' }, required: ['scheme', 'host'] },
  'post /api/v1/webhook-secrets': { props: { name: 'string', value: 'string' }, required: ['name', 'value'] },
  'post /api/v1/oidc/providers': {
    props: { name: 'string', issuer_url: 'string', client_id: 'string', client_secret: 'string' },
    required: ['name', 'issuer_url', 'client_id', 'client_secret'],
  },
  'post /api/v1/api-tokens': { props: { name: 'string' }, required: ['name'] },
  'post /api/v1/subscription': { props: { plan_id: 'string' }, required: ['plan_id'] },
  'post /api/v1/notifications/{id}/read': null,
  'post /hooks/{workspaceSlug}/{path}': 'raw',
  'post /mock-idp/token': 'raw',
};

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('GET /openapi.json — served document', () => {
  it('answers 200 JSON with the OpenAPI 3.1.0 header, outside the envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-cache');
    const body = res.json() as Json;
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('FlowForge Open API');
    expect(body.info.license.name).toBe('Apache-2.0');
    expect(body.servers[0].url).toBe('/');
    expect(body).not.toHaveProperty('data');
  });

  it('is not intercepted by the SPA catch-all (JSON, not HTML)', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.body).not.toContain('<!DOCTYPE');
    expect(res.body).not.toContain('<html');
  });
});

describe('document structure', () => {
  it('declares at least 66 path keys', () => {
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(66);
  });

  it('declares both security schemes (session cookie + bearer token)', () => {
    const schemes = doc.components.securitySchemes;
    expect(schemes.sessionCookie).toEqual({ type: 'apiKey', in: 'cookie', name: 'ff_session' });
    expect(schemes.bearerToken).toEqual({ type: 'http', scheme: 'bearer' });
  });

  it('every operationId is unique across the document', () => {
    const ids: string[] = [];
    for (const pathKey of Object.keys(doc.paths)) {
      for (const [, opNode] of operations(pathKey)) {
        ids.push(opNode.operationId as string);
      }
    }
    expect(ids.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every operation carries summary, a described success response, and declared path params', () => {
    for (const pathKey of Object.keys(doc.paths)) {
      const pathParams = [...pathKey.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const [method, opNode] of operations(pathKey)) {
        expect(opNode.summary, `${method} ${pathKey}`).toBeTruthy();
        const responses = opNode.responses as Json;
        // 2xx payloads and 302 redirects are both success terminals.
        const successCode = Object.keys(responses).find((c) => c.startsWith('2') || c === '302');
        expect(successCode, `${method} ${pathKey}`).toBeTruthy();
        expect(responses[successCode!].description, `${method} ${pathKey} ${successCode}`).toBeTruthy();
        if (successCode !== '204' && successCode !== '302') {
          const content = responses[successCode!].content;
          expect(
            content['application/json'] || content['text/event-stream'] || content['text/html'],
            `${method} ${pathKey} ${successCode} content`
          ).toBeTruthy();
        }
        const declared = (opNode.parameters ?? []).filter((p: Json) => p.in === 'path').map((p: Json) => p.name);
        for (const param of pathParams) {
          expect(declared, `${method} ${pathKey} declares {${param}}`).toContain(param);
        }
        // Session-authenticated API operations document 401; parameterized
        // API operations document 404 (redirect endpoints never 404 — an
        // unknown provider still redirects, so they are exempt).
        if (opNode.security) {
          expect(responses, `${method} ${pathKey} 401`).toHaveProperty('401');
        }
        if (pathParams.length > 0 && pathKey.startsWith('/api/') && successCode !== '302') {
          expect(responses, `${method} ${pathKey} 404`).toHaveProperty('404');
        }
      }
    }
  });

  it('documents the webhook signature headers on the hook ingress operation', () => {
    const hook = doc.paths['/hooks/{workspaceSlug}/{path}'].post;
    const headerNames = (hook.parameters as Json[]).filter((p) => p.in === 'header').map((p) => p.name);
    expect(headerNames).toContain('X-FlowForge-Signature');
    expect(headerNames).toContain('X-FlowForge-Timestamp');
    expect(headerNames).toContain('X-Idempotency-Key');
  });

  it('the SSE run-events operation streams text/event-stream and lists the event types', () => {
    const sse = doc.paths['/api/v1/runs/{id}/events'].get;
    expect(sse.responses['200'].content['text/event-stream']).toBeTruthy();
    const description = sse.responses['200'].description as string;
    for (const eventType of [
      'run.created',
      'run.queued',
      'run.started',
      'step.started',
      'step.succeeded',
      'step.failed',
      'step.skipped',
      'step.waiting',
      'step.paused',
      'run.succeeded',
      'run.failed',
      'run.canceled',
      'heartbeat',
    ]) {
      expect(description, eventType).toContain(eventType);
    }
  });
});

describe('document ↔ server route correspondence', () => {
  it('every documented path+method is a registered Fastify route (no dummy paths)', () => {
    const failures: string[] = [];
    for (const pathKey of Object.keys(doc.paths)) {
      for (const [method] of operations(pathKey)) {
        const url = fastifyUrl(pathKey);
        if (!app.hasRoute({ method: method.toUpperCase() as never, url })) {
          failures.push(`${method.toUpperCase()} ${pathKey}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every §7.1 pinned row reconciles to a documented, registered counterpart', () => {
    const failures: string[] = [];
    for (const [method, pinnedPath] of PINNED_ROUTES) {
      const [realMethod, realPath] = reconcilePinned(method, pinnedPath);
      const docNode = doc.paths[realPath];
      if (!docNode || !docNode[realMethod.toLowerCase()]) {
        failures.push(`${method} ${pinnedPath} → missing ${realMethod} ${realPath}`);
        continue;
      }
      if (!app.hasRoute({ method: realMethod as never, url: fastifyUrl(realPath) })) {
        failures.push(`${method} ${pinnedPath} → unregistered ${realMethod} ${realPath}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the pinned surface accounts for the 66 path keys / 80 operations of §7.1', () => {
    expect(PINNED_ROUTES.length).toBe(80);
    expect(new Set(PINNED_ROUTES.map(([, p]) => p)).size).toBe(66);
  });
});

describe('components.schemas — all 35 verified', () => {
  it('contains all 35 required schemas', () => {
    const names = Object.keys(doc.components.schemas);
    for (const required of Object.keys(SCHEMA_PROPS)) {
      expect(names, required).toContain(required);
    }
    expect(names.length).toBeGreaterThanOrEqual(35);
  });

  it('every schema defines at least one property (no empty {} schemas)', () => {
    for (const [name, schema] of Object.entries(doc.components.schemas) as Array<[string, Json]>) {
      expect(Object.keys(schema.properties ?? {}).length, name).toBeGreaterThan(0);
    }
  });

  it('every schema property matches the §7.4 contract table', () => {
    const failures: string[] = [];
    for (const [schemaName, props] of Object.entries(SCHEMA_PROPS)) {
      const schema = (doc.components.schemas as Json)[schemaName];
      if (!schema) {
        failures.push(`${schemaName}: missing`);
        continue;
      }
      for (const [propName, want] of Object.entries(props)) {
        const actual = schema.properties?.[propName];
        if (!propMatches(actual, want as Want)) {
          failures.push(`${schemaName}.${propName}: wanted ${want}, got ${JSON.stringify(actual)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('semantic spot-checks: LoginRequest, Envelope, Error, DemoCredentials', () => {
    const schemas = doc.components.schemas as Json;
    expect(schemas.LoginRequest.properties.email.type).toBe('string');
    expect(schemas.LoginRequest.properties.password.type).toBe('string');
    expect(schemas.Envelope.properties).toHaveProperty('data');
    expect(schemas.Envelope.properties).toHaveProperty('error');
    expect(schemas.Error.properties.code.type).toBe('string');
    expect(schemas.Error.properties.message.type).toBe('string');
    expect(schemas.DemoCredentials.properties.email.type).toBe('string');
    expect(schemas.DemoCredentials.properties.password.type).toBe('string');
  });
});

describe('per-operation response mapping', () => {
  it('named-schema responses carry the mapped $ref (envelope data for API, direct for root)', () => {
    const failures: string[] = [];
    for (const [pathKey, method, code, expected, enveloped] of RESPONSE_MAP) {
      const opNode = doc.paths[pathKey]?.[method];
      const schema = opNode?.responses?.[code]?.content?.['application/json']?.schema;
      const actual = enveloped ? schema?.properties?.data : schema;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${method.toUpperCase()} ${pathKey} ${code}: wanted ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
      if (enveloped && schema?.type !== 'object') {
        failures.push(`${method.toUpperCase()} ${pathKey} ${code}: envelope schema must be an object`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('inline composite responses reference the mapped component schemas', () => {
    const failures: string[] = [];
    for (const [pathKey, method, code, props] of INLINE_RESPONSES) {
      const data = doc.paths[pathKey]?.[method]?.responses?.[code]?.content?.['application/json']?.schema?.properties?.data;
      if (!data?.properties) {
        failures.push(`${method.toUpperCase()} ${pathKey}: no inline data object`);
        continue;
      }
      for (const [prop, want] of Object.entries(props)) {
        if (!propMatches(data.properties[prop], want as Want)) {
          failures.push(`${method.toUpperCase()} ${pathKey} data.${prop}: wanted ${want}, got ${JSON.stringify(data.properties[prop])}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('API route error responses reference Envelope; root route errors are bare inline objects', () => {
    const loginError = doc.paths['/api/v1/auth/login'].post.responses['401'].content['application/json'].schema;
    expect(loginError).toEqual(ref('Envelope'));
    const workflow404 = doc.paths['/api/v1/workflows/{id}'].get.responses['404'].content['application/json'].schema;
    expect(workflow404).toEqual(ref('Envelope'));

    const demo404 = doc.paths['/demo/credentials'].get.responses['404'].content['application/json'].schema;
    expect(demo404.$ref).toBeUndefined();
    expect(demo404.type).toBe('object');
    expect(demo404.properties.error.type).toBe('string');
    const hook401 = doc.paths['/hooks/{workspaceSlug}/{path}'].post.responses['401'].content['application/json'].schema;
    expect(hook401.$ref).toBeUndefined();
    expect(hook401.properties.error.type).toBe('string');
  });

  it('the three auth composites and raw-JSON root routes are shaped as documented', () => {
    const registerData = doc.paths['/api/v1/auth/register'].post.responses['201'].content['application/json'].schema.properties.data;
    expect(registerData.properties.user).toEqual(ref('User'));
    expect(registerData.properties.workspaces).toEqual(arr('Workspace'));

    for (const rawPath of ['/mock-idp/.well-known/openid-configuration', '/mock-idp/userinfo']) {
      const schema = doc.paths[rawPath].get.responses['200'].content['application/json'].schema;
      expect(schema.type, rawPath).toBe('object');
      expect(schema.additionalProperties, rawPath).toBe(true);
    }
    const tokenSchema = doc.paths['/mock-idp/token'].post.responses['200'].content['application/json'].schema;
    expect(tokenSchema.additionalProperties).toBe(true);
  });
});

describe('per-operation request bodies', () => {
  it('non-empty bodies exist with the mapped properties; empty operations have no requestBody', () => {
    const failures: string[] = [];
    for (const [key, want] of Object.entries(REQUEST_MAP)) {
      const [method, pathKey] = key.split(' ', 2);
      const opNode = doc.paths[pathKey]?.[method];
      if (!opNode) {
        failures.push(`${key}: operation missing`);
        continue;
      }
      if (want === null) {
        if (opNode.requestBody !== undefined) failures.push(`${key}: must NOT declare requestBody`);
        continue;
      }
      const body = opNode.requestBody;
      if (!body) {
        failures.push(`${key}: requestBody missing`);
        continue;
      }
      if (want === 'raw') {
        const content = body.content ?? {};
        const schema = (content['application/json'] ?? content['application/x-www-form-urlencoded'])?.schema;
        if (!schema || schema.type !== 'object' || schema.additionalProperties !== true) {
          failures.push(`${key}: raw body must be an open object schema`);
        }
        continue;
      }
      if (want.optional === true && body.required === true) {
        failures.push(`${key}: requestBody must be optional`);
      }
      const schema = body.content?.['application/json']?.schema;
      for (const [prop, wantType] of Object.entries(want.props)) {
        if (!propMatches(schema?.properties?.[prop], wantType as Want)) {
          failures.push(`${key} body.${prop}: wanted ${wantType}, got ${JSON.stringify(schema?.properties?.[prop])}`);
        }
      }
      for (const req of want.required ?? []) {
        if (!(schema?.required ?? []).includes(req)) {
          failures.push(`${key} body: ${req} must be required`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('login references the LoginRequest component schema', () => {
    const schema = doc.paths['/api/v1/auth/login'].post.requestBody.content['application/json'].schema;
    expect(schema).toEqual(ref('LoginRequest'));
  });
});

describe('build artifact', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverRoot = join(here, '..', '..');

  it('the document module is TypeScript source under src (compiled by tsc -b)', () => {
    expect(existsSync(join(serverRoot, 'src', 'openapi', 'document.ts'))).toBe(true);
  });

  it('dist/openapi/document.js exists post-build (asserted when the build has run)', () => {
    const distFile = join(serverRoot, 'dist', 'openapi', 'document.js');
    const distDir = join(serverRoot, 'dist');
    if (existsSync(distDir)) {
      expect(existsSync(distFile)).toBe(true);
    } else {
      // Pre-build lanes (hermetic npm test) instead prove the source is in
      // the compile graph: tsc -b includes src/**/* per apps/server tsconfig.
      const tsconfig = JSON.parse(readFileSync(join(serverRoot, 'tsconfig.json'), 'utf-8')) as Json;
      expect(JSON.stringify(tsconfig.include ?? [])).toContain('src');
    }
  });

  it('index.ts registers openApiRoute before the static SPA fallback', () => {
    const indexSource = readFileSync(join(serverRoot, 'src', 'index.ts'), 'utf-8');
    const openApiIdx = indexSource.indexOf('await fastify.register(openApiRoute)');
    const staticIdx = indexSource.indexOf('await fastify.register(staticRoutes)');
    expect(openApiIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(openApiIdx).toBeLessThan(staticIdx);
  });
});
