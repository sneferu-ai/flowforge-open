/**
 * OpenAPI 3.1.0 document for the FlowForge Open API (§9) — hand-authored,
 * compiled into the server bundle, and served at GET /openapi.json.
 *
 * Ground rules:
 *  - The document describes the server AS SHIPPED: API routes under /api/v1
 *    are workspace-scoped by the SESSION (auth middleware resolves the
 *    workspace from the session/CSRF context), so the paths are the flat
 *    /api/v1/<resource> forms the route layer registers — not the
 *    /api/v1/workspaces/{slug}/<resource> spellings of the prose §9 table.
 *  - Every /api/v1 operation returns the { data, error } envelope: success
 *    responses are documented as an inline envelope whose `data` carries the
 *    mapped schema; error responses reference the Envelope schema with
 *    data: null. Root routes (/healthz, /readyz, /demo/*, /hooks/*,
 *    /mock-idp/*, /openapi.json) are envelope-exempt.
 *  - The document is a static compiled constant: no DB reads, no file IO —
 *    it is served whenever the app is listening, even before migrations
 *    complete.
 */

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

const S = (name: string): Obj => ({ $ref: `#/components/schemas/${name}` });
const arrOf = (name: string): Obj => ({ type: 'array', items: S(name) });
const str: Obj = { type: 'string' };
const int: Obj = { type: 'integer' };
const bool: Obj = { type: 'boolean' };
const strOrNull: Obj = { type: ['string', 'null'] };
const objOrNull: Obj = { type: ['object', 'null'] };
const rawObj = (description: string): Obj => ({ type: 'object', additionalProperties: true, description });

/** The { data, error } envelope wrapping every /api/v1 success body. */
const envelopeOf = (data: Obj): Obj => ({
  type: 'object',
  required: ['data'],
  properties: {
    data,
    error: { anyOf: [S('Error'), { type: 'null' }] },
  },
  additionalProperties: true,
});

/** Inline `data: { ok: true }` success shape used by DELETE/ack endpoints. */
const okData = (extra?: Obj): Obj => ({
  type: 'object',
  required: ['ok'],
  properties: { ok: bool, ...(extra ?? {}) },
});

const jsonRes = (schema: Obj, description: string): Obj => ({
  description,
  content: { 'application/json': { schema } },
});

/** API success: envelope-wrapped `data`. */
const apiData = (data: Obj, description: string): Obj => jsonRes(envelopeOf(data), description);

/** API error: the Envelope schema with data: null. */
const apiErr = (description: string): Obj => jsonRes(S('Envelope'), description);

/** Root-route error: bare { error: string } without the envelope. */
const rootErr = (description: string): Obj =>
  jsonRes({ type: 'object', required: ['error'], properties: { error: str } }, description);

const noContent = (description: string): Obj => ({ description });

const redirectRes = (description: string): Obj => ({
  description,
  headers: { Location: { schema: str, description: 'Redirect target' } },
});

const pathParam = (name: string, description: string): Obj => ({
  name,
  in: 'path',
  required: true,
  schema: str,
  description,
});

const queryParam = (name: string, description: string, schema: Obj = str): Obj => ({
  name,
  in: 'query',
  required: false,
  schema,
  description,
});

const jsonBody = (properties: Obj, required: string[], description = ''): Obj => ({
  required: true,
  ...(description ? { description } : {}),
  content: {
    'application/json': {
      schema: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    },
  },
});

const rawJsonBody = (description: string): Obj => ({
  required: true,
  description,
  content: { 'application/json': { schema: rawObj(description) } },
});

const SESSION_AUTH = [{ sessionCookie: [] }, { bearerToken: [] }];

interface OpSpec {
  summary: string;
  description?: string;
  tags?: string[];
  params?: Obj[];
  query?: Obj[];
  body?: Obj;
  successCode?: string;
  success: Obj;
  auth?: boolean;
  validation?: boolean;
  forbidden?: boolean;
  notFound?: boolean;
  conflict?: boolean;
  locked?: boolean;
  tooMany?: boolean;
  extraErrors?: Obj;
  rootErrors?: boolean;
}

function op(operationId: string, spec: OpSpec): Obj {
  const responses: Obj = {};
  responses[spec.successCode ?? '200'] = spec.success;
  if (spec.validation) responses['400'] = (spec.rootErrors ? rootErr : apiErr)('Validation error (validation_error)');
  if (spec.auth) responses['401'] = (spec.rootErrors ? rootErr : apiErr)('Authentication required or invalid credentials');
  if (spec.forbidden) responses['403'] = apiErr('The caller lacks the required permission (forbidden / plan_feature_required)');
  if (spec.notFound) responses['404'] = (spec.rootErrors ? rootErr : apiErr)('Resource not found (not_found)');
  if (spec.conflict) responses['409'] = apiErr('Conflict with existing state (conflict)');
  if (spec.locked) responses['423'] = apiErr('Account locked after repeated failures (account_locked)');
  if (spec.tooMany) responses['429'] = apiErr('Rate limit or run limit exceeded (rate_limited / run_limit_exceeded / concurrency_limit_exceeded)');
  if (spec.extraErrors) {
    for (const [code, res] of Object.entries(spec.extraErrors)) responses[code] = res;
  }
  return {
    operationId,
    summary: spec.summary,
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.tags ? { tags: spec.tags } : {}),
    ...(spec.auth ? { security: SESSION_AUTH } : {}),
    ...(spec.params || spec.query ? { parameters: [...(spec.params ?? []), ...(spec.query ?? [])] } : {}),
    ...(spec.body ? { requestBody: spec.body } : {}),
    responses,
  };
}

// ---------------------------------------------------------------------------
// components.schemas — the 35 named schemas (§9 data model contract)
// ---------------------------------------------------------------------------

