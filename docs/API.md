# FlowForge Open — API & CLI Reference

Every public interface the project exposes: the HTTP API, the `forge` CLI, and the workflow manifest format. All paths, parameters, and examples here are grounded in `apps/server/src/routes/` and `apps/cli/src/index.ts`.

---

## HTTP API

### Base URL

```
http://localhost:8080
```

All API routes are mounted under **both** `/api` and `/api/v1` (see `apps/server/src/index.ts:84-88`). The examples below use `/api/v1`. Non-API routes live at root: `/healthz`, `/readyz`, `/health`, `/hooks/*`, `/mock-idp/*`, `/demo/*`, `/openapi.json`, and the public instance-info endpoint `/api/v1/manifest`.

### Response envelope

Every API route returns `{ data: ... }` on success or `{ error: { code, message, details? } }` on failure. The exceptions are `204 No Content` (logout, some deletes) and the SSE event stream (`GET /runs/:id/events`).

### Authentication model

Two paths, both enforced in `apps/server/src/middleware/auth.ts`:

| Path | Header / cookie | Use case |
|---|---|---|
| **Session cookie** | `Cookie: ff_session=<token>` + `X-CSRF-Token: <token>` on state-changing methods | SPA (browser) |
| **Bearer API token** | `Authorization: Bearer <token>` | CLI, integrations |

- The session cookie is `httpOnly`, `sameSite=strict`, `secure` in production. The CSRF token is `HMAC-SHA256(FF_SESSION_SECRET, session_token)[:32]` — deterministic, returned in login/register/select-workspace responses and via `GET /auth/csrf`. It must ride every `POST`/`PUT`/`PATCH`/`DELETE` as `X-CSRF-Token`.
- API tokens are SHA-256 hashed at rest; the bearer token is looked up by hash. Tokens are workspace-scoped and carry a `role_snapshot` frozen at creation time (§8.4): each authenticated request resolves the role from the snapshot, so later membership/role changes never affect tokens already issued — revoke a token to remove its access.
- **Pre-workspace plane:** after login, before workspace selection, the session has `workspace_id = NULL`. Only `/auth/me`, `/auth/select-workspace`, `/workspaces` (GET/POST), and `/auth/logout` are reachable. Every other route returns `403 workspace_not_selected`.

### Plan entitlements (gate run features)

Feature flags and limits are defined in `packages/shared/src/plans.ts`. **Server-enforced:** the `credential_vault`, `audit_log`, and `manual_approval` flags are checked by the `requireFeature` middleware (`apps/server/src/middleware/auth.ts`) on the credentials, audit, and approvals routes, and the vault/manual-approval flags are also checked inside the step executors (`apps/server/src/services/run-executor.ts`) — an `http` step that references `secrets.*` or a `credential` on a plan without `credential_vault`, or a `manual_approval` step on a plan without the flag, fails with `plan_feature_required`. Entitlement checks are cached in Redis for 5 minutes and **fail closed** (§3.3): when Redis is unreachable, gated features are denied with `403 plan_feature_required` rather than running without authorization. Run limits (`run_limit`, `concurrency_limit`) are checked in the manual trigger (`runs.ts`) and the scheduler; OIDC provider management is hard-gated to the Studio plan (`oidc.ts:76-83`). The SPA renders those pages on every plan — the server is the enforcement boundary. The table below reflects the plan definitions as seeded by `seed.js plans`:

| Plan | Runs/mo | Concurrency | Seats | Credential vault | Audit log | Manual approval | API tokens |
|---|---|---|---|---|---|---|---|
| Community | unlimited | unlimited | 1 | ✓ | ✗ | ✓ | ✓ |
| Free | 500 (hard cap) | 1 | 1 | ✗ | ✗ | ✗ | ✓ |
| Pro | 10,000 | 5 | 5 | ✓ | ✓ | ✓ | ✓ |
| Studio | 50,000 | 20 | unlimited | ✓ | ✓ | ✓ | ✓ |
| Demo | unlimited | 5 | 1 | ✓ | ✓ | ✓ | ✓ |

Roles (`packages/shared/src/rbac.ts`): **owner** (all permissions), **admin** (no role-changes, no workspace-delete), **member** (run + approve + own tokens), **viewer** (read-only).

---

## Endpoints

### Health (root, no auth)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness — DB ping. Always `200`; returns `{"status":"ok","timestamp":...}` when the DB answers, `{"status":"degraded","timestamp":...}` when it does not. |
| `GET` | `/readyz` | Readiness — DB + migrations + Redis. Returns `200 {"status":"ok","checks":{"postgres":true,"migrations":true,"redis":true},...}` or `503 {"status":"not_ready","checks":{...}}` with the failing checks flagged `false`. |
| `GET` | `/health` | Alias of `/healthz` (used by the packaging/e2e harness). |

```bash
curl http://localhost:8080/healthz
# {"status":"ok","timestamp":"2026-09-20T02:45:00.000Z"}
```

### Auth (`/auth/*`)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/auth/register` | `{ email, password, name, workspace_name? }` | `201 { id, email, name, user, workspaces, csrf_token }` + cookie. Also creates the user's first workspace (Free plan) and a pre-workspace session. |
| `POST` | `/auth/login` | `{ email, password }` | `200 { id, email, name, user, workspaces, csrf_token }` + cookie |
| `POST` | `/auth/select-workspace` | `{ workspace_slug }` | `200 { workspace, role, csrf_token }` + scoped cookie |
| `POST` | `/auth/logout` | — | `204` (cookie cleared) |
| `GET` | `/auth/me` | — | `200 { id, email, name, workspaces, workspace?, role?, csrf_token }` |
| `POST` | `/auth/change-password` | `{ current_password, new_password }` | `204` (all sessions and API tokens revoked) |
| `POST` | `/auth/invite/accept` | `{ token }` | `200 { workspace, membership, csrf_token }` + cookie |
| `GET` | `/auth/csrf` | — | `200 { csrf_token }` |

**Errors:** `401 invalid_credentials` (bad email/password), `401 unauthorized` (missing/expired session or bad API token), `423 account_locked` (5 failed attempts / 15 min), `404 workspace_not_found`, `403 workspace_not_selected`.

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@acme.test","password":"demo-pass-2026"}'
# Set-Cookie: ff_session=...; HttpOnly; SameSite=Strict
# {"data":{"id":"...","email":"demo@acme.test","csrf_token":"...","workspaces":[...]}}
```

### Workspaces (`/workspaces`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/workspaces` | session | List the caller's workspaces (picker) |
| `POST` | `/workspaces` | session | Create a workspace (Free plan + subscription atomically); scopes the session |
| `GET` | `/workspaces/:slug` | auth | Get workspace + plan info |
| `DELETE` | `/workspaces/:slug` | owner | Soft-delete a workspace (disables workflows, revokes sessions) |

`POST /workspaces` body: `{ name, slug? }`. The slug is auto-derived from the name if omitted; collisions auto-suffixed (`-2`, `-3`, …).

### Workflows (`/workflows`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/workflows` | List enabled workflows (`?include_disabled=true` to see all) |
| `POST` | `/workflows` | Create from a manifest (body: `{ name, summary?, slug?, manifest }`) |
| `GET` | `/workflows/:id` | Get one workflow |
| `PUT` | `/workflows/:id` | Update (body: `{ name?, summary?, slug?, is_enabled?, manifest? }`). Setting `is_enabled: false` disables triggers; `true` re-enables them. |
| `DELETE` | `/workflows/:id` | Soft-delete (sets `is_enabled=false`; run history preserved) |
| `GET` | `/workflows/:id/manifest` | Export the current manifest as YAML (`{ data: { manifest_yaml } }`) |
| `POST` | `/workflows/:id/validate` | Validate a manifest body without saving |
| `POST` | `/workflows/validate` | Validate a manifest body standalone |
| `POST` | `/workflows/:id/versions` | Save a new version from a manifest body |
| `GET` | `/workflows/:id/versions` | List versions |
| `POST` | `/workflows/:id/promote/:versionId` | Promote a version to current |
| `POST` | `/workflows/from-template` | Create from a template (body: `{ template_id, name? }`) — `200 { data: { id, name, summary, version, version_id, template } }`; duplicate names (webhook-path collisions) return `409 webhook_path_conflict` |