const schemas = {
  Envelope: {
    type: 'object',
    properties: {
      data: { nullable: true, description: 'The response payload. Null on error; any shape on success.' },
      error: { anyOf: [S('Error'), { type: 'null' }], description: 'Present (with code/message) on failure; null on success.' },
    },
  },
  Error: {
    type: 'object',
    required: ['code', 'message'],
    properties: { code: str, message: str },
    additionalProperties: false,
  },
  Pagination: {
    type: 'object',
    properties: { page: int, pageSize: int, total: int, totalPages: int },
    additionalProperties: false,
  },
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: { email: str, password: str },
    additionalProperties: false,
  },
  LoginResponse: {
    type: 'object',
    properties: {
      user: S('User'),
      workspaces: arrOf('Workspace'),
      csrf_token: { ...str, description: 'CSRF token for subsequent state-changing requests (X-CSRF-Token header).' },
    },
    additionalProperties: false,
  },
  Workspace: {
    type: 'object',
    properties: { id: str, name: str, slug: str, plan: str, created_at: str },
    additionalProperties: false,
  },
  WorkspaceMembership: {
    type: 'object',
    properties: { id: str, workspace_id: str, user_id: str, role: str, created_at: str },
    additionalProperties: false,
  },
  Invitation: {
    type: 'object',
    properties: { id: str, workspace_id: str, email: str, role: str, status: str, created_at: str },
    additionalProperties: false,
  },
  Plan: {
    type: 'object',
    properties: {
      id: str,
      name: str,
      price_monthly_cents: int,
      run_limit: int,
      seats: int,
      run_history_days: int,
      audit_retention_days: { type: ['integer', 'null'] },
      timeout_hours: { type: ['integer', 'null'] },
      overage_rate_cents: { type: ['integer', 'null'] },
      rate_limit: int,
      concurrency_limit: { type: ['integer', 'null'] },
    },
    additionalProperties: false,
  },
  Subscription: {
    type: 'object',
    properties: {
      id: str,
      workspace_id: str,
      plan_id: str,
      status: str,
      runs_consumed: int,
      current_period_start: str,
      current_period_end: str,
    },
    additionalProperties: false,
  },
  Workflow: {
    type: 'object',
    properties: {
      id: str,
      name: str,
      slug: str,
      manifest: str,
      status: str,
      workspace_id: str,
      created_at: str,
      updated_at: str,
    },
    additionalProperties: false,
  },
  WorkflowVersion: {
    type: 'object',
    properties: { id: str, workflow_id: str, version: int, manifest: str, created_at: str, created_by: str },
    additionalProperties: false,
  },
  Trigger: {
    type: 'object',
    properties: { id: str, workflow_id: str, type: str, config: { type: 'object' }, status: str, created_at: str },
    additionalProperties: false,
  },
  Run: {
    type: 'object',
    properties: {
      id: str,
      workflow_id: str,
      status: str,
      started_at: strOrNull,
      completed_at: strOrNull,
      trigger_type: str,
      created_at: str,
    },
    additionalProperties: false,
  },
  RunStep: {
    type: 'object',
    properties: {
      id: str,
      run_id: str,
      step_path: str,
      status: str,
      attempt: int,
      started_at: strOrNull,
      completed_at: strOrNull,
      output: objOrNull,
      error: objOrNull,
    },
    additionalProperties: false,
  },
  RunEvent: {
    type: 'object',
    properties: { id: str, run_id: str, type: str, data: objOrNull, timestamp: str },
    additionalProperties: false,
  },
  Credential: {
    type: 'object',
    properties: { id: str, workspace_id: str, name: str, type: str, created_at: str },
    additionalProperties: false,
  },
  AuditEvent: {
    type: 'object',
    properties: {
      id: str,
      workspace_id: str,
      type: str,
      actor_id: strOrNull,
      data: objOrNull,
      timestamp: str,
      hash: str,
    },
    additionalProperties: false,
  },
  AuditVerification: {
    type: 'object',
    properties: { verified: bool, event_count: int, last_verified_at: str },
    additionalProperties: false,
  },
  UsageReport: {
    type: 'object',
    properties: {
      runs_consumed: int,
      run_limit: int,
      overage: int,
      current_period_start: str,
      current_period_end: str,
    },
    additionalProperties: false,
  },
  Invoice: {
    type: 'object',
    properties: {
      id: str,
      workspace_id: str,
      amount_cents: int,
      status: str,
      period_start: str,
      period_end: str,
      created_at: str,
    },
    additionalProperties: false,
  },
  ApiToken: {
    type: 'object',
    properties: { id: str, workspace_id: str, name: str, token: strOrNull, last_used_at: strOrNull, created_at: str },
    additionalProperties: false,
  },
  WebhookSecret: {
    type: 'object',
    properties: { id: str, workspace_id: str, name: str, created_at: str },
    additionalProperties: false,
  },
  OidcProvider: {
    type: 'object',
    properties: { id: str, workspace_id: str, name: str, issuer_url: str, client_id: str, created_at: str },
    additionalProperties: false,
  },
  AllowlistEntry: {
    type: 'object',
    properties: { id: str, workspace_id: str, pattern: str, created_at: str },
    additionalProperties: false,
  },
  Notification: {
    type: 'object',
    properties: { id: str, workspace_id: str, type: str, message: str, read: bool, created_at: str },
    additionalProperties: false,
  },
  Template: {
    type: 'object',
    properties: { id: str, name: str, slug: str, summary: str, manifest: str, category: str },
    additionalProperties: false,
  },
  ApprovalTask: {
    type: 'object',
    properties: {
      id: str,
      run_id: str,
      step_path: str,
      prompt: str,
      status: str,
      decision: strOrNull,
      decided_by: strOrNull,
      decided_at: strOrNull,
      timeout_seconds: int,
      created_at: str,
    },
    additionalProperties: false,
  },
  ManifestValidationResult: {
    type: 'object',
    properties: {
      valid: bool,
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: { code: str, message: str, path: str },
        },
      },
    },
    additionalProperties: false,
  },
  RunCreatedResponse: {
    type: 'object',
    properties: { run_id: str, status: str },
    additionalProperties: false,
  },
  HealthStatus: {
    type: 'object',
    properties: { status: { ...str, description: "'ok' when the process is serving, 'degraded' when the database probe failed." } },
    additionalProperties: false,
  },
  ReadyStatus: {
    type: 'object',
    properties: { status: { ...str, description: "'ok' when Postgres, Redis and migrations are all ready; 503 with 'not_ready' otherwise." } },
    additionalProperties: false,
  },
  DemoCredentials: {
    type: 'object',
    required: ['email', 'password'],
    properties: { email: str, password: str },
    additionalProperties: false,
  },
  User: {
    type: 'object',
    properties: { id: str, email: str, name: str, created_at: str },
    additionalProperties: false,
  },
  Session: {
    type: 'object',
    properties: { token: str, expires_at: str, workspace_id: strOrNull },
    additionalProperties: false,
  },
} as const;

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const A = '/api/v1';

const demoNote =
  'Built-in demo dataset for the seeded demo workflows. The demo account and workspace exist only with demo seeding enabled (`FF_SEED_DEMO=true`).';
const mockIdpNote =
  'Always available in this build: the mock OIDC provider routes are registered unconditionally (it is the in-box provable IdP; tokens are signed with FF_OIDC_SIGNING_KEY).';