The `manifest` field is always a **raw YAML string**; the server parses and validates it via `@flowforge/engine`.

### Triggers (`/workflows/:id/triggers`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/workflows/:id/triggers` | List a workflow's triggers |
| `POST` | `/workflows/:id/triggers` | Add a trigger (body: `{ type, config }`) |
| `PUT` | `/workflows/:id/triggers/:triggerId` | Update a trigger |
| `DELETE` | `/workflows/:id/triggers/:triggerId` | Remove a trigger |

Trigger `type` ∈ `schedule | webhook | event` (the triggers REST API only accepts `schedule` and `webhook`). The REST body is `{ type, config }` where `config` is a nested object (`config.cron` + `config.timezone` for schedule; `config.path`, `config.auth_mode`, etc. for webhook). **Inside the manifest YAML**, the same fields are **flat** (top-level on the trigger object) — see the manifest format section below.

### Runs and approvals (`/runs`, `/approvals`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/runs` | List runs (`?status=&workflow_id=&limit=&offset=`) |
| `GET` | `/runs/:id` | Get one run |
| `GET` | `/runs/:id/steps` | Step table with outputs |
| `GET` | `/runs/:id/events` | Run events — SSE stream when `Accept: text/event-stream`, otherwise the full history as JSON |
| `POST` | `/runs/:id/cancel` | Cancel a run |
| `POST` | `/workflows/:id/trigger` | Manual trigger (alias: `/workflows/:id/run`). Body `{ inputs? }` → `200 { data: { run_id, status: "queued" } }`; a duplicate inside the 10s bucket returns the existing run with `deduplicated: true`. |
| `GET` | `/approvals` | List pending approvals |
| `POST` | `/approvals/:id/approve` | Approve a pending approval — run `paused → queued`; `{ data: { status: "queued" } }` |
| `POST` | `/approvals/:id/reject` | Reject a pending approval — `{ data: { status: "queued" } }` (step `on_error: continue`) or `{ data: { status: "canceled" } }` (`abort`) |
| `POST` | `/approvals/:id/decide` | Decide (body: `{ decision: "approve"|"reject" }`) |
| `POST` | `/runs/:id/approve-all` | Approve all pending approvals in a run — `{ data: { approved_count } }` |

**Manual-trigger errors** (from `runs.ts` `manualTrigger`):
- `403 workflow_disabled` — workflow is disabled.
- `429 concurrency_limit_exceeded` — too many active runs for the plan.
- `429 run_limit_exceeded` — monthly run cap hit (Free plan: 500).
- 10-second bucket dedup on `(workflow_id, inputs)` — identical inputs within the same 10s bucket reuse the existing run.
- Approval decide/reject returns `409 approval_already_decided` when the task is not `pending` or the run is not `paused`.

### Credentials (`/credentials`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/credentials` | List credentials (`id`, `name`, `type`) — never values |
| `POST` | `/credentials` | Store a credential (body: `{ name, type, value }` — all required) — encrypted with `FF_VAULT_KEY` |
| `DELETE` | `/credentials/:id` | Remove a credential |

**Deletion guard (server-enforced):** deleting a credential that an enabled workflow's current manifest still references returns `409 credential_in_use` with the referencing workflow names — the reference is either an `http` step's `credential:` field or a `secrets.<name>` expression binding (`apps/server/src/routes/credentials.ts:28-50`).

> **Plan-gating:** the `credential_vault` feature flag is enforced on these routes by the `requireFeature` middleware — workspaces whose plan lacks the flag receive `403 plan_feature_required` (fail-closed when Redis is unreachable). The SPA still shows the Credentials page on every plan; the server is the enforcement boundary.