const paths: Obj = {
  // ---- Auth -------------------------------------------------------------
  [`${A}/auth/register`]: {
    post: op('register-account', {
      tags: ['Auth'],
      summary: 'Register a user and create their first workspace',
      body: jsonBody(
        { email: str, password: str, name: str, workspace_name: str },
        ['email', 'password', 'name'],
        'workspace_name is optional; defaults to "<name>\'s Workspace".'
      ),
      successCode: '201',
      success: apiData(
        {
          type: 'object',
          properties: {
            id: str,
            email: str,
            name: str,
            user: S('User'),
            workspaces: arrOf('Workspace'),
            csrf_token: str,
          },
        },
        'Created account plus a pre-workspace session (ff_session cookie set; the client then calls /auth/select-workspace).'
      ),
      validation: true,
      conflict: true,
    }),
  },
  [`${A}/auth/login`]: {
    post: op('login', {
      tags: ['Auth'],
      summary: 'Log in with email and password',
      body: { required: true, content: { 'application/json': { schema: S('LoginRequest') } } },
      success: apiData(S('LoginResponse'), 'Authenticated user, workspace list, and CSRF token; sets the ff_session cookie.'),
      validation: true,
      locked: true,
      extraErrors: { '401': apiErr('Invalid email or password (invalid_credentials)') },
    }),
  },
  [`${A}/auth/select-workspace`]: {
    post: op('select-workspace', {
      tags: ['Auth'],
      summary: 'Exchange the pre-workspace session for a workspace-scoped session',
      body: jsonBody(
        { workspace_slug: str, workspace_id: str },
        [],
        'Exactly one of workspace_slug or workspace_id must be supplied.'
      ),
      success: apiData(
        {
          type: 'object',
          properties: { workspace: S('Workspace'), role: str, csrf_token: str },
        },
        'Workspace-scoped session issued (ff_session cookie replaced; the old pre-workspace session is revoked).'
      ),
      auth: true,
      validation: true,
      forbidden: true,
    }),
  },
  [`${A}/auth/logout`]: {
    post: op('logout', {
      tags: ['Auth'],
      summary: 'Revoke the current session and clear the session cookie',
      successCode: '204',
      success: noContent('Session revoked; no body.'),
    }),
  },
  [`${A}/auth/me`]: {
    get: op('get-current-session', {
      tags: ['Auth'],
      summary: 'Current user, workspace (when scoped), and workspace list',
      success: apiData(
        {
          type: 'object',
          properties: {
            user: S('User'),
            workspaces: arrOf('Workspace'),
            workspace: { anyOf: [S('Workspace'), { type: 'null' }] },
            role: strOrNull,
            csrf_token: str,
          },
        },
        'workspace and role are null while the session is pre-workspace.'
      ),
      auth: true,
    }),
  },
  [`${A}/auth/change-password`]: {
    post: op('change-password', {
      tags: ['Auth'],
      summary: 'Change password (revokes all sessions and API tokens)',
      body: jsonBody({ current_password: str, new_password: str }, ['current_password', 'new_password']),
      successCode: '204',
      success: noContent('Password updated; all sessions and API tokens revoked.'),
      auth: true,
      validation: true,
      extraErrors: { '401': apiErr('Current password incorrect (invalid_credentials)') },
    }),
  },
  [`${A}/auth/invite/accept`]: {
    post: op('accept-invitation', {
      tags: ['Auth'],
      summary: 'Accept a workspace invitation token',
      body: jsonBody({ token: str }, ['token']),
      success: apiData(
        {
          type: 'object',
          properties: { workspace: S('Workspace'), membership: S('WorkspaceMembership'), csrf_token: str },
        },
        'Joins the workspace and returns a workspace-scoped session.'
      ),
      auth: true,
      validation: true,
      notFound: true,
    }),
  },
  [`${A}/auth/csrf`]: {
    get: op('get-csrf-token', {
      tags: ['Auth'],
      summary: 'Return the CSRF token for the current session',
      success: apiData({ type: 'object', properties: { csrf_token: str } }, 'CSRF token for X-CSRF-Token headers.'),
      auth: true,
    }),
  },
  [`${A}/auth/oidc/{provider}/login`]: {
    get: op('oidc-login-redirect', {
      tags: ['Auth', 'OIDC'],
      summary: 'Begin the OIDC authorization-code flow for a workspace provider',
      params: [pathParam('provider', 'Workspace-scoped OIDC provider name')],
      successCode: '302',
      success: redirectRes('Redirect to the provider authorization endpoint.'),
      notFound: true,
    }),
  },
  [`${A}/auth/oidc/{provider}/callback`]: {
    get: op('oidc-callback', {
      tags: ['Auth', 'OIDC'],
      summary: 'OIDC redirect callback — exchanges the code, creates the session',
      params: [pathParam('provider', 'Workspace-scoped OIDC provider name')],
      successCode: '302',
      success: redirectRes('Redirect to the application after session creation.'),
      validation: true,
      notFound: true,
      extraErrors: { '401': apiErr('OIDC authentication failed (invalid state, code exchange, or token verification)') },
    }),
  },
  [`${A}/auth/oidc/{provider}/logout`]: {
    get: op('oidc-logout', {
      tags: ['Auth', 'OIDC'],
      summary: 'End the app session, then redirect to the IdP logout when available',
      params: [pathParam('provider', 'Workspace-scoped OIDC provider name')],
      successCode: '302',
      success: redirectRes('Redirect to the IdP end-session endpoint (mock IdP) or the app root.'),
    }),
  },

  // ---- Workspaces -------------------------------------------------------
  [`${A}/workspaces`]: {
    get: op('list-workspaces', {
      tags: ['Workspaces'],
      summary: 'List workspaces the current user belongs to',
      success: apiData(arrOf('Workspace'), 'Workspaces visible to the session user.'),
      auth: true,
    }),
    post: op('create-workspace', {
      tags: ['Workspaces'],
      summary: 'Create a workspace (creator becomes owner; Free plan assigned)',
      body: jsonBody({ name: str, slug: str }, ['name'], 'slug is optional; derived from name with collision suffixing when omitted.'),
      successCode: '201',
      success: apiData(S('Workspace'), 'The created workspace.'),
      auth: true,
      validation: true,
      conflict: true,
    }),
  },
  [`${A}/workspaces/{slug}`]: {
    get: op('get-workspace', {
      tags: ['Workspaces'],
      summary: 'Get a workspace by slug',
      params: [pathParam('slug', 'Workspace slug')],
      success: apiData(S('Workspace'), 'Workspace detail with plan info.'),
      auth: true,
      notFound: true,
    }),
    delete: op('delete-workspace', {
      tags: ['Workspaces'],
      summary: 'Delete a workspace (owner only)',
      params: [pathParam('slug', 'Workspace slug')],
      success: apiData(okData(), 'Workspace deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },

  // ---- Members / invitations / sessions ---------------------------------
  [`${A}/members`]: {
    get: op('list-members', {
      tags: ['Members'],
      summary: 'List members of the session workspace',
      success: apiData(arrOf('WorkspaceMembership'), 'Workspace members with roles.'),
      auth: true,
    }),
  },
  [`${A}/members/{userId}`]: {
    delete: op('remove-member', {
      tags: ['Members'],
      summary: "Remove a member (revokes their sessions and API tokens; the last owner can't be removed)",
      params: [pathParam('userId', 'User id to remove')],
      success: apiData(okData(), 'Member removed.'),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/members/{userId}/role`]: {
    patch: op('change-member-role', {
      tags: ['Members'],
      summary: "Change a member's role (owner-only; the last owner can't be demoted)",
      params: [pathParam('userId', 'User id to update')],
      body: jsonBody({ role: str }, ['role']),
      success: apiData(S('WorkspaceMembership'), 'The updated membership.'),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/invitations`]: {
    get: op('list-invitations', {
      tags: ['Members'],
      summary: 'List pending invitations for the session workspace',
      success: apiData(arrOf('Invitation'), 'Pending invitations.'),
      auth: true,
    }),
    post: op('create-invitation', {
      tags: ['Members'],
      summary: 'Invite a member by email',
      body: jsonBody({ email: str, role: str }, ['email'], 'role defaults to member.'),
      success: apiData(
        { type: 'object', properties: { id: str, token: str, email: str, role: str, expires_at: str } },
        'The invitation; the raw token is returned once and never persisted.'
      ),
      auth: true,
      validation: true,
      forbidden: true,
      conflict: true,
    }),
  },
  [`${A}/invitations/{id}`]: {
    delete: op('revoke-invitation', {
      tags: ['Members'],
      summary: 'Revoke a pending invitation',
      params: [pathParam('id', 'Invitation id')],
      success: apiData(okData(), 'Invitation revoked.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/invitations/{id}/resend`]: {
    post: op('resend-invitation', {
      tags: ['Members'],
      summary: 'Resend an invitation (mints a fresh token)',
      params: [pathParam('id', 'Invitation id')],
      success: apiData(
        { type: 'object', properties: { id: str, token: str, email: str, role: str, expires_at: str } },
        'The re-issued invitation token.'
      ),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/sessions/{userId}`]: {
    delete: op('revoke-user-sessions', {
      tags: ['Members'],
      summary: "Revoke one member's sessions for the session workspace",
      params: [pathParam('userId', 'User id whose sessions are revoked')],
      success: apiData(okData({ revoked: int }), 'Sessions revoked.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/sessions`]: {
    delete: op('revoke-workspace-sessions', {
      tags: ['Members'],
      summary: 'Revoke all sessions for the session workspace',
      success: apiData(okData({ revoked: int }), 'Sessions revoked.'),
      auth: true,
      forbidden: true,
    }),
  },

  // ---- Workflows ----------------------------------------------------------
  [`${A}/workflows`]: {
    get: op('list-workflows', {
      tags: ['Workflows'],
      summary: 'List workflows in the session workspace',
      query: [queryParam('include_disabled', "Set to 'true' to include disabled workflows")],
      success: apiData(arrOf('Workflow'), 'Workspace workflows.'),
      auth: true,
    }),
    post: op('create-workflow', {
      tags: ['Workflows'],
      summary: 'Create a workflow from a YAML manifest (creates version 1)',
      body: jsonBody(
        { name: str, manifest: str, manifest_yaml: str, summary: str },
        ['name', 'manifest'],
        "manifest is the raw YAML string (manifest_yaml is the accepted legacy spelling)."
      ),
      success: apiData(
        { type: 'object', properties: { id: str, name: str, slug: str, summary: strOrNull, version: int, version_id: str } },
        'The created workflow and its first version.'
      ),
      auth: true,
      validation: true,
      forbidden: true,
    }),
  },
  [`${A}/workflows/validate`]: {
    post: op('validate-manifest', {
      tags: ['Workflows'],
      summary: 'Validate a workflow manifest without persisting anything',
      body: jsonBody({ manifest: str }, ['manifest']),
      success: apiData(S('ManifestValidationResult'), 'Validation outcome with located errors (and warnings).'),
      auth: true,
      validation: true,
    }),
  },
  [`${A}/workflows/{id}`]: {
    get: op('get-workflow', {
      tags: ['Workflows'],
      summary: 'Get a workflow with its current version',
      params: [pathParam('id', 'Workflow id')],
      success: apiData(S('Workflow'), 'The workflow.'),
      auth: true,
      notFound: true,
    }),
    put: op('update-workflow', {
      tags: ['Workflows'],
      summary: 'Update workflow metadata or add a new manifest version',
      params: [pathParam('id', 'Workflow id')],
      body: jsonBody(
        { name: str, summary: str, is_enabled: bool, slug: str, manifest: str },
        [],
        'All fields optional; supplying manifest creates a new (non-current) version.'
      ),
      success: apiData(S('Workflow'), 'The updated workflow.'),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
    delete: op('delete-workflow', {
      tags: ['Workflows'],
      summary: 'Delete a workflow',
      params: [pathParam('id', 'Workflow id')],
      success: apiData(okData(), 'Workflow deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/{id}/manifest`]: {
    get: op('get-workflow-manifest', {
      tags: ['Workflows'],
      summary: "Get the workflow's current manifest YAML",
      params: [pathParam('id', 'Workflow id')],
      success: apiData(
        { type: 'object', properties: { manifest_yaml: str, version_num: int } },
        'The current version manifest and version number.'
      ),
      auth: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/{id}/validate`]: {
    post: op('validate-workflow-manifest', {
      tags: ['Workflows'],
      summary: 'Validate a manifest against a workflow context',
      params: [pathParam('id', 'Workflow id')],
      body: jsonBody({ manifest: str }, ['manifest']),
      success: apiData(S('ManifestValidationResult'), 'Validation outcome with located errors (and warnings).'),
      auth: true,
      validation: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/{id}/run`]: {
    post: op('run-workflow', {
      tags: ['Runs'],
      summary: 'Trigger a manual run (10-second bucket dedup; plan admission limits apply)',
      params: [pathParam('id', 'Workflow id')],
      body: {
        required: false,
        content: { 'application/json': { schema: { type: 'object', properties: { inputs: { type: 'object' } } } } },
      },
      successCode: '201',
      success: apiData(
        { type: 'object', required: ['run_id'], properties: { run_id: str } },
        'Run created and queued. A duplicate submission inside the 10-second bucket returns 200 with the existing run_id.'
      ),
      auth: true,
      forbidden: true,
      notFound: true,
      tooMany: true,
      extraErrors: { '200': apiData({ type: 'object', required: ['run_id'], properties: { run_id: str } }, 'Deduplicated: the existing run id for this 10-second bucket.') },
    }),
  },
  [`${A}/workflows/{id}/trigger`]: {
    post: op('trigger-workflow', {
      tags: ['Runs'],
      summary: 'Alias of POST /workflows/{id}/run',
      params: [pathParam('id', 'Workflow id')],
      body: {
        required: false,
        content: { 'application/json': { schema: { type: 'object', properties: { inputs: { type: 'object' } } } } },
      },
      successCode: '201',
      success: apiData(
        { type: 'object', required: ['run_id'], properties: { run_id: str } },
        'Run created and queued (see /workflows/{id}/run).'
      ),
      auth: true,
      forbidden: true,
      notFound: true,
      tooMany: true,
    }),
  },
  [`${A}/workflows/{id}/versions`]: {
    get: op('list-workflow-versions', {
      tags: ['Workflows'],
      summary: 'List workflow versions (includes manifest YAML)',
      params: [pathParam('id', 'Workflow id')],
      success: apiData(arrOf('WorkflowVersion'), 'All versions, newest first.'),
      auth: true,
      notFound: true,
    }),
    post: op('create-workflow-version', {
      tags: ['Workflows'],
      summary: 'Create a new (non-current) draft version',
      params: [pathParam('id', 'Workflow id')],
      body: jsonBody({ manifest: str }, ['manifest']),
      successCode: '201',
      success: apiData(
        { type: 'object', properties: { id: str, version_num: int, is_current: bool } },
        'The created draft version.'
      ),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/{id}/promote/{versionId}`]: {
    post: op('promote-workflow-version', {
      tags: ['Workflows'],
      summary: 'Promote a version to current',
      params: [pathParam('id', 'Workflow id'), pathParam('versionId', 'Version id to promote')],
      success: apiData(
        { type: 'object', properties: { workflow: { type: 'object', properties: { id: str } }, promoted_version: int } },
        'The promoted version number.'
      ),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/from-template`]: {
    post: op('create-workflow-from-template', {
      tags: ['Workflows', 'Templates'],
      summary: 'Create a workflow from a gallery template',
      body: jsonBody({ template_id: str, name: str }, ['template_id'], 'name defaults to the template display name.'),
      success: apiData(
        { type: 'object', properties: { id: str, name: str, summary: strOrNull, version: int, version_id: str, template: str } },
        'The created workflow.'
      ),
      auth: true,
      forbidden: true,
      notFound: true,
      conflict: true,
    }),
  },

  // ---- Triggers -----------------------------------------------------------
  [`${A}/workflows/{id}/triggers`]: {
    get: op('list-triggers', {
      tags: ['Triggers'],
      summary: 'List triggers for a workflow',
      params: [pathParam('id', 'Workflow id')],
      success: apiData(arrOf('Trigger'), 'The workflow triggers.'),
      auth: true,
      notFound: true,
    }),
    post: op('create-trigger', {
      tags: ['Triggers'],
      summary: 'Create a schedule or webhook trigger',
      params: [pathParam('id', 'Workflow id')],
      body: jsonBody({ type: str, config: { type: 'object' } }, ['type', 'config'], "type is 'schedule' or 'webhook'; webhook configs require a unique path."),
      successCode: '201',
      success: apiData(
        { type: 'object', properties: { id: str, type: str, config: { type: 'object' }, is_enabled: bool, next_fire_at: strOrNull } },
        'The created trigger.'
      ),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
  },
  [`${A}/workflows/{id}/triggers/{triggerId}`]: {
    put: op('update-trigger', {
      tags: ['Triggers'],
      summary: 'Update a trigger (enable/disable or replace config)',
      params: [pathParam('id', 'Workflow id'), pathParam('triggerId', 'Trigger id')],
      body: jsonBody({ is_enabled: bool, config: { type: 'object' } }, [], 'All fields optional.'),
      success: apiData(S('Trigger'), 'The updated trigger.'),
      auth: true,
      validation: true,
      forbidden: true,
      notFound: true,
    }),
    delete: op('delete-trigger', {
      tags: ['Triggers'],
      summary: 'Delete a trigger',
      params: [pathParam('id', 'Workflow id'), pathParam('triggerId', 'Trigger id')],
      success: apiData(okData(), 'Trigger deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },

  // ---- Runs ---------------------------------------------------------------
  [`${A}/runs`]: {
    get: op('list-runs', {
      tags: ['Runs'],
      summary: 'List runs in the session workspace (newest first)',
      query: [queryParam('status', 'Filter by run status'), queryParam('workflow_id', 'Filter by workflow id')],
      success: apiData(arrOf('Run'), 'Workspace runs.'),
      auth: true,
    }),
  },
  [`${A}/runs/{id}`]: {
    get: op('get-run', {
      tags: ['Runs'],
      summary: 'Get a run with its detail',
      params: [pathParam('id', 'Run id')],
      success: apiData(S('Run'), 'The run.'),
      auth: true,
      notFound: true,
    }),
  },
  [`${A}/runs/{id}/steps`]: {
    get: op('list-run-steps', {
      tags: ['Runs'],
      summary: 'List the steps of a run in execution order',
      params: [pathParam('id', 'Run id')],
      success: apiData(arrOf('RunStep'), 'Recorded step executions.'),
      auth: true,
      notFound: true,
    }),
  },
  [`${A}/runs/{id}/events`]: {
    get: op('stream-run-events', {
      tags: ['Runs'],
      summary: 'Server-Sent Events stream of run events',
      params: [pathParam('id', 'Run id')],
      success: {
        description:
          'text/event-stream of run events: run.created, run.queued, run.started, step.started, step.succeeded, step.failed, step.skipped, step.waiting, step.paused, run.succeeded, run.failed, run.canceled, plus a heartbeat every 15s. Events whose data exceeds 1MB are truncated with truncated: true; the stream closes on terminal state.',
        content: { 'text/event-stream': { schema: { type: 'string', description: 'SSE frames; each data payload conforms to the RunEvent schema.' } } },
      },
      auth: true,
      notFound: true,
    }),
  },
  [`${A}/runs/{id}/cancel`]: {
    post: op('cancel-run', {
      tags: ['Runs'],
      summary: 'Cancel a running or paused run',
      params: [pathParam('id', 'Run id')],
      success: apiData({ type: 'object', properties: { status: { ...str, description: "'canceled'" } } }, 'Run canceled.'),
      auth: true,
      notFound: true,
    }),
  },
  [`${A}/runs/{id}/approve-all`]: {
    post: op('approve-all-pending', {
      tags: ['Runs', 'Approvals'],
      summary: 'Approve every pending approval task for a run and resume it',
      params: [pathParam('id', 'Run id')],
      success: apiData({ type: 'object', properties: { approved_count: int } }, 'Number of tasks approved.'),
      auth: true,
      notFound: true,
    }),
  },

  // ---- Approvals ----------------------------------------------------------
  [`${A}/approvals`]: {
    get: op('list-approvals', {
      tags: ['Approvals'],
      summary: 'List pending approval tasks in the session workspace',
      success: apiData(arrOf('ApprovalTask'), 'Pending approval tasks.'),
      auth: true,
    }),
  },
  [`${A}/approvals/{taskId}/approve`]: {
    post: op('approve-task', {
      tags: ['Approvals'],
      summary: 'Approve a pending approval task (run resumes)',
      params: [pathParam('taskId', 'Approval task id')],
      success: apiData({ type: 'object', properties: { status: { ...str, description: "'queued' — the run is resumed" } } }, 'Task approved.'),
      auth: true,
      notFound: true,
      conflict: true,
    }),
  },
  [`${A}/approvals/{taskId}/reject`]: {
    post: op('reject-task', {
      tags: ['Approvals'],
      summary: 'Reject a pending approval task',
      params: [pathParam('taskId', 'Approval task id')],
      body: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { reason: str } } } } },
      success: apiData(
        { type: 'object', properties: { status: { ...str, description: "'queued' (resume) or 'canceled' (reject-with-abort)" } } },
        'Task rejected.'
      ),
      auth: true,
      notFound: true,
      conflict: true,
    }),
  },
  [`${A}/approvals/{taskId}/decide`]: {
    post: op('decide-task', {
      tags: ['Approvals'],
      summary: "Legacy combined decision endpoint (kept for CLI compatibility)",
      params: [pathParam('taskId', 'Approval task id')],
      body: jsonBody({ decision: { ...str, enum: ['approved', 'rejected'] } }, ['decision']),
      success: apiData({ type: 'object', properties: { status: str } }, 'Decision applied.'),
      auth: true,
      validation: true,
      notFound: true,
      conflict: true,
    }),
  },

  // ---- Credentials ----------------------------------------------------------
  [`${A}/credentials`]: {
    get: op('list-credentials', {
      tags: ['Credentials'],
      summary: 'List vault credentials (values are never returned)',
      success: apiData(arrOf('Credential'), 'Masked credential list.'),
      auth: true,
    }),
    post: op('create-credential', {
      tags: ['Credentials'],
      summary: 'Store an encrypted credential (AES-256-GCM vault)',
      body: jsonBody({ name: str, type: str, value: str }, ['name', 'type', 'value']),
      successCode: '201',
      success: apiData({ type: 'object', properties: { id: str, name: str, type: str } }, 'The stored credential (value never echoed).'),
      auth: true,
      validation: true,
      forbidden: true,
      conflict: true,
    }),
  },
  [`${A}/credentials/{id}`]: {
    delete: op('delete-credential', {
      tags: ['Credentials'],
      summary: 'Delete a credential (409 while referenced by active workflows)',
      params: [pathParam('id', 'Credential id')],
      success: apiData(okData(), 'Credential deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
      conflict: true,
    }),
  },

  // ---- Audit ----------------------------------------------------------------
  [`${A}/audit`]: {
    get: op('list-audit-events', {
      tags: ['Audit'],
      summary: 'List append-only audit events for the session workspace',
      query: [queryParam('limit', 'Maximum events to return', int), queryParam('type', 'Filter by audit action type')],
      success: apiData(arrOf('AuditEvent'), 'Audit events (hash-chained).'),
      auth: true,
    }),
  },
  [`${A}/audit/verify`]: {
    get: op('verify-audit-chain', {
      tags: ['Audit'],
      summary: 'Verify the SHA-256 audit chain from the anchor forward',
      success: apiData(S('AuditVerification'), 'Chain verification result.'),
      auth: true,
    }),
  },

  // ---- Usage and billing -----------------------------------------------------
  [`${A}/usage`]: {
    get: op('get-usage', {
      tags: ['Billing'],
      summary: 'Current-period usage against the plan run limit',
      success: apiData(S('UsageReport'), 'Runs consumed, limit, and projected overage.'),
      auth: true,
    }),
  },
  [`${A}/invoices`]: {
    get: op('list-invoices', {
      tags: ['Billing'],
      summary: 'List invoices for the session workspace',
      success: apiData(arrOf('Invoice'), 'Billing-period invoices.'),
      auth: true,
    }),
  },
  [`${A}/subscription`]: {
    get: op('get-subscription', {
      tags: ['Billing'],
      summary: 'Current subscription and plan detail',
      success: apiData(S('Subscription'), 'The active subscription with plan information.'),
      auth: true,
    }),
    post: op('change-plan', {
      tags: ['Billing'],
      summary: 'Change plan (owner only; free, pro, or studio)',
      body: jsonBody({ plan_id: str }, ['plan_id']),
      success: apiData(S('Subscription'), 'The updated subscription.'),
      auth: true,
      validation: true,
      forbidden: true,
    }),
  },

  // ---- Allowlist --------------------------------------------------------------
  [`${A}/allowlist`]: {
    get: op('list-allowlist', {
      tags: ['Allowlist'],
      summary: 'List the per-workspace egress allowlist',
      success: apiData(arrOf('AllowlistEntry'), 'Allowlist entries.'),
      auth: true,
    }),
    post: op('create-allowlist-entry', {
      tags: ['Allowlist'],
      summary: 'Add an egress allowlist entry (exact host, no wildcards)',
      body: jsonBody({ scheme: { ...str, enum: ['http', 'https'] }, host: str, port: int }, ['scheme', 'host'], 'port is optional (1-65535).'),
      successCode: '201',
      success: apiData({ type: 'object', properties: { id: str, scheme: str, host: str, port: { type: ['integer', 'null'] } } }, 'The created entry.'),
      auth: true,
      validation: true,
      forbidden: true,
    }),
  },
  [`${A}/allowlist/{id}`]: {
    delete: op('delete-allowlist-entry', {
      tags: ['Allowlist'],
      summary: 'Remove an allowlist entry',
      params: [pathParam('id', 'Allowlist entry id')],
      success: apiData(okData(), 'Entry removed.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },

  // ---- Webhook secrets ----------------------------------------------------------
  [`${A}/webhook-secrets`]: {
    get: op('list-webhook-secrets', {
      tags: ['Webhooks'],
      summary: 'List webhook signing secrets (values are never returned)',
      success: apiData(arrOf('WebhookSecret'), 'Webhook secrets.'),
      auth: true,
    }),
    post: op('create-webhook-secret', {
      tags: ['Webhooks'],
      summary: 'Store a webhook signing secret',
      body: jsonBody({ name: str, value: str }, ['name', 'value']),
      successCode: '201',
      success: apiData({ type: 'object', properties: { id: str, name: str } }, 'The stored secret reference (value never echoed).'),
      auth: true,
      validation: true,
      forbidden: true,
      conflict: true,
    }),
  },
  [`${A}/webhook-secrets/{id}`]: {
    delete: op('delete-webhook-secret', {
      tags: ['Webhooks'],
      summary: 'Delete a webhook secret',
      params: [pathParam('id', 'Webhook secret id')],
      success: apiData(okData(), 'Secret deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },

  // ---- OIDC providers -------------------------------------------------------------
  [`${A}/oidc/providers`]: {
    get: op('list-oidc-providers', {
      tags: ['OIDC'],
      summary: 'List workspace OIDC providers',
      success: apiData(arrOf('OidcProvider'), 'Configured providers (client secrets never returned).'),
      auth: true,
    }),
    post: op('create-oidc-provider', {
      tags: ['OIDC'],
      summary: 'Register an OIDC provider (owner only)',
      body: jsonBody({ name: str, issuer_url: str, client_id: str, client_secret: str }, ['name', 'issuer_url', 'client_id', 'client_secret']),
      successCode: '201',
      success: apiData(
        { type: 'object', properties: { id: str, name: str, issuer_url: str, client_id: str } },
        'The registered provider (client_secret never echoed).'
      ),
      auth: true,
      validation: true,
      forbidden: true,
      conflict: true,
    }),
  },
  [`${A}/oidc/providers/{id}`]: {
    delete: op('delete-oidc-provider', {
      tags: ['OIDC'],
      summary: 'Delete an OIDC provider (owner only)',
      params: [pathParam('id', 'Provider id')],
      success: apiData(okData(), 'Provider deleted.'),
      auth: true,
      forbidden: true,
      notFound: true,
    }),
  },

  // ---- API tokens ---------------------------------------------------------------------
  [`${A}/api-tokens`]: {
    get: op('list-api-tokens', {
      tags: ['API Tokens'],
      summary: 'List API tokens for the session workspace',
      success: apiData(arrOf('ApiToken'), 'API tokens (token value shown only at creation).'),
      auth: true,
    }),
    post: op('create-api-token', {
      tags: ['API Tokens'],
      summary: 'Mint an API token (ff_ prefix; Bearer-authenticates CLI callers)',
      body: jsonBody({ name: str }, ['name']),
      successCode: '201',
      success: apiData({ type: 'object', properties: { id: str, name: str, token: str } }, 'The raw token, returned once and never stored.'),
      auth: true,
      validation: true,
    }),
  },
  [`${A}/api-tokens/{id}`]: {
    delete: op('revoke-api-token', {
      tags: ['API Tokens'],
      summary: 'Revoke an API token (immediate)',
      params: [pathParam('id', 'API token id')],
      success: apiData(okData(), 'Token revoked.'),
      auth: true,
      notFound: true,
    }),
  },

  // ---- Templates ---------------------------------------------------------------------------
  [`${A}/templates`]: {
    get: op('list-templates', {
      tags: ['Templates'],
      summary: 'List the five gallery workflow templates',
      success: apiData(arrOf('Template'), 'The template gallery (Invoice Chaser, Client Onboarding, Order Follow-Up, Review Request, Renewal Reminder).'),
      auth: true,
    }),
  },

  // ---- Notifications ---------------------------------------------------------------------------
  [`${A}/notifications`]: {
    get: op('list-notifications', {
      tags: ['Notifications'],
      summary: 'List in-app notifications for the session user',
      success: apiData(arrOf('Notification'), 'Notifications, newest first.'),
      auth: true,
    }),
  },
  [`${A}/notifications/{id}/read`]: {
    post: op('mark-notification-read', {
      tags: ['Notifications'],
      summary: 'Mark a notification as read',
      params: [pathParam('id', 'Notification id')],
      success: apiData(okData(), 'Notification marked read.'),
      auth: true,
      notFound: true,
    }),
  },

  // ---- Dashboard + manifest ------------------------------------------------------------------------
  [`${A}/dashboard`]: {
    get: op('get-dashboard', {
      tags: ['Dashboard'],
      summary: 'Aggregated dashboard data for the session workspace',
      success: apiData(
        {
          type: 'object',
          properties: {
            workflow_count: int,
            run_count: int,
            pending_approval_count: int,
            unread_notification_count: int,
            recent_runs: arrOf('Run'),
            recent_workflows: arrOf('Workflow'),
          },
        },
        'Counts plus recent activity panels.'
      ),
      auth: true,
    }),
  },
  [`${A}/manifest`]: {
    get: op('get-instance-manifest', {
      tags: ['Instance'],
      summary: 'Public instance manifest (product, version, feature flags)',
      success: apiData(
        {
          type: 'object',
          properties: {
            product: str,
            version: str,
            api_base: str,
            features: { type: 'object', additionalProperties: true },
          },
        },
        'Instance identity and capability flags.'
      ),
    }),
  },

  // ---- Root: webhook ingress --------------------------------------------------------------------------
  '/hooks/{workspaceSlug}/{path}': {
    post: op('receive-webhook', {
      tags: ['Webhooks'],
      summary: 'Webhook ingress — verifies HMAC and enqueues a run for the matching trigger',
      description:
        'Non-API root route (no envelope). Signed payload: X-FlowForge-Timestamp + "\\n" + raw body. Triggers with auth_mode: none skip signature verification.',
      params: [
        pathParam('workspaceSlug', 'Workspace slug'),
        pathParam('path', 'Trigger webhook path'),
        { name: 'X-FlowForge-Signature', in: 'header', required: false, schema: str, description: 'HMAC-SHA256 hex of the signed payload, as sha256=<hex>.' },
        { name: 'X-FlowForge-Timestamp', in: 'header', required: false, schema: str, description: 'Unix seconds; rejected when outside the tolerance window.' },
        { name: 'X-Idempotency-Key', in: 'header', required: false, schema: str, description: 'Dedupes repeated deliveries (10-minute replay window).' },
      ],
      body: rawJsonBody('The raw webhook payload (any JSON object).'),
      successCode: '202',
      success: jsonRes(
        { type: 'object', properties: { run_id: str, status: str }, additionalProperties: true, description: 'Async acceptance (run_id). sync: true triggers may instead return the reply step status/headers/body.' },
        'Webhook accepted; run queued.'
      ),
      rootErrors: true,
      validation: true,
      notFound: true,
      extraErrors: {
        '401': rootErr('Signature or timestamp verification failed (signature_invalid / timestamp_missing / timestamp_out_of_tolerance)'),
        '409': rootErr('Duplicate delivery inside the replay window (duplicate_webhook)'),
      },
    }),
  },

  // ---- Root: health -------------------------------------------------------------------------------------
  '/healthz': {
    get: op('liveness', {
      tags: ['System'],
      summary: 'Liveness probe (200 while the process is serving)',
      success: jsonRes(S('HealthStatus'), 'Liveness status.'),
    }),
  },
  '/health': {
    get: op('liveness-alias', {
      tags: ['System'],
      summary: 'Alias of /healthz',
      success: jsonRes(S('HealthStatus'), 'Liveness status.'),
    }),
  },
  '/readyz': {
    get: op('readiness', {
      tags: ['System'],
      summary: 'Readiness probe (200 only when Postgres + Redis + migrations are ready)',
      success: jsonRes(S('ReadyStatus'), 'All readiness checks pass.'),
      extraErrors: {
        '503': jsonRes(
          { type: 'object', properties: { status: str, checks: { type: 'object', additionalProperties: true }, timestamp: str } },
          'Not ready — checks report the failing subsystem (postgres / redis / migrations).'
        ),
      },
    }),
  },

  // ---- Root: demo -----------------------------------------------------------------------------------------
  '/demo/invoices': {
    get: op('demo-invoices', {
      tags: ['Demo'],
      summary: 'Synthetic invoice dataset for the demo workflows',
      description: demoNote,
      query: [
        queryParam('status', "Filter: 'open' | 'overdue' | 'paid'"),
        queryParam('include_escalations', "Set to '1' to include the single 45-days-overdue escalation invoice"),
      ],
      success: jsonRes(
        { type: 'object', properties: { invoices: { type: 'array', items: rawObj('Invoice row: number, client_name, client_email, amount, currency, issued_at, due_at, days_overdue, status.') } } },
        'The demo invoices (max 28 days overdue unless include_escalations=1).'
      ),
    }),
  },
  '/demo/orders': {
    get: op('demo-orders', {
      tags: ['Demo'],
      summary: 'Synthetic order dataset for the demo workflows',
      description: demoNote,
      query: [queryParam('status', "Filter: 'new' | 'in_progress' | 'stalled' | 'delivered' ('stuck' accepted as an alias of 'stalled')")],
      success: jsonRes(
        { type: 'object', properties: { orders: { type: 'array', items: rawObj('Order row: number, client_name, client_email, placed_at, status, stalled_hours.') } } },
        'The demo orders.'
      ),
    }),
  },
  '/demo/clients': {
    get: op('demo-clients', {
      tags: ['Demo'],
      summary: 'Synthetic client dataset for the demo workflows',
      description: demoNote,
      success: jsonRes(
        { type: 'object', properties: { clients: { type: 'array', items: rawObj('Client row: id, name, email, since, last_project, last_project_closed_at.') } } },
        'The demo clients.'
      ),
    }),
  },
  '/demo/credentials': {
    get: op('demo-credentials', {
      tags: ['Demo'],
      summary: 'The configured demo account credentials, verbatim',
      description:
        'Exists only with demo seeding enabled (`FF_SEED_DEMO=true`). Returns the FF_DEMO_EMAIL / FF_DEMO_PASSWORD pair exactly as configured so the login page can display them and a human can sign in immediately. Never enable demo seeding in production or internet-exposed environments.',
      success: jsonRes(S('DemoCredentials'), 'The configured demo credentials.'),
      extraErrors: { '404': rootErr('Demo seeding disabled (not_found) — JSON, never the SPA fallback HTML.') },
    }),
  },

  // ---- Root: this document ----------------------------------------------------------------------------------
  '/openapi.json': {
    get: op('get-openapi-document', {
      tags: ['System'],
      summary: 'This OpenAPI 3.1 document (no auth, no envelope, Cache-Control: no-cache)',
      success: jsonRes(
        rawObj('The OpenAPI 3.1.0 document for this server.'),
        'The OpenAPI document.'
      ),
    }),
  },

  // ---- Root: mock OIDC provider -----------------------------------------------------------------------------
  '/mock-idp/.well-known/openid-configuration': {
    get: op('mock-idp-configuration', {
      tags: ['Mock IdP'],
      summary: 'OIDC discovery metadata for the built-in mock provider',
      description: mockIdpNote,
      success: jsonRes(rawObj('OIDC discovery document (issuer, endpoints, supported response types and algorithms).'), 'Discovery metadata.'),
    }),
  },
  '/mock-idp/authorize': {
    get: op('mock-idp-authorize-form', {
      tags: ['Mock IdP'],
      summary: 'Authorization endpoint — renders the mock login form',
      description: mockIdpNote,
      query: [
        queryParam('client_id', 'Client id'),
        queryParam('redirect_uri', 'Registered redirect URI'),
        queryParam('state', 'Opaque state echoed back'),
        queryParam('nonce', 'OIDC nonce'),
        queryParam('scope', 'Requested scope'),
      ],
      success: { description: 'HTML login form (or a redirect when the session is already authorized).', content: { 'text/html': { schema: { type: 'string' } } } },
    }),
    post: op('mock-idp-authorize-submit', {
      tags: ['Mock IdP'],
      summary: 'Authorization submit — issues a one-time code and redirects',
      description: mockIdpNote,
      successCode: '302',
      success: redirectRes('Redirect to redirect_uri with the authorization code.'),
    }),
  },
  '/mock-idp/token': {
    post: op('mock-idp-token', {
      tags: ['Mock IdP'],
      summary: 'Token endpoint — exchanges the authorization code for tokens',
      description: mockIdpNote,
      body: {
        required: true,
        description: 'OAuth2 authorization_code exchange (form-encoded: grant_type, code, redirect_uri, client_id).',
        content: {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', properties: { grant_type: str, code: str, redirect_uri: str, client_id: str }, additionalProperties: true },
          },
        },
      },
      success: jsonRes(rawObj('Token response: access_token, id_token (HS256), token_type, expires_in.'), 'Access token and HS256-signed id_token.'),
      rootErrors: true,
      validation: true,
    }),
  },
  '/mock-idp/userinfo': {
    get: op('mock-idp-userinfo', {
      tags: ['Mock IdP'],
      summary: 'UserInfo endpoint for mock access tokens',
      description: mockIdpNote,
      success: jsonRes(rawObj('OIDC claims (sub, email, name).'), 'The claims for the Bearer access token.'),
      extraErrors: { '401': rootErr('Missing or invalid Bearer token') },
    }),
  },
  '/mock-idp/logout': {
    get: op('mock-idp-logout', {
      tags: ['Mock IdP'],
      summary: 'End-session endpoint for the mock provider',
      description: mockIdpNote,
      successCode: '302',
      success: redirectRes('Redirect back to the application.'),
    }),
  },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'FlowForge Open API',
    version: '1.0.0',
    description:
      'Open-source workflow automation for freelancers and micro-agencies: YAML manifests, schedules and webhooks, manual approvals, and metered runs. API routes under /api/v1 use the { data, error } envelope; root routes (/healthz, /readyz, /demo/*, /hooks/*, /mock-idp/*, /openapi.json) do not. Authentication is an opaque server-side session (ff_session cookie) or a Bearer API token (ff_ prefix); the workspace is resolved from the session.',
    license: { name: 'Apache-2.0' },
  },
  servers: [{ url: '/' }],
  paths,
  components: {
    schemas,
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'ff_session' },
      bearerToken: { type: 'http', scheme: 'bearer' },
    },
  },
} as const;