### Members and invitations (`/members`, `/invitations`, `/sessions`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/members` | List workspace members |
| `PATCH` | `/members/:userId/role` | Change a member's role (owner-only) |
| `DELETE` | `/members/:userId` | Remove a member |
| `POST` | `/invitations` | Invite a user (body: `{ email, role }`) |
| `GET` | `/invitations` | List pending invitations |
| `DELETE` | `/invitations/:id` | Cancel an invitation |
| `POST` | `/invitations/:id/resend` | Resend an invitation |
| `DELETE` | `/sessions` | Revoke all sessions in the workspace (admin+) |
| `DELETE` | `/sessions/:userId` | Revoke a user's sessions (admin+) |

### Audit (`/audit`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/audit` | Chronological audit events (`?limit=&offset=`) |
| `GET` | `/audit/verify` | Verify the hash chain — returns `{ valid, broken_at, checked_count, truncated, anchor_sequence_num }` |

The audit routes require `requireAuth` (session or Bearer) **plus the `audit_log` plan feature flag** (`requireFeature('audit_log')` — denied with `plan_feature_required` otherwise). After the nightly `retention_purge` job shortens the chain, verify reports `truncated: true` with `anchor_sequence_num` set to the oldest retained event; a truncated chain is verified from its anchor forward, not from the genesis hash.

### Other workspace-scoped resources

| Group | Endpoints |
|---|---|
| **Dashboard** | `GET /dashboard` — run stats, active workflows, pending approvals |
| **Templates** | `GET /templates` — the five freelancer workflow manifests |
| **Notifications** | `GET /notifications`, `POST /notifications/:id/read` |
| **Webhook secrets** | `GET /webhook-secrets`, `POST /webhook-secrets`, `DELETE /webhook-secrets/:id` |
| **IP allowlist** | `GET /allowlist`, `POST /allowlist`, `DELETE /allowlist/:id` |
| **API tokens** | `GET /api-tokens`, `POST /api-tokens`, `DELETE /api-tokens/:id` |
| **Usage** | `GET /usage` — metered run count this period |
| **Subscription** | `GET /subscription`, `POST /subscription` — plan + upgrade (manage-subscription permission) |
| **Invoices** | `GET /invoices` — billing history (manage-subscription permission) |
| **OIDC providers** | `GET /oidc/providers`, `POST /oidc/providers` (body `{ name, issuer_url, client_id, client_secret }`), `DELETE /oidc/providers/:id` — **server-enforced Studio-only** (`oidc.ts:76-83` rejects non-Studio with `plan_feature_required`) |

### Webhook ingress (root, no standard auth)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/hooks/:workspaceSlug/:path` | Webhook entry point. Auth depends on the trigger's `auth_mode`: `hmac` (signature), `header` (shared secret header), or `none`. |

Authentication and response semantics (`apps/server/src/routes/webhooks.ts`):

- **`hmac`** — the sender signs `X-FlowForge-Timestamp + "\n" + <raw_body_bytes>` and sends `X-FlowForge-Signature: sha256=<hex>`. The timestamp (Unix seconds) is required (`401 timestamp_missing`) and must be within ±300s of server time (`401 timestamp_out_of_tolerance`); wrong signatures get `401 invalid_signature`.
- **`header`** — constant-time comparison of the request header named by the trigger's `auth_header` against the stored secret.
- **Replay protection** — an identical payload within 10 minutes answers `409 duplicate_webhook`.
- **Response is async-first:** default `sync: false` answers `202 { data: { run_id, status: "queued" } }` immediately. With the manifest's `sync: true`, the server executes inline and returns the `reply` step's status/headers/body, or falls back to `202 { data: { run_id, status } }` when the run terminates first.

```bash
TIMESTAMP=$(date +%s)
SIG=$(printf '%s\n%s' "$TIMESTAMP" '{"client_id":"cli-001"}' | openssl dgst -sha256 -hmac '<webhook-secret>' -hex | awk '{print $2}')
curl -i -X POST "http://localhost:8080/hooks/acme-creative/client-onboarding" \
  -H 'Content-Type: application/json' \
  -H "X-FlowForge-Timestamp: $TIMESTAMP" \
  -H "X-FlowForge-Signature: sha256=$SIG" \
  -d '{"client_id":"cli-001"}'
# HTTP/1.1 202 Accepted
# {"data":{"run_id":"...","status":"queued"}}
```

### Demo services (root + `/api` + `/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/demo/invoices` | Demo overdue invoices (`?status=overdue`) |
| `GET` | `/demo/orders` | Demo orders |
| `GET` | `/demo/clients` | Demo clients |
| `GET` | `/demo/credentials` | The configured demo credentials `{ email, password }` verbatim (no auth, no envelope, `Cache-Control: no-store`). Demo-gated: 404 JSON `{ "error": "not_found" }` when demo seeding is disabled. |

These back the five templates and the CLI's `--demo` local runner. They return deterministic JSON the `http` step can consume.

### OpenAPI document (root)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/openapi.json` | The OpenAPI 3.1.0 document for this server — every route, operation, and schema. No auth, no envelope, `Cache-Control: no-cache`. Served whenever the app is listening (static compiled constant, no DB dependency). |

### OIDC SSO (pre-workspace)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/auth/oidc/:provider/login` | Redirect to the IdP authorize endpoint |
| `GET` | `/auth/oidc/:provider/callback` | Token exchange + id_token verify + pre-workspace session |
| `GET` | `/auth/oidc/:provider/logout` | End SSO session |

State is stored in Redis (600s TTL, one-time use). A built-in mock IdP lives at `/mock-idp/*` for local testing.

### Public instance info

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/manifest` / `/api/v1/manifest` | Public instance info (no auth): `{ data: { product, version, api_base, features } }` |

---

## `forge` CLI

Entry point: `apps/cli/dist/index.js` (run via `node apps/cli/dist/index.js ...` or the `flowforge` binary after a global link).

### `forge validate <file>`

Validate a manifest YAML file against the engine schema. No server required.

```bash
node apps/cli/dist/index.js validate workflows/invoice-chaser.ff.yaml
# ✓ Valid manifest
#   Name: invoice-chaser
#   Steps: 3  Triggers: 1  Inputs: 1
```

### `forge init [name]`

Create a starter manifest. Writes `<slug>.ff.yaml` (override with `-o, --output <file>`).

```bash
node apps/cli/dist/index.js init my-workflow
# ✓ Created my-workflow.ff.yaml
```

### `forge run <file> [options]`

Execute a manifest locally with the in-memory engine. No database or Redis needed.

| Flag | Purpose |
|---|---|
| `-i, --input <key=value>` | Input parameter (repeatable). Values parsed as JSON if valid, else string. |
| `--demo` | Start an in-process demo HTTP server so `{{ env.FF_APP_URL }}` resolves to `/demo/*` services. |
| `--dry-run` | Skip `manual_approval` steps (marked `skipped`) instead of prompting. |

```bash
node apps/cli/dist/index.js run workflows/invoice-chaser.ff.yaml --demo
```

### `forge login <url>`

Authenticate with a FlowForge server (default URL when omitted: `http://localhost:3000`). Prompts for email + password, then: (1) `POST /auth/login` → pre-workspace session + CSRF token, (2) `POST /auth/select-workspace` for the first workspace, (3) `POST /api-tokens` to mint an API token — and saves `{ url, workspace_slug, token }` to `~/.flowforge/credentials.json` (config dir overridable via `FLOWFORGE_CONFIG_DIR`).

```bash
node apps/cli/dist/index.js login http://localhost:8080
# ✓ Logged in as Demo User
#   Workspace: acme-creative
#   Credentials saved to ~/.flowforge/credentials.json
```

### `forge push [options]`

Push local `.ff.yaml` files to the hosted server. Creates or versions each workflow.

| Flag | Purpose |
|---|---|
| `--workspace <slug>` | Target workspace (defaults to the saved one) |

### `forge pull [options]`

Pull workspace workflows from the hosted server to local `.ff.yaml` files.

| Flag | Purpose |
|---|---|
| `--workspace <slug>` | Source workspace (defaults to the saved one) |

### `forge runs list`

List recent runs on the hosted server (requires `forge login` first).

### `forge logs <runId>`

Show the step-by-step output of a hosted run.

### `forge export <workflowId>`

Export a hosted workflow's manifest as YAML to stdout.

```bash
node apps/cli/dist/index.js export <workflow-id> > exported.ff.yaml
```

### CLI credential storage

`~/.flowforge/credentials.json` holds `{ url, workspace_slug, token }` (mode 0600). The `token` is an **API token** minted by `POST /api-tokens` during `forge login` — not a session cookie. Directory overridable via `FLOWFORGE_CONFIG_DIR`.

---

## Workflow manifest format

Schema source: `packages/engine/src/manifest-schema.ts`. Validated by `parseManifest` / `validateManifest`.

### Top-level

```yaml
api_version: flowforge/v1
name: <slug>              # required, ^[a-z][a-z0-9-]{2,63}$
summary: <string>         # optional, max 200 chars
allow_concurrent: <bool>  # optional, default false (enables the per-workflow run lock)
inputs:                   # optional list
  - name: <string>
    type: string | integer | boolean
    required: boolean     # default false
    default: <value>
    validation:           # optional
      min: <number>
      max: <number>
      pattern: <regex>
triggers:                 # REQUIRED (1–3 entries)
  - type: schedule | webhook | event
    # schedule: `cron` (required) + `timezone` (required) — both top-level
    # webhook: `path` (defaults to slug), `auth_mode` (hmac|header|none),
    #          `require_signature`, `secret`, `auth_header`, `auth_secret`,
    #          `sync`, `input_mapping` — all top-level
    # event: rejected by the validator (event_trigger_not_supported_in_v1)
defaults:                 # optional
  retry: { attempts, backoff, base_ms, max_ms, jitter }
  timeout_seconds: <int>  # default 60
steps:                    # required (1–50), ordered list
  - id: <string>
    type: <step-type>
    with: <config>
    if: <bare expression>    # optional
    retry:                   # optional
      attempts: <int>        # default 3, max 10
      backoff: fixed | exponential
      base_ms: <int>         # default 500
      max_ms: <int>          # default 30000
      jitter: <bool>         # default true
    timeout_seconds: <int>   # optional
    on_error: abort | continue  # default abort
```

### Step types (`packages/engine/src/manifest-schema.ts`)

| Type | Key config fields (`with:`) |
|---|---|
| `http` | `method` (GET/POST/PUT/PATCH/DELETE/HEAD), `url`, `headers`, `body`, `idempotency_key` |
| `notify` | `channel` (email / inbox), `to`, `subject`, `body` |
| `condition` | `when` (bare expression, no `{{ }}`), `then` (steps), `else` (steps) |
| `delay` | `duration` (string like `"30s"`, `"5m"`, `"1h"`) |
| `transform` | `set` (record of key → interpolation string) |
| `for_each` | `over` (bare expression resolving to a list, no `{{ }}`), `limit` (default 100), children at **step-level `steps:`** (run per item; `{{ loop.item }}`, `{{ loop.index }}`) |
| `log` | `level` (info / warn / error), `message` |
| `reply` | `body` (string), `status` (required number 200–599), `headers` (object) |
| `manual_approval` | `prompt`, `timeout_seconds` (default 86400), `on_timeout` (skip / abort, default skip) |

`parallel` also exists in the schema enum, but the validator rejects it in v1 (`parallel_not_supported_in_v1`).

### Expression language (`packages/engine/src/expression-evaluator.ts`)

Two usage modes:

1. **String interpolation** — `{{ ... }}` inside any string field (URLs, subjects, bodies, messages). The expression inside the braces is evaluated and the result is inserted into the string.

2. **Bare expressions** — used directly (no `{{ }}` wrapper) in fields that expect a single value: `for_each.over`, `condition.when`, and step-level `if`. Example: `over: "steps.fetch_overdue.output.body.invoices"` or `when: "loop.item.days_overdue > inputs.escalation_threshold"`.

| Reference | Resolves to |
|---|---|
| `{{ inputs.foo }}` | A declared input value |
| `{{ trigger.payload }}` | The webhook trigger payload |
| `{{ steps.x.output.field }}` | A prior step's output |
| `{{ env.FF_APP_URL }}` | Server environment (`FF_APP_URL`) |
| `{{ loop.item }}` | Current item inside `for_each` |
| `{{ loop.index }}` | Zero-based loop index |

Array indexing uses bracket notation: `steps.x.output.body.items[0].name`. Dot notation with a number (`items.0.name`) is not valid.

Conditions use `isTruthy()` — non-empty strings, non-zero numbers, `true`, non-empty lists, and **any object (including `{}`)** are truthy; `null`, `undefined`, `false`, `0`, and `""` are falsy. Comparison operators (`>`, `<`, `>=`, `<=`, `==`, `!=`) and boolean operators (`and`, `or`, `not`) are supported in bare expressions.

Built-in functions (sandboxed whitelist, no arbitrary JS): `len`, `lower`, `upper`, `trim`, `join(list, sep)`, `split(str, sep)`, `contains(x, y)`, `starts_with(s, prefix)`, `ends_with(s, suffix)`, `default(x, fallback)`, `coalesce(a, b)`, `round(n)`, `abs(n)`, `now()`, `format_date(iso, fmt, tz?)`, `date_add(iso, amount, unit)`, `date_diff(iso_a, iso_b, unit)`, `filter(list, expr)`, `map(list, expr)`.

### Canonical example (`workflows/invoice-chaser.ff.yaml`)

```yaml
api_version: flowforge/v1
name: invoice-chaser
summary: Weekday sweep for invoices 14+ days overdue, escalate >30 days
allow_concurrent: false
inputs:
  - name: escalation_threshold
    type: integer
    default: 30
triggers:
  - type: schedule
    cron: "30 9 * * 1-5"
    timezone: UTC
defaults:
  retry: { attempts: 3, backoff: exponential, base_ms: 500, max_ms: 30000, jitter: true }
  timeout_seconds: 60
steps:
  - id: fetch_overdue
    type: http
    timeout_seconds: 15
    with:
      method: GET
      url: "{{ env.FF_APP_URL }}/api/v1/demo/invoices?status=overdue"
    on_error: abort

  - id: per_invoice
    type: for_each
    with:
      over: "steps.fetch_overdue.output.body.invoices"
      limit: 100
    steps:
      - id: send_reminder
        type: notify
        with:
          channel: email
          to: "{{ loop.item.client_email }}"
          subject: "Invoice {{ loop.item.number }} — {{ loop.item.days_overdue }} days overdue"
          body: "Hi {{ loop.item.client_name }}, a friendly nudge that invoice {{ loop.item.number }} is now {{ loop.item.days_overdue }} days overdue."

      - id: check_escalation
        type: condition
        with:
          when: "loop.item.days_overdue > inputs.escalation_threshold"
          then:
            - id: request_approval
              type: manual_approval
              with:
                prompt: "Approve escalation email for invoice {{ loop.item.number }} ({{ loop.item.days_overdue }} days overdue)?"
                timeout_seconds: 86400
                on_timeout: skip
            - id: send_escalation_email
              type: notify
              if: "steps.request_approval.output.decision == 'approved'"
              with:
                channel: email
                to: "{{ loop.item.client_email }}"
                subject: "URGENT: Invoice {{ loop.item.number }} — {{ loop.item.days_overdue }} days overdue"
                body: "Hi {{ loop.item.client_name }}, this is an urgent reminder that invoice {{ loop.item.number }} is now {{ loop.item.days_overdue }} days overdue. Please contact us immediately."

  - id: log_completion
    type: log
    with:
      level: info
      message: "Pursued {{ len(steps.per_invoice.output.results) }} invoices"
```

Note: `when`, `if`, and `for_each.over` are expression fields — bare expressions without `{{ }}` wrapping. `url`, `to`, `subject`, `body`, and `prompt` are interpolation fields — `{{ }}` delimiters within literal text.

---

## Error codes

From `packages/shared/src/errors.ts` and route handlers. Common ones: `unauthorized`, `forbidden`, `csrf_token_invalid`, `workspace_not_selected`, `workspace_not_found`, `account_locked`, `validation_error`, `conflict`, `not_found`, `workflow_disabled`, `run_limit_exceeded`, `concurrency_limit_exceeded`, `webhook_path_conflict`, `invalid_state`, `invalid_signature`, `internal_error`.
