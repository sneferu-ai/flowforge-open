# FlowForge Open — Product Specification

**Artifact type:** `browser_ui` (full-stack web application with `local_api` server and `cli_tool`)

**Primary deliverable:** a working, demoable, visually polished automation product with an open-source core and hosted cloud, proven end-to-end inside this environment against built-in demo services.

---

## 1. Product summary

FlowForge Open is an open-source workflow automation product for freelancers and micro-agencies. The free, self-hostable core converts repeatable client operations — chasing unpaid invoices, onboarding new clients, following up on orders, requesting reviews, reminding about contract renewals — into versioned YAML workflow manifests that an engine executes on schedule, webhook, or manual trigger.

Revenue comes from a hosted cloud: a managed workspace where manifests are stored, scheduled, and executed, with shared team spaces, OIDC single sign-on, an append-only audit trail, a sealed credential vault, per-workspace egress allowlists, and metered per-run billing. Because the engine and manifest format are Apache-2.0 and manifests export with one click, leaving is cheap — which is exactly why paying feels safe.

### 1.1 Naming and licensing honesty

The product is named "FlowForge Open" and is positioned as **open-source software with a hosted cloud service**, not "open-core." All packages and apps are Apache-2.0 (§2.1). There is no proprietary component. The revenue model — managed infrastructure, SSO, audit retention, and support — is the same revenue model as Ghost, Plausible, and n8n Cloud. The license terms differ: Ghost is MIT, Plausible is AGPL-3.0, n8n uses a Sustainable Use License. FlowForge's Apache-2.0 is a stronger openness guarantee than n8n's or Plausible's. The comparison to these products is scoped to revenue model only.

### 1.2 Competitive positioning

FlowForge Open enters a crowded category (n8n, Windmill, Activepieces, Zapier, Make, Temporal, Inngest). **The product does not claim technical novelty.** The differentiation is segment focus and opinionated templates, not feature superiority. The simplicity claim is scoped: templates are pre-filled and runnable without YAML authoring (the template gallery path). Users who want to author or modify manifests will encounter a YAML editor with a restricted expression language — this is developer-adjacent tooling, not no-code.

- **vs n8n:** n8n offers a visual builder, YAML import/export, code-first editing, self-hosting, and a hosted cloud. FlowForge is manifest-first with an opinionated template set for five freelancer workflows. n8n is more capable; FlowForge is more prescriptive for a specific buyer.
- **vs Activepieces:** Activepieces is MIT-licensed, self-hostable, has a code-first mode, and a visual builder. FlowForge's differentiation is the five opinionated templates and the freelancer-segment focus.
- **vs Windmill:** Windmill is a productized workflow tool with a visual UI, templates, and a hosted cloud. FlowForge does not claim a lower technical barrier than Windmill's visual builder. The comparison to Windmill is valid only against its code-first scripting path (Python/Go), not its visual builder.
- **vs Zapier / Make:** Closed SaaS with no self-hosting. FlowForge is open-source with a self-hostable engine.
- **vs Temporal / Inngest:** Developer infrastructure for durable execution. FlowForge is a productized workflow tool for non-infrastructure users.

**The combination is not novel.** Segment focus is the only claimed differentiator, and it is a market hypothesis, not a proven fact.

### 1.3 Post-v1 roadmap

Features deliberately excluded from v1:

1. **AI-assisted workflow generation** — conversational builder. Excluded: requires LLM inference unprovable in this environment.
2. **GitOps sync (`forge watch`)** — Git repo sync to hosted workspace. Excluded: hosted versioning provides immediate need. [TBD: requires external Git provider integration and webhook-based sync loop; design not finalized.]
3. **Template marketplace** — community-submitted template registry. Excluded: five seed templates are demo content.
4. **Provider abstraction (`IntegrationProvider`)** — community connectors with OAuth. Excluded: `http` step with allowlist and credential vault covers integration at a lower level.
5. **`parallel` step type** — DAG fan-out/fan-in. Schema reserves `type: "parallel"`; validator rejects with `parallel_not_supported_in_v1`. v2 plan: `parallel` with `branches` (step[][]) and `join: all|any|race`.
6. **Multi-owner approval notifications** — v1 sends to first owner only (§8.7).

**OBL-65:** The engine defines a `StepExecutor` interface in `packages/engine` (§5.5). In v1, the runtime only loads built-in executors. Third parties can implement the interface and embed the engine in their own application, but the hosted product does not load custom step types.

---

## 2. Committed positions

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| D1 | **TypeScript / Node 22** | Python backend; Go engine split | One zod schema shipped to CLI, API, and editor. **DIS-1: the Go+Node split was rejected on schema-drift grounds.** |
| D2 | **Flat manifest envelope** with `api_version: flowforge/v1` | K8s-style `kind`/`metadata`/`spec` | Exactly one resource kind exists. **DIS-2: moonshot position adopted.** |
| D3 | **Triggers are an array of 1–3 entries** | Singular trigger block | Real case: "Every weekday at 8am and when my form posts." |
| D4 | **Purpose-built restricted expression language** | CEL; JSONata; raw JS eval | Risk preference, not empirical fact. JSONata is the fallback. **DIS-4: custom parser retained; full grammar in §5.4.** |
| D5 | **No `db_query` step** | Direct SQL; `kv`/`state` step | Runtime-chosen DSNs are unprovable. **DIS-3: moonshot position adopted.** |
| D6 | **Manifest is single source of truth; flow diagram auto-generated (one-way)** | Two-way drag-and-drop graph builder | Bidirectional sync accumulates irreconcilable state. |
| D7 | **One billable unit per run reaching terminal state with at least one executed step** | Per-attempt metering; all-terminal billing | Charging for retries punishes customers for transient failures. Runs canceled from `queued` before any step executes are NOT billed. **DIS-5: moonshot position adopted.** |
| D8 | **PostgreSQL 16 only for hosted and self-hosted** | Dual SQLite/PostgreSQL | A second storage dialect doubles the migration and test matrix. CLI `forge run` uses in-memory adapter implementing `StorageAdapter` (JavaScript Maps). `delay` sleeps in-process (max 5 minutes locally). `manual_approval` prompts on stdin. Durable workflows require hosted server. **DIS-7: moonshot position adopted.** |
| D9 | **OIDC only for SSO**, gated at Studio plan | SAML in v1 | OIDC covers modern IdPs. Mock IdP uses HS256 with `FF_OIDC_SIGNING_KEY`. Real IdPs use RS256/ES256 — verification code included and tested with bundled RSA test keypair. |
| D10 | **DB-led scheduler** | BullMQ repeatable jobs as truth | Postgres unique constraint is the duplicate-proof guarantee. **DIS-8: moonshot position adopted.** |
| D11 | **Nine step types:** `http`, `notify`, `condition`, `delay`, `transform`, `for_each`, `log`, `reply`, `manual_approval` | Per-service steps; `function` step | **DIS-3: adopted with `manual_approval` (DIS-10).** |
| D12 | **Opaque server-side sessions** | JWTs | Revocable, no client-side token storage. **DIS-6: deepseek position adopted.** |
| D13 | **SSE for live run updates** | WebSocket | One-directional push; survives proxies. |
| D14 | **Apache-2.0 for the entire codebase** | MIT; split proprietary | **DIS-9: deepseek/nvidia position adopted.** |
| D15 | **Per-workspace DB-stored egress allowlist** with env-var bootstrap | Unrestricted outbound; env-var only | Makes hosted product functional for customer-chosen services. |
| D16 | **`manual_approval` step type** | Excluding manual approval | Target workflows include escalation gates. **DIS-10: adopted.** |
| D17 | **Webhook response is async-first** (202 by default; `sync: true` defers up to 30s) | Always-deferred | Real webhook senders expect 2xx within seconds. |
| D18 | **Expression fields vs interpolation fields** | Uniform evaluation | Expression fields need native types; interpolation fields need string insertion. |
| D19 | **Argon2id for password hashing** | bcrypt cost 12 | OWISP 2023+ recommendation. Memory cost 19456 KiB, time cost 2, parallelism 1. |
| D20 | **Scheduler tick interval: 10 seconds** | 60 seconds | 10s provides delay-resume granularity, webhook sync timeout headroom, and system job scheduling. |
| D21 | **`for_each` iterations are sequential** | Parallel iterations | Parallel execution is post-v1 `parallel` step. Sequential with `limit: 100`, 15s step timeout. |
| D22 | **`notify channel:email` step status reflects enqueue-only** | Final delivery status | Step succeeds when outbox row is written. Outbox delivery is asynchronous. |
| D23 | **Per-workflow Redis lock is opt-in via workflow-level `allow_concurrent`** | Always-on per-workflow lock | Manifest sets `allow_concurrent: false` (default, enables lock) or `true` (skips lock). Lock serializes same-workflow runs. |

### 2.1 License boundary

All packages and apps are Apache-2.0. The product is open-source software with a hosted cloud service, not open-core. There is no proprietary component.

| Path | License | Notes |
|---|---|---|
| `packages/engine` | Apache-2.0 | Manifest schema, expression evaluator, step executors, `StorageAdapter`, `StepExecutor` interface |
| `packages/shared` | Apache-2.0 | Zod schemas, plan definitions, audit event types, `breached-passwords.txt` |
| `packages/cli` | Apache-2.0 | `forge` CLI |
| `apps/server` | Apache-2.0 | Fastify API, auth, billing, audit, vault, scheduler, webhooks, demo services |
| `apps/worker` | Apache-2.0 | BullMQ consumer, crash recovery, outbox dispatcher |
| `apps/web` | Apache-2.0 | React SPA |

---

## 3. Target user and revenue model

### 3.1 Who buys this

**Primary:** freelance designer/developer/bookkeeper/marketer running 5–40 concurrent client engagements, repeating the same operational chore weekly. Technical enough to edit YAML; not shopping for developer infrastructure. Primary onboarding path: template selection.

**Secondary:** 2–10 person micro-agency where one operations-minded person wants sequences to run themselves.

**Excluded from v1:** enterprise IT; developers seeking a general-purpose Zapier/n8n replacement.

### 3.2 The five target workflows

1. **Invoice Chaser** — weekday mornings, fetch open invoices, find 14+ days overdue, send reminder. >30 days overdue triggers `manual_approval` before escalation email.
2. **Client Onboarding** — webhook trigger, send welcome sequence.
3. **Order Follow-Up** — schedule trigger, find stuck orders, notify. >48h stalled triggers `manual_approval`.
4. **Review Request** — N days after job closes, send review request; one nudge after 7 days.
5. **Renewal Reminder** — 30/14/7 days before renewal, email client and post log entry.

### 3.3 Plans

**Plan entitlement matrix:**

| Feature flag | Community | Free | Pro | Studio | Demo |
|---|---|---|---|---|---|
| `credential_vault` | ✓ | ✗ | ✓ | ✓ | ✓ |
| `audit_log` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `manual_approval` | ✓ | ✗ | ✓ | ✓ | ✓ |
| `webhook_triggers` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `schedule_triggers` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `api_tokens` | ✓ | ✓ | ✓ | ✓ | ✓ |

**Plan table (seeded by `seed.js plans`):**

| Plan | Monthly | Runs | Overage | Seats | Run history | Audit retention | Timeout (h) | Overage rate (cents) | Rate limit | Concurrency |
|---|---|---|---|---|---|---|---|---|---|---|
| Community (self-host) | $0 | unlimited | — | 1 | local | — | null | null | N/A | null (unlimited) |
| Hosted Free | $0 | 500 (hard cap) | — | 1 | 7 days | — | 1 | null | 120/min | 1 |
| Pro | $29 | 10,000 | $0.03/run | 5 | 90 days | 90 days | 6 | 3 | 600/min | 5 |
| Studio | $99 | 50,000 | $0.015/run | unlimited | 396 days (13 mo) | 365 days | 24 | 15 | 2,000/min | 20 |
| Demo (seed only) | $0 | unlimited | — | 1 | unlimited | — | 24 | null | 2,000/min | 5 |

**Plan entitlement enforcement:**
- `feature_flags`: checked in API middleware and step executors (cached in Redis 5 min, invalidated on plan change). **If Redis is unavailable, entitlement checks fail closed** — gated features are denied and the request returns `plan_feature_required`. This prevents security-relevant features from executing without authorization.
- `workflow_timeout_hours`: read at run creation, stored as `timeout_at` on `runs`.
- `audit_retention_days` / `run_history_days`: read by `retention_purge` job.
- `run_limit` / `overage_rate_cents`: admission control + `billing_period_close`.
- `concurrency_limit`: null for Community → check skipped (unlimited).

**Billing model:** Free hard cap at 500 (`runs_consumed` + non-terminal active runs). Pro/Studio soft threshold at 100% (overage activates); 80% banner shown.

**`runs_consumed` maintenance:** incremented atomically in same transaction as terminal transition (`succeeded`/`failed`/`canceled`), but **only if at least one step has executed** (i.e., `started_at IS NOT NULL`). Runs canceled from `queued` before any step executes are NOT billed — no `usage_events` row is inserted. Reset to 0 by `billing_period_close`. Reconciliation verifies against `usage_events`.

**Free-plan admission:** transaction locks `workspaces` + `subscriptions`; if `runs_consumed + active_count >= 500`, reject. Scheduled at cap: no run created, `next_fire_at` advanced, audit event `run_limit_exceeded_scheduled`. Webhook at cap: 429. Manual at cap: 429.

**Password policy:** min 12 chars, max 128, at least one letter + one number, top-10K breached passwords rejected (bundled at `packages/shared/data/breached-passwords.txt`, SHA-1 hashes loaded into `Set` at startup). Seeding bypasses policy via direct SQL.

**RBAC role-permission matrix (§8.2 for enforcement):**

| Permission | Owner | Admin | Member |
|---|---|---|---|
| View workspace | ✓ | ✓ | ✓ |
| View workflows | ✓ | ✓ | ✓ |
| Create/edit workflows | ✓ | ✓ | ✗ |
| Delete workflows | ✓ | ✓ | ✗ |
| Run workflows manually | ✓ | ✓ | ✓ |
| Approve/reject approvals | ✓ | ✓ | ✓ |
| View runs | ✓ | ✓ | ✓ |
| Cancel runs | ✓ | ✓ | ✗ |
| Manage members (invite/remove) | ✓ | ✓ | ✗ |
| Change member roles | ✓ | ✗ | ✗ |
| Manage credentials | ✓ | ✓ | ✗ |
| Manage allowlist | ✓ | ✓ | ✗ |
| Manage webhook secrets | ✓ | ✓ | ✗ |
| Manage OIDC providers | ✓ | ✗ | ✗ |
| Manage API tokens (own) | ✓ | ✓ | ✓ |
| Manage API tokens (others) | ✓ | ✓ | ✗ |
| View audit log | ✓ | ✓ | ✗ |
| View/manage subscription | ✓ | ✗ | ✗ |
| Delete workspace | ✓ | ✗ | ✗ |

---

## 4. Architecture

### 4.1 Components

```
flowforge-open/
  package.json                  # npm workspace root
  apps/
    server/                     # Fastify API, static SPA, scheduler, webhooks,
                                 # auth, SSE bridge, migrations, demo services,
                                 # PostgresStorageAdapter
    worker/                     # BullMQ consumer, crash recovery, outbox dispatcher
    web/                        # React 18 SPA (Vite 6 + Tailwind 4 + Radix + @xyflow/react)
  packages/
    engine/                     # manifest schema (zod), expression evaluator,
                                 # step executors, retry/backoff, StorageAdapter,
                                 # InMemoryStorageAdapter, QueueAdapter, StepExecutor
    shared/                     # zod schemas, plan definitions, audit event types,
                                 # API client types, breached-passwords.txt
    cli/                        # `forge` CLI
```

**Runtime:** Node.js 22 LTS. **Data plane:** PostgreSQL 16 (`FF_DATABASE_URL`). **Queue plane:** Redis 7.4 (`FF_REDIS_URL`) with BullMQ. Queues: `forge:runs`, `forge:scheduler`, `forge:outbox`.

### 4.2 Runtime topology

Two modes via `FF_WORKER_MODE`:
- `embedded` (default): one process. API, scheduler, and worker share the same Node process. Approval API handlers enqueue directly via BullMQ.
- `standalone`: separate server + worker, same DB/Redis. Worker exposes `GET /healthz` and `GET /readyz`. API server enqueues via BullMQ (shared Redis). Both processes have queue access; no cross-process signaling needed beyond Redis/BullMQ.

### 4.3 Image and startup contract

- Base: `node:22-bookworm-slim`, pinned by digest.
- Multi-stage Dockerfile: build stage (`npm ci`, `tsc`, `vite build`), runtime stage (compiled output + production deps). `argon2` native module compiled in build stage; compiled `.node` binary copied to runtime stage. No build tools in runtime image.
- Runtime user: non-root `flowforge` (uid 10001). Port 8080.
- Non-API routes at root: `GET /healthz` → `{ status: "ok" }`. `GET /readyz` → 200 when Postgres + Redis + migrations ready. `POST /hooks/:workspaceSlug/:path`. `GET /mock-idp/*`. `GET /demo/*`.
- First-boot seeding (`FF_SEED_DEMO=1`): seed demo workspace, 5 templates, demo user, 30 days synthetic history. PRNG seeded with `FF_DEMO_SEED`.

### 4.4 Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `FF_DATABASE_URL` | PostgreSQL connection | Yes |
| `FF_REDIS_URL` | Redis connection | Yes |
| `FF_PORT` | HTTP bind port (default 8080) | No |
| `FF_VAULT_KEY` | 32-byte base64 master key | Yes |
| `FF_VAULT_KEY_OLD` | Previous key during rotation | No |
| `FF_SESSION_SECRET` | HMAC key for session/CSRF | Yes |
| `FF_DEMO_SEED` | PRNG seed | No (default `flowforge-demo`) |
| `FF_DEMO_PASSWORD` | Demo user password (seed-exempt) | No (default `demo-password-changeme1`) |
| `FF_OIDC_SIGNING_KEY` | 32-byte base64 symmetric key for mock HS256 | Yes (when OIDC enabled) |
| `FF_APP_URL` | Base URL for app | Yes |
| `FF_SEED_DEMO` | Set to `1` to seed demo workspace | No |
| `FF_WORKER_MODE` | `embedded` or `standalone` | No |
| `FF_WORKER_CONCURRENCY` | Worker concurrency (default 4) | No |
| `FF_CONNECTOR_URL` | Connector URL | No |
| `FF_CONNECTOR_TOKEN` | Connector auth token | No |
| `FF_HTTP_ALLOWLIST` | Comma-separated entries in format `scheme://host[:port]` or `host[:port]` | No |

Port precedence: `--port` CLI flag > `FF_PORT` > default 8080.

---

## 5. Workflow manifest format

### 5.1 Top-level schema

```yaml
api_version: flowforge/v1
name: string                  # ^[a-z][a-z0-9-]{2,63}$; unique per workspace
summary: string               # optional; max 200 chars
allow_concurrent: boolean     # optional; default false; workflow-level
inputs:                       # optional
  - name: string              # ^[a-z][a-z0-9_]{0,63}$
    type: string | integer | boolean
    required: boolean         # default false
    default: any
    validation:               # optional
      min: number
      max: number
      pattern: string
triggers:                     # required; 1–3 entries
  - type: schedule | webhook | event  # event rejected with event_trigger_not_supported_in_v1
    cron: string              # required for schedule; 5-field
    timezone: string          # required for schedule; IANA name
    path: string              # optional for webhook; derived from slug if absent
    require_signature: boolean # default true
    auth_mode: hmac | header | none  # default hmac
    secret: string            # required for hmac; references webhook_secrets by name
    auth_header: string       # required for header; header name
    auth_secret: string       # required for header; references webhook_secrets by name
    sync: boolean             # default false
    input_mapping:            # optional; webhook only
      <input_name>: "{{ trigger.payload.<field> }}"
defaults:
  retry:
    attempts: integer         # default 3, max 10
    backoff: fixed | exponential
    base_ms: integer          # default 500
    max_ms: integer          # default 30000
    jitter: boolean           # default true
  timeout_seconds: integer    # default 60
steps:                        # required; 1–50 entries
  - id: string                # ^[a-z][a-z0-9-]{0,63}$; unique at any depth
    type: http | notify | condition | delay | transform | for_each | log | reply | manual_approval | parallel
    with: object              # type-specific (§5.3)
    if: expression            # optional; expression field (E) — bare expression, no {{ }}
    retry: { ... }
    timeout_seconds: integer
    on_error: abort | continue  # default abort
```

**`allow_concurrent` is a workflow-level manifest field** (top-level, alongside `name` and `inputs`). Default `false` enables the per-workflow Redis lock (§6.2). `true` skips the lock, allowing concurrent same-workflow runs up to the workspace concurrency limit. This is NOT the `for_each` step-level `allow_concurrent` field, which is reserved for future use.

**Webhook auth validation:**
- `auth_mode: hmac` (default): requires `secret`. `require_signature` must be `true` (error if `false` with `hmac`).
- `auth_mode: header`: requires `auth_header` and `auth_secret`. `secret` ignored.
- `auth_mode: none`: no auth required. `secret`, `auth_header`, `auth_secret`, `require_signature` all ignored.
- Empty `secret` or `auth_secret`: validation error `validation_error: "webhook secret name cannot be empty"`.

**Path auto-derivation:** `path` defaults to `workflow.slug`. Conflict with existing path → `webhook_path_conflict`.

**Required inputs on schedule triggers:** required input with `required: true` and no `default` on schedule trigger → validation error `required_input_unmapped_for_schedule`.

**Literal URL allowlist check:** literal URLs (no `{{ }}`) in `http.url` checked at save time. Non-allowlisted literal URLs → validation warning. Expression URLs (`{{ ... }}`) not checked at save time; checked at execution only.

**`event` trigger type:** included in the trigger enum so the validator can produce the specific error `event_trigger_not_supported_in_v1` rather than a generic enum mismatch.

**`reply` in schedule-only workflows:** rejected at validation time with error `reply_in_non_webhook`. A manifest with no webhook trigger and a `reply` step is invalid. There is no runtime-skip behavior.

**`manifest` field in API requests:** `manifest` is the raw YAML string. The API parses and validates it server-side.

### 5.2 Canonical example (Invoice Chaser)

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
    cron: "0 9 * * 1-5"
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

Note: `when` and `if` fields are expression fields (E) — bare expressions without `{{ }}` wrapping. `url`, `to`, `subject`, `body`, and `prompt` are interpolation fields (I) — `{{ }}` delimiters within literal text.

### 5.3 Step registry

**Interpolation stringification:** `null` → `""`; `true` → `"true"`; `false` → `"false"`; number → shortest decimal; array → JSON; object → JSON.

**`transform.set`:** values are interpolation fields (I). Pure `{{ }}` evaluates to native value; mixed literal + `{{ }}` interpolates to string.

| `type` | `with` field | Class | Output | Notes |
|---|---|---|---|---|
| `http` | `method` | L | `{ status, headers, body }` | Methods: GET, POST, PUT, PATCH, DELETE, HEAD. GET/HEAD with `body` → `body_on_get_head`. Body truncated at 1MB (`truncated: true`). |
| | `url` | I | | Save-time: literal URL checked against allowlist (warning if missing). Execution-time: all URLs checked. Connector routing per §8.8. |
| | `headers` | I (values) | | Names literal; values interpolation. `Host`, `Cookie`, `X-Forwarded-For` blocked (`forbidden_header`). |
| | `body` | I | | String interpolated. |
| | `idempotency_key` | L | | `X-Idempotency-Key`. If omitted: auto-derived as `ff:{run_id}:{step_path}`. If provided: used as-is (no prefix added). |
| `notify` | `channel` | L | `{ message_id, status }` | `email` or `inbox`. |
| | `to` | I | | Email address (email) or user email/ID (inbox). |
| | `subject` | I | | |
| | `body` | I | | |
| `condition` | `when` | E | `{ branch, output }` | `output` = last step output in executed branch; `null` for empty branch or all-skipped branch. |
| | `then` | — (step[]) | | |
| | `else` | — (step[]?) | | If `when` falsy and `else` absent: `branch: "else"`, `output: null`. |
| `delay` | `duration` | L | `{ resumed_at }` | `30s`–`30d`. No expression support. Does NOT honor `timeout_seconds`. Workflow timeout clock pauses during `waiting` AND `paused`. |
| `transform` | `set` | — (object) | The constructed object | Keys literal; values interpolation (I). |
| `for_each` | `over` | E | `{ results: [...], truncated: bool, dropped_count: int }` | Must evaluate to list. `null` → `succeeded, results=[]`. Non-list non-null → `type_mismatch`. |
| | `limit` | L | | Default 100. |
| | `steps` | — (step[]) | | |
| `log` | `level` | L | `{ message: "<message>" }` | `info`/`warn`/`error`. Truncated 64 KB. `steps.<id>.output` = `{ message: "..." }`. |
| | `message` | I | | |
| `reply` | `status` | L | `{ replied: true }` | 200–599. Webhook-triggered only. One per manifest. Rejected at validation if no webhook trigger. |
| | `headers` | L | | Allowed: `Content-Type`, `Location`, `Retry-After`, `X-FlowForge-*`. Others → `forbidden_reply_header`. |
| | `body` | I | | Runtime 64 KB limit (`reply_body_too_large`). |
| `manual_approval` | `prompt` | I | `{ decision, decided_by, decided_at }` | Approve → `decision: "approved"`; reject → `decision: "rejected"`; timeout → `decision: "timeout"` (with `decided_by: null`, `decided_at: null`). |
| | `timeout_seconds` | L | | Default 86400 (24h). Step-level `timeout_seconds` silently ignored. |
| | `on_timeout` | L | | `skip` (default) or `abort`. |

**`manual_approval.on_timeout` default:** `skip`. If the field is omitted, the step times out after `timeout_seconds` and the run continues as if the step were skipped.

**`for_each` step status rules (complete):**
1. Step `succeeded` if any iteration succeeds OR all iterations are skipped.
2. Step `failed` if any non-skipped iteration fails with `on_error: abort`.
3. **If at least one non-skipped iteration was attempted and all non-skipped iterations failed (regardless of `on_error` value) and no iteration succeeded:** step `failed`.
4. `for_each.over` = `null` → step `succeeded`, `results = []`.

**Retry/timeout applicability:**

| Step type | Retry? | Timeout? | Notes |
|---|---|---|---|
| `http` | Yes | Yes | Retries with same idempotency key. |
| `notify` | Yes | Yes | Retries outbox insert. |
| `condition` | No | No | Deterministic. |
| `delay` | No | No | Parks immediately. |
| `transform` | No | No | Deterministic. |
| `for_each` | No (unit) | No | Child steps have own retry/timeout. |
| `log` | No | No | Best-effort. |
| `reply` | No | No | One-shot. |
| `manual_approval` | No | No (uses `with.timeout_seconds`) | Human action; no retry. |

**Crash recovery vs retry:** retry increments `run_steps.attempt`. Crash recovery re-executes step from cursor with `attempt = previous_attempt + 1`. Both create new `run_steps` rows. `X-Idempotency-Key` stable: `ff:{run_id}:{step_path}`.

**`for_each` output:** `results` array (one per iteration). Failed: `{ status: "failed", error: "<code>" }`. Skipped: `{ status: "skipped" }`. `truncated` and `dropped_count` set when `limit` exceeded.

**`condition` output when all branch steps skipped:** If the branch is non-empty but all steps are skipped via `if: false`, `output: null`.

**Nesting depth:** max depth 4. Top-level = 1, `for_each.steps` = 2, `condition.then`/`else` within `for_each` = 3, nested `condition.then` = 4. Deeper → `nesting_too_deep`.

### 5.4 Expression language

#### 5.4.1 Expression vs interpolation syntax

**Expression fields (E):** The field value is a string containing a single expression. No `{{ }}` wrapping. The entire string is parsed and evaluated as an expression. The result is a native value (boolean, number, string, null, array, object). Example: `when: "loop.item.days_overdue > inputs.escalation_threshold"`

**Interpolation fields (I):** The field value is a string that may contain literal text interspersed with `{{ expr }}` substitution blocks. `{{` is the delimiter; `\{{` is the escape for a literal `{{` in the output. `}}` closes an expression block. The result of interpolation is always a string, except in `transform.set` where a pure `{{ expr }}` value (entire field is one expression block) evaluates to the native value.

Interpolation BNF fragment:
```
interpolation := (literal | expression_block)*
expression_block := "{{" ws* expr ws* "}}"
literal := (char - "{{")* | "\{{"
```

#### 5.4.2 Full expression grammar

```
expr := or_expr
or_expr := and_expr ("or" and_expr)*
and_expr := not_expr ("and" not_expr)*
not_expr := "not" not_expr | comparison
comparison := additive (comp_op additive)?
comp_op := "==" | "!=" | "<" | "<=" | ">" | ">="
additive := multiplicative (("+" | "-") multiplicative)*
multiplicative := unary (("*" | "/" | "%") unary)*
unary := "-" primary | primary
primary := literal | "(" expr ")" | property_access | function_call
property_access := identifier ("." identifier | "[" expr "]")*
function_call := identifier "(" arg_list? ")"
arg_list := expr ("," expr)*
literal := string_literal | number_literal | boolean_literal | "null"
string_literal := '"' ( [^"\\] | '\\' escape )* '"'
escape := '\n' | '\t' | '\r' | '\\' | '\"' | '\u' hex4
number_literal := [0-9]+ ("." [0-9]+)?
boolean_literal := "true" | "false"
identifier := [a-zA-Z_][a-zA-Z0-9_]*
```

**Operator precedence (lowest to highest):** `or` < `and` < `not` < comparison (`==`, `!=`, `<`, `<=`, `>`, `>=`) < additive (`+`, `-`) < multiplicative (`*`, `/`, `%`) < unary negation (`-`) < primary.

**String concatenation:** `+` with two strings → concatenation. `+` with string and number → `type_mismatch` (no implicit coercion for concatenation).

**Arithmetic:** `+`, `-`, `*`, `/`, `%` on two numbers → numeric result. Non-number operands → `type_mismatch` (no implicit coercion, unlike equality which coerces).

#### 5.4.3 Truthiness table

Used by `condition.when`, step `if` guards, and `filter` inner expressions:

| Value | Truthy? |
|---|---|
| `null` | No (falsy) |
| `false` | No (falsy) |
| `0` | No (falsy) |
| `0.0` | No (falsy) |
| `""` (empty string) | No (falsy) |
| `[]` (empty array) | No (falsy) |
| `true` | Yes (truthy) |
| Non-zero number | Yes (truthy) |
| Non-empty string | Yes (truthy) |
| Non-empty array | Yes (truthy) |
| `{}` (empty object) | Yes (truthy) |
| Non-empty object | Yes (truthy) |

#### 5.4.4 Equality/coercion matrix

| Left ↓ / Right → | number | string | boolean | null | array | object |
|---|---|---|---|---|---|---|
| number | numeric `==` | str→num then numeric (unparseable → `false`) | bool→num then numeric | false | false | false |
| string | str→num then numeric (unparseable → `false`) | lexical `==` | false (no coercion) | false | false | false |
| boolean | bool→num then numeric | false | boolean `==` | false | false | false |
| null | false | false | false | true | false | false |
| array | false | false | false | false | deep equality | false |
| object | false | false | false | false | false | deep equality |

**Equality with unparseable string-to-number:** returns `false` (not `type_mismatch`). This aligns equality with "best-effort comparison" while comparison operators (`<`, `>`, etc.) require parseable types and throw `type_mismatch` on unparseable strings.

**Comparison (`<`, `<=`, `>`, `>=`):** both numbers → numeric; both strings → lexical; otherwise attempt number conversion (`null`→0, `true`→1, `false`→0, string→number if parseable else `type_mismatch`); objects/arrays → `type_mismatch`.

#### 5.4.5 Property access

object → value or `null`; array → index or `null`; string/number/boolean/null → `null`. `__proto__`/`constructor`/`prototype` → `forbidden_property_access`.

**Nested `for_each` scoping:** inner `loop.item`/`loop.index` shadow outer. Outer accessible via `loop.outer.item`/`loop.outer.index`.

**`trigger.payload`:** `null` for schedule; parsed JSON for webhook; `null` for manual runs. **`trigger.type`:** `"schedule"`, `"webhook"`, or `"manual"`.

#### 5.4.6 Date and time functions

**All date functions operate in UTC.** If the input ISO string includes an explicit offset, it is converted to UTC before computation. Naive strings (no offset) are assumed UTC.

**`now()`:** Returns current UTC time as an ISO 8601 string (`YYYY-MM-DDTHH:mm:ss.sssZ`).

**`run.scheduled_at`:** ISO 8601 string for schedule/webhook runs; `null` for manual runs.

**`date_add(iso, amount, unit)`:** Adds `amount` of `unit` to `iso`. Returns ISO 8601 UTC string. `unit` is one of: `second`, `minute`, `hour`, `day`, `week`, `month`, `year`. For `month` and `year`, calendar roll-forward applies: Jan 31 + 1 month → Feb 28/29 (last day of target month). For `day`/`week`, adds calendar days in UTC (no DST adjustment, since UTC has no DST). Invalid ISO → `invalid_date_format`. Invalid unit → `type_mismatch`.

**`date_diff(iso_a, iso_b, unit)`:** Returns integer difference between `iso_b` and `iso_a` in `unit`. Positive if `iso_b` > `iso_a`. Same `unit` enumeration as `date_add`. Computed in UTC. Invalid ISO → `invalid_date_format`.

**`format_date(iso, fmt, tz?)`:** Formats `iso` using `fmt` token syntax. If `tz` is provided (IANA timezone name), converts from UTC to that timezone before formatting. If `tz` is omitted, formats in UTC. `fmt` uses Luxon-style tokens: `yyyy` (4-digit year), `MM` (2-digit month), `dd` (2-digit day), `HH` (2-digit hour 24h), `mm` (2-digit minute), `ss` (2-digit second), `ZZ` (timezone offset). Invalid timezone → `invalid_timezone`.

#### 5.4.7 `filter` and `map` inner expressions

`filter(list, expr)` and `map(list, expr)` accept a string-literal inner expression. The inner expression is parsed at save time; unparseable expressions produce a validation warning `unparseable_expression`.

**Inner expression context:** `{ item, index }` where `item` is the current element and `index` is the 0-based index. `loop.*` is NOT available inside `filter`/`map` inner expressions. Referencing `loop.item` inside a `filter`/`map` inner expression → evaluation error `unknown_variable`.

**Operation counting:** Each evaluation of the inner expression counts its AST nodes against the same 10,000-operation cap. For a 100-item list with a 10-node expression, total = 1,000 operations. If the cap is exceeded → `operation_limit_exceeded`.

#### 5.4.8 Expression sandbox

No `eval`/`vm`/`Function`. Prototype blocked. Recursion depth 50. Operation cap 10,000 (`operation_limit_exceeded`). Expression max length 500 chars (`expression_too_long`). `env.*` whitelist: only `FF_APP_URL` (others → `unknown_env_variable`). If `FF_APP_URL` is unset/null (e.g., `forge run` without `--demo`), `env.FF_APP_URL` evaluates to `null`.

**Context bindings:** `inputs.*`, `steps.*.output`/`.status`, `loop.item`/`.index`, `loop.outer.*`, `trigger.type`/`.payload`, `secrets.*`, `env.FF_APP_URL`, `run.id`/`.scheduled_at`, `now()`, `item`/`index` (in `filter`/`map`).

**Function whitelist:** `len`, `lower`, `upper`, `trim`, `join(list, sep)`, `split(str, sep)`, `contains(x, y)`, `starts_with(s, prefix)`, `ends_with(s, suffix)`, `default(x, fallback)`, `coalesce(a, b)`, `round(n)`, `abs(n)`, `now()`, `format_date(iso, fmt, tz?)`, `date_add(iso, amount, unit)`, `date_diff(iso_a, iso_b, unit)`, `filter(list, expr)`, `map(list, expr)`.

**Secret redaction:** substring matching on serialized JSON. Minimum match length: 8 characters. Secret values < 8 chars not redacted. Non-string JSON values checked by exact equality only. `FF_CONNECTOR_TOKEN` also redacted. Runtime bindings resolve unredacted values; redaction applies only at serialization/persistence.

**Missing `secrets.<name>` at runtime:** If a referenced credential does not exist in the workspace, the expression evaluates to `null` and the step fails with error `secret_not_found` when the null value is used in a context that requires a secret (e.g., `http` header, `notify` auth). On Free plan (no `credential_vault` feature flag), referencing `secrets.*` in a manifest → `plan_feature_required` at execution time.

**Expression test vectors:** 100+ cases in `packages/engine/test/expression-vectors.json` covering equality matrix, comparison, arithmetic, property access, `filter`/`map` with operation counting, date timezone, interpolation stringification, secret redaction, `env.*` whitelist, prototype blocking, nesting, truthiness table.

### 5.5 StepExecutor interface

```typescript
interface StepExecutor<TConfig extends z.ZodType> {
  readonly type: string;
  readonly configSchema: TConfig;
  execute(ctx: StepExecutionContext): Promise<StepResult>;
}

interface StepExecutionContext {
  readonly runId: string;
  readonly workspaceId: string;
  readonly stepPath: string;
  readonly attempt: number;
  readonly iteration: number;
  readonly config: z.infer<TConfig>;
  readonly inputs: Record<string, unknown>;
  readonly steps: Record<string, { output: unknown; status: string }>;
  readonly loop: { item: unknown; index: number; outer: LoopContext | null } | null;
  readonly trigger: { type: string; payload: unknown };
  readonly secrets: SecretResolver;
  readonly env: { FF_APP_URL: string | null };
  readonly run: { id: string; scheduled_at: string | null };
  resolveExpression(expr: string): unknown;
  resolveInterpolation(str: string): string;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

interface StepResult {
  status: 'succeeded' | 'failed' | 'waiting' | 'paused' | 'skipped';
  output: unknown;
  error?: { code: string; message: string };
  resumeAt?: string;
  approvalTaskId?: string;
}

interface SecretResolver {
  get(name: string): string | null;
}

interface StorageAdapter {
  createRun(params: CreateRunParams): Promise<Run>;
  updateRunStatus(runId: string, status: string, updates?: Record<string, unknown>): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  insertRunStep(params: InsertRunStepParams): Promise<RunStep>;
  updateRunStep(stepId: string, updates: Record<string, unknown>): Promise<void>;
  queryDueTriggers(): Promise<Trigger[]>;
  advanceTriggerNextFire(triggerId: string, nextFireAt: Date): Promise<void>;
  // ... full interface in packages/engine/src/storage-adapter.ts
}

interface LoopContext {
  item: unknown;
  index: number;
  outer: LoopContext | null;
}
```

Third parties implement `StepExecutor`, register it with the engine, and embed the engine in their own application. The hosted product only loads the 9 built-in executors.

---

## 6. Execution engine semantics

### 6.1 Run state machine

```
queued → running
queued → canceled        (before any step executes; NOT billed)
running → waiting        (delay)
running → paused         (manual_approval)
running → succeeded
running → failed         (abort, timeout, recovery exhausted, plan_feature_required, approval_timeout)
running → canceled
running → queued         (stale sweep / crash recovery ONLY via reconciliation)
waiting → queued         (delay resume)
waiting → canceled
paused → queued          (approve)
paused → queued          (reject with on_error: continue)
paused → canceled        (reject with abort; user cancel)
paused → queued          (timeout with on_timeout: skip)
paused → failed          (timeout with on_timeout: abort)
```

Not allowed: `waiting → paused`, `paused → waiting`, direct `running → queued` outside reconciliation.

Step states: `pending`, `running`, `waiting`, `paused`, `succeeded`, `failed`, `skipped`.

### 6.2 Durability and crash recovery

**Step path format (recursive concatenation):**
- Top-level: `{step_id}`
- Inside `for_each`: `{for_each_id}[{index}].{child_id}`
- Inside `condition`: `{condition_id}.{branch}.{child_id}`
- Nested combinations concatenate recursively: a `condition` inside a `for_each` produces `{for_each_id}[{index}].{condition_id}.{branch}.{child_id}`; a `for_each` inside a `condition.then` produces `{condition_id}.then.{for_each_id}[{index}].{child_id}`; a `for_each` inside a `for_each` produces `{outer_for_each_id}[{outer_index}].{inner_for_each_id}[{inner_index}].{child_id}`.

**`run_steps.attempt`:** column named `attempt` (not `attempt_count`). Unique constraint: `unique(run_id, step_path, attempt)`. Starts at 1; crash recovery increments.

**`run_steps.iteration`:** 0-based index for `for_each` child steps; 0 for non-loop steps. NOT NULL default 0.

**`runs.resume_at`:** set on `waiting` (`NOW() + duration`); cleared on `queued`. Read by scheduler (§6.3).

**`runs.total_running_seconds`:** accumulated per step (`finished_at - started_at`). Not reset on crash recovery. **Pauses during `waiting` AND `paused` states** — no time accrues while a run is waiting for a delay or parked for manual approval. Before each step, worker checks `if total_running_seconds > (timeout_at - created_at) / 1000` where `timeout_at` is computed at run creation.

**`runs.timeout_at`:** computed at run creation as `created_at + INTERVAL '<workflow_timeout_hours> hours'`. Since `started_at` is null at creation (run is `queued`), `created_at` is used. `timeout_at` is a wall-clock deadline; `total_running_seconds` tracks only actual execution time (excluding `waiting`/`paused`), so a 6h Pro-plan timeout allows 6h of actual step execution, not 6h of wall-clock.

**Heartbeat:** 15s during execution. Stale sweep: 90s (`heartbeat_at < NOW() - INTERVAL '90 seconds'`). Only `running` runs re-queued.

**Stale sweep (reconciliation job, every 60s):**
1. Stuck queued: `WHERE status = 'queued' AND job_id IS NULL AND concurrency_block = false` → re-enqueue.
2. Stale running: `WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '90s'` → reset to `queued`, increment `recovery_count`. If `recovery_count >= 3` → `failed` (`recovery_exhausted`).
3. Queue timeout: `WHERE status = 'queued' AND created_at < NOW() - INTERVAL '24 hours'` → `failed` (`queue_timeout`). 24h is fixed, not plan-configurable.

**Per-workflow Redis lock (D23):** acquired on `running`, released on `waiting`/`paused`/terminal. TTL 120s, renewed by heartbeat. Opt-in via workflow-level `allow_concurrent: false` (default, enables lock) or `true` (skips lock). Lock is separate from workspace concurrency limit (§6.5).

**Memory guardrails:** per-run state > 200MB → `run_state_too_large` (run `failed`). Worker memory > 80% heap → no new jobs dequeued until < 70%.

**Idempotency key format:** `ff:{run_id}:{step_path}` — standardized everywhere. If the user provides an explicit `idempotency_key` in the manifest, it is used as-is (no `ff:` prefix added).

### 6.3 Scheduling

**Scheduler tick (10s):** Redis lock (`SET ff:scheduler:tick NX PX 15000`). The tick handles: (1) due triggers, (2) delay-resume, (3) due system jobs, (4) reconciliation.

**Due trigger query:**

```sql
SELECT t.* FROM triggers t
JOIN workflows w ON t.workflow_id = w.id
WHERE t.is_enabled = true AND w.is_enabled = true AND t.next_fire_at <= NOW()
FOR UPDATE SKIP LOCKED
```

**Post-commit enqueue:** transaction inserts run (`ON CONFLICT DO NOTHING` on idempotency key `sched:{workflow_id}:{trigger_id}:{next_fire_at}`), advances `next_fire_at`, commits. After commit: enqueue via BullMQ. On success: `UPDATE runs SET job_id = ?`. On failure: reconciliation selects `WHERE status = 'queued' AND job_id IS NULL AND concurrency_block = false` and re-enqueues.

**Orphan job:** worker receives job with missing `run_id` → logs warning, discards.

**Delay-resume query:**

```sql
SELECT id, workspace_id, workflow_id, resume_at
FROM runs
WHERE status = 'waiting' AND resume_at <= NOW()
FOR UPDATE SKIP LOCKED LIMIT 50
```

**`scheduler_lease` key format:** `{run_id}:{resume_at_iso}` — includes both run ID and the resume timestamp. This prevents a second `delay` step in the same run from conflicting with the first lease. Each delay step gets its own lease because `resume_at` differs.

For each: insert `scheduler_lease` (`ON CONFLICT DO NOTHING`). If inserted: `UPDATE runs SET status = 'queued', resume_at = NULL` + enqueue.

**`scheduler_lease` cleanup:** `scheduler_lease` rows have an `expires_at` column set to `acquired_at + INTERVAL '5 minutes'`. The reconciliation job deletes rows where `expires_at < NOW()`. If a worker crashes after inserting a lease but before re-queueing the run, the lease expires in 5 minutes, and the reconciliation job reprocesses the associated `waiting` run (it will appear in the delay-resume query again since `resume_at <= NOW()` is still true).

**Concurrency control:**

**Blocked-queued state:** When a run is created but the workspace is at its concurrency limit, the run is inserted with `status = 'queued'`, `job_id = NULL`, and `concurrency_block = true`. This run is NOT counted against the concurrency limit (it is blocked, not active). The concurrency count query is:

```sql
SELECT COUNT(*) FROM runs
WHERE workspace_id = ? AND status IN ('queued','running','waiting','paused')
AND concurrency_block = false
```

If `concurrency_limit IS NULL` (Community), skip check (unlimited). If count >= limit: new runs get `concurrency_block = true`.

Manual at limit: 429 `concurrency_limit_exceeded`. Webhook at limit: 429 `concurrency_limit_exceeded`.

**`concurrency_retry` system job (every 30s):** Selects blocked runs and promotes them when capacity frees:

```sql
SELECT id, workspace_id FROM runs
WHERE status = 'queued' AND concurrency_block = true AND job_id IS NULL
ORDER BY created_at ASC LIMIT 100
```

For each: check if workspace count < limit. If yes: `UPDATE runs SET concurrency_block = false` and enqueue via BullMQ. This job is the ONLY mechanism that unblocks concurrency-blocked runs.

**Manual runs on disabled workflow:** 403 `workflow_disabled`. Webhook on disabled: 410 `workflow_disabled`. In-flight runs complete.

### 6.4 Webhooks

`POST /hooks/{workspace_slug}/{path}` — at root, NOT under `/api/v1`.

**Path uniqueness:** `unique(workspace_id, path)` for webhook triggers.

**Webhook secrets:** stored in `webhook_secrets` table (not vault) on ALL plans. Encrypted AES-256-GCM. Lookup by `(workspace_id, name)`.

**`webhook_secrets.trigger_id`:** nullable, always `NULL` in v1. Reserved for future per-trigger scoping. Lookup logic ignores this column.

**HMAC signature:** header `X-FlowForge-Signature`: `sha256=<hex>`. Signed payload: `X-FlowForge-Timestamp + "\n" + raw_body_bytes`. `auth_mode: none` → no verification required.

**`X-FlowForge-Timestamp` format:** Unix epoch seconds as a decimal string (e.g., `1717200000`). Missing → 401 `timestamp_missing`. Stale (>300s from server time) → 401 `timestamp_out_of_tolerance`.

**`auth_mode: header` validation:** The server looks up the webhook secret by `(workspace_id, auth_secret_name)`. It then performs a **constant-time exact string comparison** of the request header named `auth_header` against the decrypted secret value. No prefix parsing, no encoding transformation. Comparison failure → 401 `invalid_signature`.

**Replay protection:** `unique(workspace_id, trigger_id, payload_hash)`. `sha256(raw_body)`. Conflict → 409 `duplicate_webhook`. TTL 10 min. The unique constraint includes `trigger_id` (not `workflow_id`) so that the same payload sent to different webhook triggers on the same workflow does not collide. Atomic with run creation (same transaction).

**Client idempotency key:** `X-FlowForge-Idempotency-Key` header → replay hash = `sha256(idempotency_key + raw_body)`.

**Non-JSON webhook payload handling:** If the `Content-Type` header is not `application/json` or the body is not valid JSON, `trigger.payload` is set to `null` and the run proceeds. `input_mapping` referencing `trigger.payload.<field>` resolves to `null` for all fields. If the manifest requires non-null payload fields via `input_mapping`, the run fails with `input_mapping_failed`.

**Input mapping:** bindings available: `trigger.payload` ONLY. `trigger.type` also available. Missing paths → `null`. Mapping errors → 400 `input_mapping_failed`. Type mismatches → 400 `validation_error`.

**Response:**
- `sync: false` (default): `202 { run_id }`.
- `sync: true` + manifest has `reply`: defer up to 30s via Redis pub/sub protocol. If `reply` reached: return `reply.status` as HTTP status, `reply.headers` as headers, `reply.body` as body. If timeout: `202 { run_id, status: "pending" }` + `Location: {FF_APP_URL}/api/v1/workspaces/{slug}/runs/{run_id}`. If run terminates before reply: `202 { run_id, status: "<terminal>" }`.
- `sync: true` without `reply`: `202 { run_id }`.

**Webhook synchronous response protocol (Redis pub/sub):**
- Channel: `ff:reply:{run_id}`
- Server subscribes to channel before enqueuing the run via BullMQ.
- Worker publishes `reply_ready` message when the `reply` step executes: `{ type: "reply_ready", status: <int>, headers: <obj>, body: <str> }`
- Worker publishes `run_terminal` message when the run reaches a terminal state before reply: `{ type: "run_terminal", status: "<terminal_status>" }`
- Server unsubscribes on receiving either message or on 30s timeout.
- On timeout: server returns `202 { run_id, status: "pending" }` + `Location` header.

**HTTP redirect handling:** up to 3 hops. 301/302/303/307/308 followed. 303 → GET. 307/308 preserve method/body. **Each hop's host is checked against the effective allowlist.** If a redirect target is non-allowlisted AND `FF_CONNECTOR_URL` is configured, the redirect is followed through the connector. If non-allowlisted AND no connector → `host_not_allowed`. Each hop's resolved IPs must be non-private.

**Disabled workflow webhook:** 410 `workflow_disabled`. Unknown path: 404 `webhook_not_found`. Rate limit: 429 `webhook_rate_limited`.

### 6.5 Concurrency control

Per-workspace total active runs (excluding concurrency-blocked). Free: 1, Pro: 5, Studio: 20, Demo: 5, Community: null (unlimited, check skipped).

**Per-workflow lock (D23):** opt-in via workflow-level `allow_concurrent: false` (default, enables lock) or `true` (skips). Lock acquired on `running`, released on `waiting`/`paused`/terminal. TTL 120s, renewed by heartbeat. Separate from workspace concurrency.

---

## 7. Data model

PostgreSQL 16. All tables: `created_at`, `updated_at`. Tenant-scoped: `workspace_id`.

| Table | Key columns | Purpose |
|---|---|---|
| `users` | id, email (unique), password_hash, name | User accounts |
| `workspaces` | id, slug (unique), name, plan_id, is_enabled (default true) | Tenant boundary |
| `workspace_memberships` | workspace_id, user_id, role, unique(workspace_id, user_id) | RBAC |
| `invitations` | id, workspace_id, email, role, token_hash, expires_at, accepted_at, revoked_at | Invitations |
| `plans` | id, name, price_cents, run_limit, seat_limit, feature_flags (jsonb), concurrency_limit, run_history_days, audit_retention_days, workflow_timeout_hours, overage_rate_cents | Entitlements (5 rows) |
| `subscriptions` | workspace_id, plan_id, period_start, period_end, runs_consumed | Billing period. **`subscriptions.plan_id` is authoritative** for entitlement checks. |
| `workflows` | id, workspace_id, slug, name, current_version_id, is_enabled (default true), unique(workspace_id, slug) | Registry |
| `workflow_versions` | id, workflow_id, version_number, manifest_yaml, created_by, unique(workflow_id, version_number) | Immutable versions |
| `triggers` | id, workflow_id, type, config (jsonb), is_enabled, next_fire_at, unique(workspace_id, path) WHERE type='webhook' | Triggers |
| `runs` | id, workspace_id, workflow_id, workflow_version_id, trigger_id, status, state (jsonb), cursor (jsonb), job_id, idempotency_key, started_at, finished_at, heartbeat_at, recovery_count, total_running_seconds, resume_at, timeout_at, concurrency_block (boolean default false), unique(idempotency_key) | Runs |
| `run_steps` | id, run_id, step_id, step_path, iteration, status, input (jsonb), output (jsonb), logs (text), attempt, started_at, finished_at, unique(run_id, step_path, attempt) | Step execution |
| `run_events` | id, run_id, event_type, data (jsonb), created_at | SSE events |
| `credentials` | id, workspace_id, name, kind, nonce, encrypted_value, key_version, created_by, unique(workspace_id, name) | Vault |
| `audit_events` | id, workspace_id, sequence_num, actor_id, action, entity_type, entity_id, metadata (jsonb), prev_hash, hash, created_at, unique(workspace_id, sequence_num) | Audit chain |
| `usage_events` | id, workspace_id, run_id, event_type, quantity, recorded_at, unique(workspace_id, run_id) | Billing |
| `usage_daily` | id, workspace_id, date, run_count, total_steps, unique(workspace_id, date) | Daily aggregation |
| `invoices` | id, workspace_id, period_start, period_end, plan_base_cents, overage_runs, overage_cents, total_cents, status, unique(workspace_id, period_start, period_end) | Invoices |
| `api_tokens` | id, workspace_id, user_id, name, token_hash, role_snapshot, last_used_at, revoked_at, unique(token_hash) | Programmatic access |
| `sessions` | id, workspace_id (nullable), user_id, token_hash, csrf_token_hash, expires_at, revoked_at | Sessions |
| `notifications` | id, workspace_id, user_id, channel, subject, body, status, read_at | Inbox |
| `notification_outbox` | id, workspace_id, run_id, step_path, channel, recipient, subject, body, idempotency_key (unique), status, attempts, next_retry_at | Email dispatch |
| `workspace_allowlist` | id, workspace_id, scheme, host, port (nullable), created_by, created_at | Egress allowlist |
| `webhook_secrets` | id, workspace_id, name (unique per workspace), trigger_id (nullable, always NULL in v1, reserved), encrypted_value, nonce, key_version, created_at | Webhook signing keys |
| `webhook_replay_log` | id, workspace_id, trigger_id, payload_hash, received_at, unique(workspace_id, trigger_id, payload_hash) | Replay dedupe (10-min TTL) |
| `scheduler_lease` | id, key (unique), acquired_at, expires_at | Delay-resume lease |
| `oidc_providers` | id, workspace_id, name, issuer_url, client_id, client_secret_encrypted, client_secret_nonce, client_secret_key_version, enabled | OIDC providers |
| `system_jobs` | id, job_type, next_run_at, last_run_at, config (jsonb) | System scheduler |
| `approval_tasks` | id, run_id, workspace_id, task_id (uuid, unique), step_path, prompt, status, on_timeout, decided_by, decided_at, expires_at, unique(run_id, step_path) | Manual approvals |

**`approval_tasks.on_timeout`:** stores the manifest's `on_timeout` value (`skip` or `abort`) so the `approval_timeout_check` job can implement correct behavior without re-reading the manifest.

**`approval_tasks.status` enum:** `pending`, `approved`, `rejected`, `timeout`, `canceled`.

**`approval_tasks` cascade:** `ON DELETE CASCADE` from `runs`.

**`runs.concurrency_block`:** boolean, default `false`. Set to `true` when a run is created but blocked by the workspace concurrency limit. Cleared when `concurrency_retry` promotes the run.

**`runs.timeout_at`:** set at run creation to `created_at + INTERVAL '<workflow_timeout_hours> hours'`. Wall-clock deadline.

**`notification_outbox.idempotency_key`:** `ff:{run_id}:{step_path}`. Crash recovery re-executes `notify` steps; the unique constraint on `idempotency_key` prevents duplicate outbox rows.

**`notification_outbox` retry backoff:** Exponential backoff with 5 max retries. Retry intervals: 30s, 2m, 10m, 1h, 6h. `next_retry_at` is calculated as `NOW() + interval[n]` where `interval[n]` is the n-th retry interval. After 5 retries: `status = 'failed'`, audit event `notification.permanent_failure`.

**`notification_outbox` for manual approvals:** When a `manual_approval` step enters `paused` state, the step executor writes directly to `notification_outbox` with `run_id`, `step_path`, `channel: 'email'`, `recipient` = first owner's email (§8.7 lookup), `subject: 'Approval required: <prompt summary>'`, `body: <prompt + approval link>`, `idempotency_key: ff:{run_id}:{step_path}:approval`. This integrates approval notifications with the existing outbox dispatch mechanism.

**Audit chain canonical JSON:** keys sorted lexicographically; no whitespace; UTF-8; numbers shortest decimal; `null` included; strings escaped per JSON spec; timestamps `YYYY-MM-DDTHH:mm:ss.sssZ`; nested objects/arrays recursive; no duplicate keys.

Hash: `SHA256(prev_hash_hex_utf8_bytes || canonical_json_utf8_bytes)`.

First event `prev_hash`: `SHA256("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

**Audit `sequence_num` after retention purge:** `sequence_num` is monotonically increasing and never resets. After purge, `MAX(sequence_num)+1` continues from the highest retained number. The chain is **gapless from the anchor forward** — `anchor_sequence_num` is the oldest retained event, and subsequent events are contiguous from there. The "gapless" claim in test exit criteria refers to the retained chain being internally contiguous, not that it starts from 1.

**Retention and verification:** `retention_purge` deletes old `audit_events`. `GET /audit/verify` reports `{ valid: true, checked_count: N, truncated: true, anchor_sequence_num: <oldest retained> }` when chain truncated.

**`retention_purge` complete behavior:**
1. Delete `audit_events` older than `audit_retention_days` (per workspace plan).
2. Delete `runs` and `run_steps` older than `run_history_days` (per workspace plan). `run_steps` cascade via `ON DELETE CASCADE` from `runs`. `run_events` cascade from `runs`. `approval_tasks` cascade from `runs`. `usage_events` are NOT deleted (billing history is permanent).
3. Delete `notifications` older than 30 days.
4. Aggregate `usage_daily`: `INSERT ... SELECT workspace_id, DATE(recorded_at), COUNT(DISTINCT run_id), COUNT(*) FROM usage_events WHERE ... GROUP BY ... ON CONFLICT DO UPDATE ...`.
5. Report audit verification as `truncated: true` when the chain was shortened.

**Usage aggregation:** `invoices` created by `billing_period_close`: calculates `plan_base_cents + overage_runs * overage_rate_cents`, inserts `invoices` row (`status = 'open'`).

**Workspace creation:** `POST /workspaces` creates a workspace with `plan_id` = Free plan ID. A `subscriptions` row is created with `plan_id` = Free, `period_start` = `NOW()`, `period_end` = `NOW() + INTERVAL '30 days'`, `runs_consumed` = 0. **`subscriptions.plan_id` is authoritative** for all entitlement checks. `workspaces.plan_id` is a denormalized cache; updates to subscription plan also update `workspaces.plan_id` in the same transaction.

**System jobs execution mechanism:**
The scheduler tick (every 10s, under Redis lock `ff:scheduler:tick`) checks the `system_jobs` table for jobs where `next_run_at <= NOW()`. For each due job:
1. Dispatch to `forge:scheduler` BullMQ queue.
2. Worker processes the job, executes the job logic, updates `last_run_at = NOW()` and advances `next_run_at` to the next scheduled time.
3. If a job fails: BullMQ retries up to 3 times with 30s backoff. If still failing: `next_run_at` is advanced to the next scheduled time and an audit event `system_job_failed` is logged. The job is not permanently lost — it will fire again at the next `next_run_at`.

**System jobs (7):** `billing_period_close` (1st of month 00:00 UTC), `retention_purge` (daily 02:00 UTC), `approval_timeout_check` (every 60s), `concurrency_retry` (every 30s), `replay_log_cleanup` (every 5m), `reconciliation` (every 60s), `notification_dispatch` (every 30s).

**`approval_timeout_check` routine (every 60s):**
```sql
-- Select expired pending approval tasks
SELECT at.id, at.run_id, at.step_path, at.on_timeout, at.workspace_id
FROM approval_tasks at
WHERE at.status = 'pending' AND at.expires_at <= NOW()
FOR UPDATE SKIP LOCKED LIMIT 100
```
For each:
1. Update `approval_tasks.status = 'timeout'`.
2. Update matching `run_steps` row: if `on_timeout = 'skip'` → `status = 'skipped'`; if `on_timeout = 'abort'` → `status = 'failed'`.
3. Update `run_steps.output`: `skip` → `{ decision: "timeout", decided_by: null, decided_at: null }`; `abort` → same output.
4. If `skip`: `UPDATE runs SET status = 'queued'` + enqueue via BullMQ.
5. If `abort`: `UPDATE runs SET status = 'failed', finished_at = NOW()` + insert `usage_events` row (run is billed since steps executed).

**`approval_timeout_check` race handling:** If the approval is decided between the `SELECT` and the `UPDATE`, the `FOR UPDATE SKIP LOCKED` prevents concurrent processing. The `UPDATE ... WHERE status = 'pending'` checks status atomically — if already decided, 0 rows affected, skip.

**Manual approval resume mechanism:** When `POST /approvals/:taskId/approve` or `/reject` is received:
1. API handler loads `approval_tasks` row. If `status != 'pending'` → 409 `approval_already_decided`.
2. If `expires_at < NOW()` → 409 `approval_already_decided` (expired).
3. If associated run is `canceled` or terminal → 409 `approval_already_decided`.
4. Update `approval_tasks.status`, `decided_by`, `decided_at`.
5. Update `run_steps.status` and `run_steps.output`.
6. Update `runs.status` from `paused` to `queued` (approve, or reject with `continue`) or `canceled` (reject with `abort`).
7. Enqueue run via BullMQ (API server has Redis access in both `embedded` and `standalone` modes).
8. If crash between DB update and enqueue: reconciliation job picks up `queued` run with `job_id IS NULL` and re-enqueues.

**SSE event types and data shapes:**

| `event_type` | `data` shape | When emitted |
|---|---|---|
| `run.created` | `{ run_id, workflow_id, trigger_type, inputs }` | Run inserted |
| `run.queued` | `{ run_id }` | Run enqueued to BullMQ |
| `run.started` | `{ run_id, started_at }` | Worker picks up run |
| `step.started` | `{ run_id, step_path, step_id, attempt, input }` | Step begins execution |
| `step.succeeded` | `{ run_id, step_path, output }` | Step succeeds |
| `step.failed` | `{ run_id, step_path, error: { code, message } }` | Step fails |
| `step.skipped` | `{ run_id, step_path }` | Step skipped via `if: false` |
| `step.waiting` | `{ run_id, step_path, resume_at }` | Delay step parks |
| `step.paused` | `{ run_id, step_path, prompt, approval_task_id }` | Manual approval parks |
| `run.succeeded` | `{ run_id, finished_at, total_running_seconds }` | Run succeeds |
| `run.failed` | `{ run_id, finished_at, reason, total_running_seconds }` | Run fails |
| `run.canceled` | `{ run_id, finished_at }` | Run canceled |
| `heartbeat` | `{ ts }` | Every 15s during SSE connection |

**SSE overflow:** individual events with `data` > 1MB are truncated. The `data` object includes `truncated: true` and the first 1MB of the output. This prevents SSE connection crashes on large step outputs.

**`notify channel:inbox` recipient resolution:** The `to` field is resolved as an email address. The server looks up `SELECT id FROM users WHERE email = ? AND id IN (SELECT user_id FROM workspace_memberships WHERE workspace_id = ?)`. If no match → `unknown_recipient`. The notification is inserted into the `notifications` table for the matched user.

**Credential deletion with active references:** `DELETE /credentials/:id` checks if any enabled workflow's current version manifest references the credential name. If referenced → 409 `credential_in_use`. The check parses the manifest YAML and scans for `secrets.<name>` references.

---

## 8. Control plane features

### 8.1 Authentication and sessions

**Session lifecycle:** pre-workspace session (`workspace_id = NULL`) created on register/login. `GET /auth/me` returns `csrf_token` + `workspaces`. `POST /auth/select-workspace` creates workspace-scoped session (`workspace_id` set) and revokes old pre-workspace session. Pre-workspace session only accesses workspace creation/selection/logout routes.

**CSRF mechanism:** `csrf_token` = first 32 hex chars of `HMAC-SHA256(FF_SESSION_SECRET, session_token)`. Stored as `csrf_token_hash` (`SHA-256` of token) in `sessions`. Client sends `X-CSRF-Token` header. Server validates by computing HMAC from session cookie token and comparing hash.

**Session lifetime:** 7 days sliding (`expires_at` extended 7 days from `now()` on each authenticated request).

**Password change:** Verifies current. Updates hash. Revokes all sessions and all tokens. Returns 204.

**Rate limiting:** 5 failed login attempts per email per 15 minutes → 15-minute lock (`423`).

### 8.2 Workspaces, roles, and RBAC

**RBAC matrix:** defined in §3.3. Roles: Owner, Admin, Member. Enforcement in API middleware via workspace-scoped session + role lookup.

**API tokens:** `user_id` + `role_snapshot`. Revoked on membership removal and password change. No expiry.

### 8.3 Credential vault

**AES-256-GCM:** random 96-bit IV per encryption. Per-workspace data keys via `HKDF-SHA256(FF_VAULT_KEY, salt=workspace_id, info="flowforge-vault-v1", length=32)`.

**Key rotation:** `key_version` monotonically increasing. Rotation script decrypts with `OLD`, re-encrypts with current, increments `key_version`. Idempotent. Covers `credentials`, `webhook_secrets.encrypted_value`, `oidc_providers.client_secret_encrypted`.

### 8.4 API tokens

Workspace-scoped. Shown once at creation. SHA-256 hashed. Revocable. Rate limits per plan.

### 8.5 Audit log

Canonical JSON pinned (§7). Verification: `GET /audit/verify`. After retention purge: `truncated: true`, `anchor_sequence_num` = oldest retained.

### 8.6 OIDC SSO

**Mock IdP (HS256):** fully provable. Endpoints: `.well-known/openid-configuration`, `/authorize`, `/token`, `/userinfo`. Uses `FF_OIDC_SIGNING_KEY`.

**Real IdP (RS256/ES256):** verification code included and tested with bundled RSA test keypair. Live round-trip requires external IdP (§15).

**OIDC state/nonce validation:**
- `state`: generated as `crypto.randomUUID()`, stored in Redis with key `ff:oidc:state:{state}` and TTL 600s. On callback, `state` is validated against Redis and the key is deleted. If missing or expired → 400 `invalid_state`.
- `nonce`: generated as `crypto.randomUUID()`, included in the authorization request as `nonce` parameter, included in the ID token. On token response, `nonce` in the ID token is compared to the stored value. Mismatch → 400 `invalid_nonce`.

**Pre-workspace provider resolution:** OIDC providers are workspace-scoped (`oidc_providers.workspace_id`). For pre-workspace login (no workspace selected), the `:provider` parameter in `GET /auth/oidc/:provider/login` is resolved as a workspace-agnostic provider name. The system queries `SELECT * FROM oidc_providers WHERE name = ? AND enabled = true LIMIT 1`. If multiple workspaces have providers with the same name, the first enabled one is used. After successful authentication, the user is presented with a workspace picker (workspaces where they are a member and have an enabled OIDC provider with the matching name).

**Client secret:** encrypted with AES-256-GCM, covered by vault rotation.

**Envelope exceptions:** mock-idp routes, auth/oidc routes, health/ready, demo routes.

### 8.7 In-app notifications and email

`notify` `channel:inbox` → `notifications` table (recipient resolved by email lookup against workspace members, §7). `notify` `channel:email` → `notification_outbox`. Step status = enqueue-only.

**Approval notification:** `manual_approval` executor writes to `notification_outbox` directly (§7). Recipient: first owner by `created_at ASC`.

### 8.8 Per-workspace egress allowlist

**Effective allowlist:** union of `workspace_allowlist`, `FF_HTTP_ALLOWLIST`, `FF_APP_URL`-derived host, `FF_CONNECTOR_URL`-derived host. Loopback exemption (`FF_SEED_DEMO=1`): ONLY `FF_APP_URL`-derived host:port.

#### Allowlist matching algorithm

A URL `U` matches the effective allowlist if it matches ANY entry in the union:

1. **Host comparison:** exact string match, case-normalized to lowercase. No wildcards, no subdomain matching. `api.example.com` matches `api.example.com` only; it does NOT match `sub.api.example.com` or `example.com`.

2. **Scheme comparison:** `workspace_allowlist` entries include a `scheme` column (`http` or `https` only). The URL's scheme must match. `FF_HTTP_ALLOWLIST` entries may include a scheme (`scheme://host[:port]`); if omitted, both `http` and `https` match. `FF_APP_URL` and `FF_CONNECTOR_URL` derived entries use the scheme from the env var URL.

3. **Port comparison:** 
   - `workspace_allowlist.port` is nullable. If null, the scheme's default port is implied (443 for `https`, 80 for `http`). The URL matches if its port equals the entry's port OR both use the scheme default.
   - `FF_HTTP_ALLOWLIST` entries may include a port (`host:port`); if omitted, both default ports match.
   - URL with an explicit port matches an entry with the same explicit port. URL without explicit port (e.g., `https://api.example.com/path`) uses the scheme default (443 for https).

4. **Path handling:** paths are ignored. Only scheme, host, and port are compared.

5. **`FF_HTTP_ALLOWLIST` format:** comma-separated entries. Each entry is either `scheme://host[:port]` or `host[:port]`. Invalid entries (unparsable host, unsupported scheme, contains a path) cause a fatal startup error. Entries are case-normalized (host to lowercase).

6. **`workspace_allowlist` POST validation:** `scheme` must be `http` or `https`. `host` must be a valid hostname or IP literal (no wildcards, no paths). `port` is optional (nullable → scheme default). Duplicate `(workspace_id, scheme, host, port)` entries → 400 `validation_error`.

#### Private IP ranges (blocked)

The following IP ranges are classified as private and blocked:

| Range | CIDR | Description |
|---|---|---|
| IPv4 loopback | `127.0.0.0/8` | Localhost |
| IPv4 private | `10.0.0.0/8` | RFC 1918 Class A |
| IPv4 private | `172.16.0.0/12` | RFC 1918 Class B |
| IPv4 private | `192.168.0.0/16` | RFC 1918 Class C |
| IPv4 link-local | `169.254.0.0/16` | APIPA |
| IPv4 CGNAT | `100.64.0.0/10` | Carrier-grade NAT |
| IPv6 loopback | `::1/128` | Localhost |
| IPv6 ULA | `fc00::/7` | Unique local addresses |
| IPv6 link-local | `fe80::/10` | Link-local |
| IPv4-mapped IPv6 | `::ffff:0:0/96` | Mapped IPv4 (checked against IPv4 ranges) |

All resolved IPs (A and AAAA records) must be non-private. Any private IP → `private_ip_blocked`. First non-private IP used.

#### Connector routing protocol

**Connector request format:** When routing through the connector, the engine sends an HTTP request to `FF_CONNECTOR_URL` with:
- `X-Target-URL: <resolved_target_url>` header (the full URL the engine wants to reach)
- `Authorization: Bearer <FF_CONNECTOR_TOKEN>` (connector authentication)

**Manifest `Authorization` header handling:** If the manifest sets an `Authorization` header on the `http` step AND the request routes through the connector, the manifest's `Authorization` value is sent as `X-Target-Authorization` instead. The connector reads `X-Target-Authorization` and forwards it as the `Authorization` header to the target service. This prevents duplicate `Authorization` headers. If the manifest does not set an `Authorization` header, `X-Target-Authorization` is not sent.

**Routing decisions:**
- Allowlisted host → direct (no connector, no `X-Target-URL`).
- Non-allowlisted + `FF_CONNECTOR_URL` configured → through connector with `X-Target-URL` and connector auth.
- Non-allowlisted + no connector → `host_not_allowed`.

**Token injection:** Engine sends `Authorization: Bearer <FF_CONNECTOR_TOKEN>` to connector. Manifest's target auth is preserved separately via `X-Target-Authorization`. No conflict.

---

## 9. API contract

**Base path:** `/api/v1` for all API routes. **Non-API routes are at root** (NOT under `/api/v1`): `/hooks/*`, `/healthz`, `/readyz`, `/mock-idp/*`, `/demo/*`.

**Response envelope:** `{ data: ..., error?: { code, message, details? } }` for all API routes except envelope exceptions (§8.6).

**`manifest` field format:** All endpoints accepting `manifest` expect a raw YAML string. The API parses and validates it server-side.

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, name }` | 201 `{ id, email, name, csrf_token, workspaces: [] }` + cookie |
| POST | `/auth/login` | `{ email, password }` | 200 `{ id, email, name, csrf_token, workspaces: [...] }` + cookie |
| POST | `/auth/select-workspace` | `{ workspace_slug }` | 200 `{ workspace, csrf_token }` + cookie |
| POST | `/auth/logout` | — | 204 |
| GET | `/auth/me` | — | 200 `{ id, email, name, workspaces, csrf_token }` |
| POST | `/auth/invite/accept` | `{ token }` | 200 `{ workspace, membership }` + cookie |
| POST | `/auth/change-password` | `{ current_password, new_password }` | 204 |
| GET | `/workspaces` | — | 200 list |
| POST | `/workspaces` | `{ name, slug }` | 201 workspace (Free plan assigned, subscriptions row created) |
| GET | `/workspaces/:slug` | — | 200 workspace + plan info |
| GET | `/workspaces/:slug/members` | — | 200 memberships |
| POST | `/workspaces/:slug/members` | `{ email, role }` | 201 invitation |
| DELETE | `/workspaces/:slug/members/:userId` | — | 204 |
| DELETE | `/workspaces/:slug/invitations/:id` | — | 204 |
| POST | `/workspaces/:slug/invitations/:id/resend` | — | 200 invitation |
| DELETE | `/workspaces/:slug/sessions/:userId` | — | 204 |
| DELETE | `/workspaces/:slug/sessions` | — | 204 |
| GET | `/workspaces/:slug/workflows` | `?limit&offset` | 200 paginated list |
| POST | `/workspaces/:slug/workflows` | `{ name, slug, manifest (YAML string) }` | 201 workflow + version |
| GET | `/workspaces/:slug/workflows/:id` | — | 200 workflow + current version |
| PUT | `/workspaces/:slug/workflows/:id` | `{ name?, is_enabled?, slug? }` | 200 updated workflow |
| DELETE | `/workspaces/:slug/workflows/:id` | — | 204 |
| POST | `/workspaces/:slug/workflows/:id/validate` | `{ manifest (YAML string) }` | 200 `{ valid, errors: [{code, message, path}], warnings: [{code, message, path}] }` |
| POST | `/workspaces/:slug/workflows/:id/run` | `{ inputs?: object }` | 201 `{ run_id }` (duplicate within 10s bucket: 200 `{ run_id: <existing> }`) |
| POST | `/workspaces/:slug/workflows/:id/versions` | `{ manifest (YAML string) }` | 201 new version |
| GET | `/workspaces/:slug/workflows/:id/versions` | — | 200 list |
| POST | `/workspaces/:slug/workflows/:id/promote/:versionId` | — | 200 `{ workflow, promoted_version }` |
| GET | `/workspaces/:slug/workflows/:id/triggers` | — | 200 list |
| POST | `/workspaces/:slug/workflows/:id/triggers` | `{ type, config }` | 201 trigger |
| PUT | `/workspaces/:slug/workflows/:id/triggers/:triggerId` | `{ is_enabled?, config? }` | 200 updated trigger |
| DELETE | `/workspaces/:slug/workflows/:id/triggers/:triggerId` | — | 204 |
| GET | `/workspaces/:slug/runs` | `?workflow_id&status&limit&offset` | 200 paginated `{ data, pagination: { next_cursor, has_more } }` |
| GET | `/workspaces/:slug/runs/:id` | — | 200 run + steps summary |
| GET | `/workspaces/:slug/runs/:id/steps` | — | 200 detailed steps |
| GET | `/workspaces/:slug/runs/:id/events` | — | SSE stream |
| POST | `/workspaces/:slug/runs/:id/cancel` | — | 200 `{ status: "canceled" }` |
| GET | `/workspaces/:slug/approvals` | — | 200 pending tasks |
| POST | `/workspaces/:slug/approvals/:taskId/approve` | — | 200 `{ status: "queued" }` or 409 `approval_already_decided` |
| POST | `/workspaces/:slug/approvals/:taskId/reject` | — | 200 `{ status: "canceled" }` or `{ status: "queued" }` or 409 `approval_already_decided` |
| POST | `/workspaces/:slug/runs/:id/approve-all` | — | 200 `{ approved_count: N }` |
| GET | `/workspaces/:slug/credentials` | — | 200 masked list |
| POST | `/workspaces/:slug/credentials` | `{ name, kind, value }` | 201 credential |
| DELETE | `/workspaces/:slug/credentials/:id` | — | 204 or 409 `credential_in_use` |
| GET | `/workspaces/:slug/audit` | `?limit&offset&format=json` | 200 list |
| GET | `/workspaces/:slug/audit/verify` | — | 200 `{ valid, checked_count, truncated, anchor_sequence_num }` |
| GET | `/workspaces/:slug/usage` | — | 200 `{ used, limit, reset_at, projected }` |
| GET | `/workspaces/:slug/invoices` | — | 200 list |
| GET | `/workspaces/:slug/subscription` | — | 200 subscription + plan |
| POST | `/workspaces/:slug/subscription` | `{ plan_id }` | 200 updated subscription |
| GET | `/workspaces/:slug/allowlist` | — | 200 list |
| POST | `/workspaces/:slug/allowlist` | `{ scheme, host, port? }` | 201 entry |
| DELETE | `/workspaces/:slug/allowlist/:id` | — | 204 |
| GET | `/workspaces/:slug/webhook-secrets` | — | 200 list (names only) |
| POST | `/workspaces/:slug/webhook-secrets` | `{ name, value }` | 201 secret (masked) |
| DELETE | `/workspaces/:slug/webhook-secrets/:id` | — | 204 |
| GET | `/workspaces/:slug/oidc/providers` | — | 200 list |
| POST | `/workspaces/:slug/oidc/providers` | `{ name, issuer_url, client_id, client_secret }` | 201 provider (secret masked) |
| DELETE | `/workspaces/:slug/oidc/providers/:id` | — | 204 |
| GET | `/workspaces/:slug/api-tokens` | — | 200 list |
| POST | `/workspaces/:slug/api-tokens` | `{ name }` | 201 `{ id, name, token }` |
| DELETE | `/workspaces/:slug/api-tokens/:id` | — | 204 |
| GET | `/templates` | — | 200 list of template manifests |
| POST | `/workspaces/:slug/workflows/from-template` | `{ template_id }` | 201 workflow + version |
| GET | `/workspaces/:slug/notifications` | — | 200 list |
| POST | `/workspaces/:slug/notifications/:id/read` | — | 204 |
| POST | `/hooks/:workspaceSlug/:path` | payload | 202 `{ run_id }` or sync response |
| GET | `/auth/oidc/:provider/login` | — | 302 redirect |
| GET | `/auth/oidc/:provider/callback` | `?code&state` | 302 to dashboard + cookie |
| POST | `/auth/oidc/:provider/logout` | — | 302 to IdP logout |
| GET | `/mock-idp/.well-known/openid-configuration` | — | 200 OIDC metadata |
| GET | `/mock-idp/authorize` | `?client_id&redirect_uri&state&scope&nonce` | 200 login form / redirect |
| POST | `/mock-idp/token` | OAuth2 request | 200 JWT (HS256) |
| GET | `/mock-idp/userinfo` | [REDACTED] | 200 claims |
| GET | `/healthz` | — | 200 `{ status: "ok" }` |
| GET | `/readyz` | — | 200 or 503 |
| GET | `/demo/invoices` | `?status&include_escalations` | 200 invoice data |
| GET | `/demo/orders` | `?status` | 200 order data |
| GET | `/demo/clients` | — | 200 client data |

**Version promotion semantics:** `POST /workflows/:id/promote/:versionId` sets `workflows.current_version_id` to the specified version. **In-flight runs continue executing the version they were created with** (`runs.workflow_version_id` is set at creation and never changes). Promotion affects only runs created after the promotion. Any workflow version may be promoted (rollback is supported — promoting an older version is valid). **Trigger reconciliation:** after promotion, triggers are updated to match the promoted manifest's `triggers` array. Existing triggers not in the new manifest are disabled (`is_enabled = false`, not deleted). New triggers in the manifest are created. Webhook paths are derived from the workflow slug; if the workflow slug changes via `PUT /workflows/:id`, webhook trigger paths are re-derived and conflicts produce `webhook_path_conflict`. Scheduled triggers do not require rescheduling on promotion because they reference the workflow, not a specific version.

**Manual run dedup:** `idempotency_key = manual:{workspace_id}:{workflow_id}:{hash(inputs)}:{floor(now/10)}`. This is a bucket-based dedup: two requests within the same 10-second bucket with identical inputs receive the same `run_id`. Requests crossing a 10-second boundary (e.g., t=9.9s and t=10.1s) are NOT deduplicated. This boundary gap is accepted as a known limitation of bucket-based dedup.

**Approval conflict handling:** `POST /approvals/:taskId/approve` and `/reject` return 409 `approval_already_decided` if the task status is not `pending` (already approved, rejected, timed out, or canceled) or if `expires_at < NOW()` or if the associated run is not `paused`.

---

## 10. Web UI specification (the showcase)

### 10.1 Design system

- **Stack:** React 18, Vite 6, TypeScript, Tailwind CSS 4, Radix UI, Lucide icons, Recharts, Monaco Editor, `@xyflow/react`, Framer Motion.
- **Palette:** Slate neutrals (50–950), indigo accent (500–600). Dark mode default.
- **Typography:** Inter (14px base, 1.5 line-height). JetBrains Mono for code.
- **Motion:** Framer Motion (200ms page, 150ms hover).
- **Layout:** Collapsible sidebar (240px/64px). Bottom-sheet mobile. Max-width 1280px.

### 10.2 Pages

| Route | Key elements |
|---|---|
| `/` | Hero, template previews, pricing. |
| `/login`, `/register` | Auth cards, OIDC button (Studio). |
| `/invite` | Invitation acceptance (token-based). |
| `/onboarding` | 3-step wizard (workspace → template → run). |
| `/select-workspace` | Workspace picker + create new. |
| `/dashboard` | Sparkline, hours-saved, active workflows, usage meter. |
| `/workflows` | Card grid, status, trigger type, success rate. Template gallery. |
| `/workflows/:id/edit` | Monaco YAML (55%) + flow graph (45%). Toolbar: Validate, Save, Promote, Run Now, Export. |
| `/workflows/:id/runs/:runId` | Step timeline, SSE live updates, cancel, approval prompt. |
| `/workflows/:id/versions` | YAML diff, promote. |
| `/settings/members` | Member table, role select, invite modal. |
| `/settings/credentials` | Vault (Pro+). Masked list, add/edit. |
| `/settings/audit` | Audit (Pro+). Chronological table, verification indicator, export. |
| `/settings/allowlist` | Host list, add/remove. |
| `/settings/webhooks` | Secret name list, add/remove. |
| `/settings/approvals` | Pending tasks, approve/reject, batch approve. |
| `/settings/plan` | Usage meter, invoices, upgrade. |
| `/settings/sso` | OIDC (Studio). Provider list, add provider, test (mock IdP). |

### 10.3 Showcase quality bar

- Empty states with SVG illustrations.
- Command palette (`Cmd+K`).
- Toast notifications.
- Skeleton loaders (200ms delay).
- Keyboard shortcuts.
- Responsive to 375px.
- **Playwright test IDs (`data-testid`) on all interactive elements.**

### 10.4 Demo seed content

- Workspace: "Acme Creative". User: `demo@acme.test`. Password: `FF_DEMO_PASSWORD`.
- PRNG: `FF_DEMO_SEED`.
- Five templates enabled, pointing at `/demo/*` (root paths).
- 30 days synthetic history.
- Default invoices: max `days_overdue` = 28 (below escalation threshold 30).
- Escalation invoices (`?include_escalations=1`): exactly ONE invoice with `days_overdue` = 45.

**Demo endpoint schemas:**

```json
// GET /demo/invoices?status=overdue
{ "invoices": [{ "id": "inv-001", "number": "INV-2024-001", "client_email": "...", "client_name": "...", "days_overdue": 14, "amount_cents": 5000, "status": "overdue" }] }

// GET /demo/invoices?status=overdue&include_escalations=1
// Adds exactly one: days_overdue=45

// GET /demo/orders?status=stuck
{ "orders": [{ "id": "ord-001", "number": "ORD-2024-001", "client_email": "...", "client_name": "...", "status": "stuck", "hours_stuck": 52 }] }

// GET /demo/clients
{ "clients": [{ "id": "cli-001", "email": "...", "name": "...", "renewal_date": "..." }] }
```

---

## 11. CLI specification

```
forge init                    Create new workflow project
forge validate <file>         Validate manifest
forge run <file> [--input k=v ...] [--dry-run] [--demo]  Execute locally
forge login <url>             Authenticate hosted instance
forge push [--workspace <slug>]  Push local workflows
forge pull [--workspace <slug>]  Pull workspace workflows
forge runs list               List recent runs (hosted; requires login)
forge logs <runId>            Show run logs (hosted; requires login)
forge export <workflowId>     Export workflow YAML
```

**`--input` syntax:** `--input key=value` (repeated). Values parsed as JSON if valid; else string.

**`forge run` without `--demo`:** `env.FF_APP_URL` evaluates to `null` in the expression context. Expressions referencing `env.FF_APP_URL` return `null`. Interpolation fields using `{{ env.FF_APP_URL }}/path` produce the string `"/path"` (null stringifies to `""`). If the manifest's `http.url` resolves to a relative URL or empty string, the step fails with `host_not_allowed`. Users who need demo services locally must use `--demo`.

**`forge run --demo`:** starts in-process server on sequential port scan from 32768 to 61000 (first available). Sets `env.FF_APP_URL` to `http://localhost:{port}`. Serves `/demo/*` with deterministic schemas. If no port available, exits with error "No available port in range 32768–61000."

**`forge run` manual_approval:** In local mode, `manual_approval` prompts on stdin: `Approve escalation email for invoice INV-001 (45 days overdue)? [y/n]`. If stdin is non-interactive (piped, no TTY): the step fails with `non_interactive_approval_unsupported`. `--dry-run` skips approval prompts (step `skipped`). The prompt format is the resolved `prompt` field value followed by `[y/n]`. Input `y` or `yes` → `approved`; `n` or `no` → `rejected`. Timeout (`timeout_seconds`) is not enforced in local mode.

**`forge login`:** prompts email/password → `POST /auth/login` → selects workspace → `POST /workspaces/:slug/api-tokens` → stores token AND workspace slug in `~/.flowforge/credentials.json` (0600). Format: `{ "url": "<hosted_url>", "workspace_slug": "<slug>", "token": "<api_token>" }`.

**`forge push`:** Reads `~/.flowforge/credentials.json` for workspace slug and token. Sends all `.ff.yaml` files in the current directory. For each file: `POST /workspaces/:slug/workflows` if slug doesn't exist (create), or `POST /workflows/:id/versions` if it does (new version). Uses `--workspace` override if provided. If the remote has a newer version, `push` creates a new version (does not overwrite). Local file naming: `{slug}.ff.yaml`.

**`forge pull`:** Reads credentials. `GET /workspaces/:slug/workflows` → for each workflow, `GET /workflows/:id` → writes manifest to `{slug}.ff.yaml` in the current directory. If a local file exists with different content, it is overwritten (pull is authoritative). Uses `--workspace` override if provided.

**`forge push`/`pull` multi-workspace:** `credentials.json` stores one workspace slug + token per login. To switch workspaces, the user runs `forge login` again (overwrites credentials) or uses `--workspace <slug>` (requires a token with access to that workspace). Multiple tokens are not stored simultaneously in v1.

---

## 12. Security model

- **Transport:** TLS 1.2+ production; HTTP sandbox.
- **Passwords:** Argon2id (memory 19456 KiB, time 2, parallelism 1). Policy: min 12, max 128, letter + number, breached list. Seed bypasses policy.
- **Vault:** AES-256-GCM, random 96-bit IV, HKDF-SHA256, `key_version`, rotation (repeated rotations supported).
- **Sessions:** Opaque 256-bit, HMAC-SHA256, HttpOnly, SameSite=Strict, conditional Secure. 7-day sliding. `workspace_id` nullable.
- **CSRF:** HMAC-SHA256 double-submit.
- **API tokens:** Random 256-bit, SHA-256 hashed, workspace-scoped, role-snapshotted, revocable. No expiry.
- **RBAC:** Matrix (§3.3).
- **Audit:** Append-only, SHA-256 chained, canonical JSON pinned, workspace-row lock serialization.
- **Egress:** Per-workspace allowlist + `FF_APP_URL` + connector host. Private IP ranges blocked (§8.8). DNS pinning. TLS hostname verification.
- **Expression sandbox:** No `eval`/`vm`. Prototype blocked. Operation cap 10K. Recursion 50. `env.*` whitelist.
- **Secret redaction:** Substring matching (min 8 chars). Runtime bindings unredacted.
- **OIDC:** Mock HS256 IdP + RS256/ES256 verification. State/nonce validation (§8.6).
- **Webhook:** HMAC-SHA256 signature. Timestamp required (`hmac`). Header auth (constant-time exact comparison). `auth_mode: none` (unsigned). Replay log (10-min TTL, per-trigger scope). Disabled workflow: 410.
- **Demo password:** `FF_DEMO_PASSWORD` never printed in logs. Default `demo-password-changeme1` is known-breached; seeding bypasses policy via direct SQL. For production self-hosting, users MUST override `FF_DEMO_PASSWORD` with a strong value.

---

## 13. Integrations and environment limits

### 13.1 External-service connector

Forward proxy (§8.8). Routing: allowlisted → direct; non-allowlisted + connector → proxy; non-allowlisted + no connector → `host_not_allowed`.

### 13.2 Built-in demo services

Only when `FF_SEED_DEMO=1` (server) or `--demo` (CLI). Read-only. No auth. `/demo/*` (root paths).

### 13.3 Notification and billing providers

`MockNotificationProvider` (default), `MockBillingProvider` (default). SMTP/Stripe require extension (§15).

---

## 14. Install, initialization, startup, and readiness

### 14.1 Service preparation

Managed PostgreSQL 16 and Redis 7.4.

### 14.2 Install

Multi-stage Dockerfile. Build stage: `npm ci`, `tsc`, `vite build`, `argon2` native module compiled. Runtime stage: compiled output + production deps + compiled `.node` binary (no build tools in runtime).

### 14.3 Initialization

1. Advisory lock: `SELECT pg_advisory_lock(hashtext('flowforge_migrations'))`.
2. Migrations: `node apps/server/dist/migrate.js up`.
3. Release lock.
4. Seed plans: `node apps/server/dist/seed.js plans` (5 rows).
5. Seed system jobs (7 jobs).
6. If `FF_SEED_DEMO=1`: seed demo workspace, 5 templates, demo user (password via direct SQL bypass).

### 14.4 Startup

`node apps/server/dist/index.js [--port N]` (embedded) or `node apps/worker/dist/index.js` (standalone).

### 14.5 Readiness

`GET /healthz` → `200 { status: "ok" }`. `GET /readyz` → 200 when DB + Redis + migrations ready.

---

## 15. Capabilities needing extension

1. Dynamic outbound HTTP to arbitrary runtime-chosen endpoints (connector + allowlist covers this at lower level).
2. Real email delivery (`SMTPNotificationProvider`).
3. Real payment collection (`StripeBillingProvider`).
4. OIDC live round-trip with external IdP (mock provable; RS256/ES256 code included).
5. Real-time package installs at runtime (offline runtime).
6. AI-assisted workflow generation.
7. GitOps sync (`forge watch`).
8. Provider abstraction (`IntegrationProvider`).
9. Template marketplace.
10. `parallel` step type.
11. Multi-owner approval notifications.
12. Manual retry button for failed notification outbox rows.

---

## 16. Dependency-ordered build units

### Unit 1 — Project scaffold and shared types
**Deliverables:** npm workspace root; `packages/shared` with zod schemas, plan definitions, audit event types, `breached-passwords.txt`, RSA test keypair.
**Exit criteria:** `npm ci` succeeds; `tsc --noEmit` passes.

### Unit 2 — Database schema and migrations
**Deliverables:** SQL migrations for all §7 tables (including `runs.concurrency_block`, `runs.timeout_at`, `approval_tasks.on_timeout`, `scheduler_lease.expires_at`). Migration runner. Seed script.
**Exit criteria:** `migrate.js up` applies cleanly; `seed.js plans` inserts 5 rows; all constraints present.

### Unit 3 — Authentication and sessions
**Deliverables:** Register, login, workspace selection, logout, invite acceptance, password change. Session middleware. Argon2id. CSRF. Auth rate limiting. Password policy.
**Exit criteria:** Pre-workspace session created; workspace selection creates scoped session; password change revokes all sessions + tokens; 5 failed logins lock account; CSRF validation passes.

### Unit 4 — Workspace, membership, RBAC, and invitations
**Deliverables:** Workspace CRUD with Free plan assignment and subscriptions row creation. Membership/invitation management. RBAC middleware enforcing §3.3 matrix. Last-owner removal protection.
**Exit criteria:** Permission matrix enforced; invitation round-trip works; last-owner removal rejected; `subscriptions.plan_id` authoritative.

### Unit 5 — Manifest schema, validation, and expression evaluator
**Deliverables:** `packages/engine` with zod manifest schema, YAML parser, validation rules. Expression language with full grammar (§5.4), truthiness table, date functions (UTC, unit enumeration, calendar roll-forward, format tokens), E/I syntax, `filter`/`map` inner expressions. 100+ expression test vectors. All 9 step types + `parallel_not_supported_in_v1` + `event_trigger_not_supported_in_v1`. `StorageAdapter` + `InMemoryStorageAdapter`. `StepExecutor` interface (§5.5).
**Exit criteria:** Valid manifest parses; invalid returns located errors; `reply` in schedule-only rejected; expressions evaluate per test vectors; truthiness table enforced; date functions produce correct UTC results; `filter`/`map` inner expressions parse at save time with `item`/`index` context; `StepExecutor` interface compiles.

### Unit 6 — API server and workflow CRUD
**Deliverables:** Fastify server with all §9 routes at correct paths (`/api/v1/*` for API, root for non-API). `POST /workflows` accepts YAML string. `POST /workflows/:id/validate`. `POST /workflows/:id/run` with bucket dedup. `GET /runs` cursor pagination. Version promotion with in-flight version pinning and trigger reconciliation. Webhook-secret and OIDC-provider CRUD. Approval endpoints with conflict handling. Demo endpoints. Mock OIDC IdP with state/nonce. Health/readiness at root.
**Exit criteria:** All routes return documented shapes; `manifest` accepted as YAML string; promotion pins in-flight runs; approval conflict returns 409; non-API routes at root; mock IdP state/nonce validated.

### Unit 7 — Execution engine and worker
**Deliverables:** Step executors (all 9 types) with retry/timeout rules. Run state machine. BullMQ worker. Crash recovery. `manual_approval` executor writes to `notification_outbox` and creates `approval_tasks` with `on_timeout`. Approval resume via API → BullMQ enqueue. `for_each` all-fail-continue → `failed`. Memory guardrails. Per-workflow opt-in lock.
**Exit criteria:** Manual run executes through all step types; `for_each` all-fail-continue → `failed`; approval pauses and resumes; `manual_approval` notification written to outbox; memory guardrail triggers.

### Unit 8 — Scheduler and triggers
**Deliverables:** DB-led scheduler (10s tick) handling triggers, delay-resume, system jobs, reconciliation. `scheduler_lease` with `{run_id}:{resume_at_iso}` key and `expires_at` cleanup. Blocked-queued state with `concurrency_block`. `concurrency_retry` job. `queue_timeout` (24h) enforcement. Webhook ingress with HMAC, timestamp (epoch seconds), header auth (constant-time), replay log (per-trigger scope), non-JSON handling, sync/async, redirect+connector routing.
**Exit criteria:** Scheduled trigger fires; blocked-queued promoted by `concurrency_retry`; `scheduler_lease` cleaned up; `queue_timeout` enforced; webhook HMAC validates; header auth constant-time; non-JSON payload → `trigger.payload = null`; redirects route via connector.

### Unit 9 — Control plane features
**Deliverables:** Credential vault with deletion reference check. Audit log. Usage metering (excluding canceled-queued). Billing. Plan enforcement (fail-closed on Redis outage). API tokens. OIDC adapter. Per-workspace allowlist with matching algorithm (§8.8). Private IP blocking (all ranges). Connector protocol with `X-Target-URL` and `X-Target-Authorization`.
**Exit criteria:** Credential deletion with references → 409; `runs_consumed` excludes canceled-queued; plan enforcement fails closed; allowlist matching exact host; private IP ranges blocked; connector routing with `X-Target-URL` header.

### Unit 10 — CLI tool
**Deliverables:** `forge` binary. `forge run` without `--demo` → `env.FF_APP_URL = null`. `forge run` with `manual_approval` → stdin prompt. `forge login` stores workspace slug. `forge push`/`pull` create-or-update by slug.
**Exit criteria:** `forge run` without `--demo` → `env.FF_APP_URL` null; `forge run` manual_approval prompts on stdin; non-interactive → error; `forge push` creates or adds version; `forge pull` writes `{slug}.ff.yaml`.

### Unit 11 — Web UI (the showcase)
**Deliverables:** React SPA with all §10.2 pages. SSE event consumer (§7 types). Monaco editor. Flow graph. Command palette. Dark mode. Responsive. Playwright test IDs.
**Exit criteria:** All pages render; SSE events render in run inspector; approval queue works; Playwright smoke passes.

### Unit 12 — Demo services and integration
**Deliverables:** Demo endpoints with defined schemas. Five template manifests. Deterministic synthetic history. Escalation invoice at 45 days.
**Exit criteria:** Invoice Chaser runs end-to-end without pause (default); escalation invoice available; smoke test approves once and succeeds.

### Unit 13 — End-to-end test suite
**Deliverables:** Integration tests (39 scenarios). Playwright smoke tests. Expression test corpus.
**Exit criteria:** `npm test -- --run` exits 0; `npx playwright test --reporter=list` exits 0; smoke test includes single-approval escalation scenario.

---

## 17. Functional requirements (EARS format)

```
When a user submits a valid manifest to POST /api/v1/workspaces/:slug/workflows, the system shall create a workflow with an immutable first version and return 201 with the workflow resource.

When a user submits a manifest containing a reply step but no webhook trigger, the system shall return a validation error with code reply_in_non_webhook.

When a manifest contains steps nested more than 4 levels deep, the system shall return a validation error with code nesting_too_deep.

When a user promotes a workflow version via POST /workspaces/:slug/workflows/:id/promote/:versionId, the system shall set current_version_id, reconcile triggers to match the promoted manifest, audit the promotion, and use the promoted version for runs created after the promotion. In-flight runs shall continue executing the version they were created with.

When a workflow is disabled (is_enabled = false), the system shall not fire scheduled triggers, reject manual runs with 403 workflow_disabled, reject webhooks with 410 workflow_disabled, and allow in-flight runs to complete.

When a scheduled trigger's next_fire_at is due, the system shall insert a run with idempotency key sched:{workflow_id}:{trigger_id}:{next_fire_at} under a unique constraint and advance next_fire_at atomically within a single Postgres transaction, then enqueue via BullMQ after commit.

When a webhook POST is received with auth_mode: none, the system shall accept the request without signature or timestamp verification, subject to replay log dedup scoped per trigger.

When a webhook POST is received with auth_mode: hmac and a valid X-FlowForge-Signature header over X-FlowForge-Timestamp (Unix epoch seconds) and raw body, and sync is false or absent, the system shall create a run and return 202 Accepted with the run ID.

When a webhook POST is received with sync: true and the manifest has a reply step, the system shall subscribe to Redis channel ff:reply:{run_id}, defer the response up to 30 seconds, and return the reply step's status, headers, and body as the HTTP response if a reply_ready message is received; if a run_terminal message is received, return 202 with the terminal status; if 30 seconds elapse, return 202 with a Location header pointing to the run.

When a webhook POST is received without X-FlowForge-Timestamp and auth_mode is hmac, the system shall return 401 with code timestamp_missing.

When a webhook POST is received with a duplicate payload hash within 10 minutes for the same trigger, the system shall return 409 with code duplicate_webhook.

When a webhook-triggered run is created and the workspace is at its concurrency limit, the system shall return 429 with code concurrency_limit_exceeded.

When a webhook POST is received with auth_mode: header, the system shall look up the webhook secret by (workspace_id, auth_secret name), decrypt it, and perform a constant-time exact string comparison of the request header named auth_header against the decrypted value.

When a webhook POST is received with a non-JSON body, the system shall set trigger.payload to null and proceed with run creation.

When a manual_approval step is rejected, the system shall mark the step as failed with decision "rejected" and transition the run to canceled if on_error is abort, or to queued if on_error is continue.

When a manual_approval step is approved via POST /approvals/:taskId/approve, the system shall update approval_tasks status, update run_steps status and output, transition the run from paused to queued, and enqueue the run via BullMQ.

When an approval task is already decided, expired, or the run is not paused, the system shall return 409 with code approval_already_decided.

When an http step's resolved URL host is not on the effective allowlist and FF_CONNECTOR_URL is configured, the system shall route the request through the connector proxy with X-Target-URL header containing the resolved target URL and Authorization: Bearer <FF_CONNECTOR_TOKEN>.

When a manifest sets an Authorization header on an http step that routes through the connector, the system shall send the manifest's Authorization value as X-Target-Authorization to the connector.

When an http step's resolved URL host IS on the effective allowlist, the system shall connect directly regardless of connector configuration.

When a for_each loop has more items than the limit, the system shall execute items 0 through limit-1, set output.truncated to true, and set output.dropped_count.

When a for_each loop has all non-skipped iterations failing with on_error: continue and no iteration succeeds, the system shall mark the step as failed.

When a condition step evaluates when as falsy and no else branch is present, the system shall set output to { branch: "else", output: null }.

When a reply step's resolved body exceeds 64 KB at runtime, the system shall fail the step with error code reply_body_too_large.

When a filter or map inner expression is a string literal in the manifest, the system shall parse it at save time with context { item, index } and return a validation warning if unparseable.

When a property access is performed on a number or boolean value, the system shall return null.

When an expression references env.PATH or any env variable other than FF_APP_URL, the system shall return a validation error with code unknown_env_variable.

When forge run is executed without --demo and the manifest references env.FF_APP_URL, the system shall evaluate env.FF_APP_URL as null.

When a user registers, the system shall create a pre-workspace session with workspace_id = NULL, assign the Free plan, and create a subscriptions row.

When a user submits POST /auth/change-password, the system shall verify the current password, validate the new password against policy, update the hash, revoke all sessions globally, revoke all API tokens globally, and return 204.

When a webhook signing secret is stored, the system shall encrypt it with AES-256-GCM and store encrypted_value, nonce, and key_version.

When a run is canceled from queued before any step executes, the system shall NOT insert a usage_events row and shall NOT increment subscriptions.runs_consumed.

When a run reaches a terminal state with at least one executed step, the system shall atomically insert a usage_events row and increment subscriptions.runs_consumed in the same transaction.

When the reconciliation system job runs, the system shall re-enqueue queued runs with job_id IS NULL and concurrency_block = false, re-queue running runs with heartbeat_at older than 90 seconds, transition queued runs older than 24 hours to failed with reason queue_timeout, and clean expired scheduler_lease rows.

When the concurrency_retry system job runs, the system shall select queued runs with concurrency_block = true, check if workspace active count has dropped below the limit, and enqueue those runs.

When the approval_timeout_check system job runs, the system shall select pending approval_tasks where expires_at <= NOW(), set status to timeout, update run_steps based on on_timeout, and transition the run to queued (skip) or failed (abort).

When the retention_purge system job runs, the system shall delete old audit_events, delete old runs and run_steps, delete notifications older than 30 days, aggregate usage_daily, and report audit verification as truncated when the chain was shortened.

When the notification_dispatch system job runs, the system shall select pending notification_outbox rows with next_retry_at <= NOW() and enqueue them to the forge:outbox queue with exponential backoff (30s, 2m, 10m, 1h, 6h) for retries.

When a credential is deleted and is referenced by an enabled workflow's current manifest, the system shall return 409 with code credential_in_use.

When a secrets.<name> reference in an expression resolves to a non-existent credential, the system shall set the value to null and fail the step with error secret_not_found if the value is used in a context requiring a secret.

When an http step follows a redirect to a non-allowlisted host and FF_CONNECTOR_URL is configured, the system shall follow the redirect through the connector.

When the Free plan workspace's total of terminal runs_consumed plus non-terminal active runs reaches 500, the system shall reject new runs with 429 and code run_limit_exceeded.

When the Redis-based feature-flag cache is unavailable, the system shall deny gated features and return plan_feature_required (fail closed).
```

---

## 18. Non-functional requirements

| Category | Requirement |
|---|---|
| Latency | API p95 < 200ms (non-run); webhook ingress < 100ms to 202; SSE first event < 500ms. **Design targets — not mechanically verified by test suite.** |
| Throughput | Safe concurrent runs per worker: 4 (default), up to 20. Webhook rate limit: 100/min per workspace. API rate limits per plan. **Design estimates.** |
| Availability | Health check < 5s; readiness < 30s. |
| Retention | Run history: 7d (Free), 90d (Pro), 396d (Studio), unlimited (Demo). Audit: same. Notifications: 30d. Enforced by `retention_purge`. |
| Observability | Structured JSON logs (pino). `FF_DEMO_PASSWORD` never logged in plaintext. |
| Security | All inputs validated (zod). All queries parameterized. All secrets encrypted at rest. Cookies HttpOnly + SameSite=Strict. CSRF on mutations. Rate limiting. |
| Resource limits | HTTP response: 1MB. Step logs: 64KB. Manifest: 256KB. Expression: 500 chars, 10K ops. API body: 1MB. Per-run state: 200MB. Worker memory: 80% heap. |

---

## 19. Error handling

### API HTTP errors

| Code | Status | When |
|---|---|---|
| `invalid_credentials` | 401 | Login failure |
| `account_locked` | 423 | 5 failed logins |
| `csrf_token_missing` | 403 | Mutation without CSRF |
| `csrf_token_invalid` | 403 | Wrong CSRF token |
| `forbidden` | 403 | RBAC denial |
| `workspace_not_found` | 404 | Unknown slug |
| `workflow_not_found` | 404 | Unknown workflow ID |
| `run_not_found` | 404 | Unknown run ID |
| `validation_error` | 400 | Invalid manifest/input |
| `manifest_too_large` | 400 | > 256KB |
| `run_limit_exceeded` | 429 | Free cap (500) |
| `concurrency_limit_exceeded` | 429 | Too many concurrent |
| `webhook_rate_limited` | 429 | > 100/min |
| `request_too_large` | 413 | API body > 1MB |
| `invalid_signature` | 401 | HMAC failure or header auth mismatch |
| `timestamp_missing` | 401 | No timestamp header (`hmac`) |
| `timestamp_out_of_tolerance` | 401 | Stale timestamp |
| `duplicate_webhook` | 409 | Replay within 10min (per trigger) |
| `workflow_disabled` | 410 | Disabled workflow webhook |
| `workflow_disabled` | 403 | Disabled workflow manual run |
| `webhook_not_found` | 404 | Unknown webhook path |
| `webhook_path_conflict` | 400 | Duplicate webhook path |
| `input_mapping_failed` | 400 | Webhook mapping error |
| `invalid_payload_format` | 400 | Non-JSON webhook body with required input mapping |
| `invitation_expired` | 400 | Expired invitation |
| `cannot_remove_last_owner` | 400 | Last owner removal |
| `plan_feature_required` | 403 | Feature not in plan (or Redis cache unavailable) |
| `password_too_common` | 400 | Breached password |
| `unknown_env_variable` | 400 | Expression `env.*` other than `FF_APP_URL` |
| `body_on_get_head` | 400 | `body` on GET/HEAD |
| `forbidden_reply_header` | 400 | Reply header not allowed |
| `host_not_allowed` | 400 | `http` URL not on allowlist (execution-time) |
| `reply_in_non_webhook` | 400 | `reply` step in schedule-only workflow |
| `multiple_reply_steps` | 400 | > 1 reply step |
| `event_trigger_not_supported_in_v1` | 400 | `event` trigger type |
| `parallel_not_supported_in_v1` | 400 | `parallel` step type |
| `nesting_too_deep` | 400 | Depth > 4 |
| `approval_already_decided` | 409 | Approval task not pending |
| `credential_in_use` | 409 | Credential referenced by active workflow |
| `invalid_state` | 400 | OIDC state missing/expired |
| `invalid_nonce` | 400 | OIDC nonce mismatch |

### Step error codes

| Code | Status | When |
|---|---|---|
| `host_not_allowed` | `failed` | URL not on allowlist, no connector |
| `private_ip_blocked` | `failed` | URL resolves to private IP |
| `timeout_exceeded` | `failed` | Step exceeds `timeout_seconds` |
| `operation_limit_exceeded` | `failed` | Expression > 10K ops |
| `expression_too_long` | `failed` | Expression > 500 chars |
| `unparseable_expression` | `failed` | Expression syntax error |
| `type_mismatch` | `failed` | `for_each.over` non-list or wrong arg type |
| `unknown_recipient` | `failed` | Inbox notify to unknown/non-member user |
| `invalid_date_format` | `failed` | Invalid ISO date |
| `invalid_timezone` | `failed` | Invalid IANA timezone |
| `forbidden_property_access` | `failed` | Prototype access blocked |
| `forbidden_header` | `failed` | `Host`/`Cookie`/`X-Forwarded-For` |
| `reply_body_too_large` | `failed` | Reply body > 64KB |
| `plan_feature_required` | `failed` | Gated step on insufficient plan |
| `run_state_too_large` | `failed` (run) | Per-run state > 200MB |
| `secret_not_found` | `failed` | Referenced credential does not exist |
| `non_interactive_approval_unsupported` | `failed` | CLI `manual_approval` without TTY |

### Run failure reasons

| Reason | When |
|---|---|
| `step_aborted` | Step `abort` |
| `timeout_exceeded` | Tier timeout exceeded |
| `recovery_exhausted` | 3 recovery attempts |
| `queue_timeout` | Queued > 24h |
| `plan_feature_required` | Gated step, insufficient plan |
| `run_state_too_large` | Per-run state > 200MB |
| `approval_timeout` | Manual approval timed out with `on_timeout: abort` |
| `canceled` | User cancel / approval reject with `abort` |

---

## 20. Edge cases

| Trigger | Expected behavior |
|---|---|
| Re-running scheduler tick on fired trigger | `ON CONFLICT DO NOTHING` — no new run. |
| Scheduler crashes after commit, before BullMQ enqueue | Reconciliation detects `job_id IS NULL` and re-enqueues. |
| Disabled workflow, scheduled trigger due | JOIN excludes — not fired. |
| Disabled workflow, webhook arrives | 410 `workflow_disabled`. |
| Disabled workflow, manual run requested | 403 `workflow_disabled`. |
| Disabled workflow, in-flight run exists | Run completes; not canceled. |
| Concurrent audit writes (same workspace) | Workspace-row `FOR UPDATE` serializes. |
| Crash during `http` POST, before cursor commit | Re-executes step. Same `X-Idempotency-Key`: `ff:{run_id}:{step_path}`. |
| `for_each` 150 items, limit 100 | Execute 0–99. `truncated: true`, `dropped_count: 50`. |
| `for_each` child fails (`continue`) | Iteration `failed`; continues. If any succeeds, step `succeeded`. |
| `for_each` all children fail (`continue`), none succeed | Step `failed`. |
| `for_each` all iterations skipped | Step `succeeded`, `results` = all `{ status: "skipped" }`. |
| `for_each.over` = `null` | Step `succeeded`, `results = []`. |
| `for_each.over` = string | `type_mismatch`. |
| `condition.when` truthy non-boolean | `then` executes. Truthiness per §5.4.3. |
| `condition.when` falsy, no `else` | `branch: "else"`, `output: null`. |
| `condition` empty `then` | `output: null`, `branch: "then"`. |
| `condition` all steps in branch skipped via `if: false` | `output: null`. |
| `log` output reference | `steps.<id>.output` = `{ message: "..." }`. |
| Top-level step fails (`continue`) | Run continues; terminal `failed`. |
| Step A skipped (`if: false`), step B in array | Step B executes. |
| `reply` in schedule-only workflow | Validation error `reply_in_non_webhook`. |
| Two `reply` steps | Validation error `multiple_reply_steps`. |
| `reply` with `Location` header | Accepted. `Set-Cookie` → `forbidden_reply_header`. |
| `sync: true` without `reply` | Immediate 202 `{ run_id }`. |
| Webhook without `X-FlowForge-Timestamp` (`hmac`) | 401 `timestamp_missing`. |
| Webhook with stale timestamp (>300s) | 401 `timestamp_out_of_tolerance`. |
| `auth_mode: none` webhook | Accepted; replay log applies. |
| Webhook replay within 10 min (same trigger) | 409 `duplicate_webhook`. |
| Webhook replay same payload, different trigger | Accepted (replay scoped per trigger). |
| Webhook replay with `X-FlowForge-Idempotency-Key` | Different replay hash → accepted. |
| Webhook non-JSON body | `trigger.payload = null`; run proceeds. |
| Webhook non-JSON body + required input_mapping | `input_mapping_failed`. |
| `manual_approval` rejected (`abort`) | Step `failed`, run `canceled`. Not billed (no steps after this). |
| `manual_approval` rejected (`continue`) | Step `failed`, run `queued`, continues. |
| `manual_approval` timeout (`skip`) | Step `skipped`, run continues. |
| `manual_approval` timeout (`abort`) | Step `failed`, run `failed` (reason `approval_timeout`). |
| `manual_approval` with step-level `timeout_seconds` | Silently ignored (uses `with.timeout_seconds`). |
| `manual_approval` `on_timeout` omitted | Defaults to `skip`. |
| Approval already decided | 409 `approval_already_decided`. |
| Approval expired | 409 `approval_already_decided`. |
| Plan downgrade, `paused` approval exists | Run completes; new `manual_approval` steps fail with `plan_feature_required`. |
| API token after user role change | Token retains `role_snapshot`. |
| API token after user removed | Revoked. |
| API token after password change | Revoked. |
| Pre-workspace session accesses workspace route | 403 `forbidden`. |
| Property access on `5`, `true`, `"hello"`, `null` | `null`. |
| Nested `for_each` inner `loop.item` | Inner value; outer via `loop.outer.item`. |
| `trigger.payload` on schedule run | `null`. |
| `trigger.payload` on manual run | `null`. |
| `trigger.type` on manual run | `"manual"`. |
| `env.PATH` in expression | `unknown_env_variable`. |
| `env.FF_APP_URL` when unset (`forge run` without `--demo`) | Evaluates to `null`. |
| `secrets.<name>` not found | `null`; step fails `secret_not_found` if used in auth context. |
| Credential deletion with active references | 409 `credential_in_use`. |
| Empty webhook payload twice within 10 min | 409 `duplicate_webhook`. |
| `reply` body > 64KB at runtime | `reply_body_too_large`. |
| `filter` 100 items × 10-node expression | 1,000 ops counted; cap 10,000. |
| `filter` inner expression references `loop.item` | `unknown_variable`. |
| Audit verification after retention purge | `valid: true`, `truncated: true`, `anchor_sequence_num`. |
| `FF_HTTP_ALLOWLIST` entry with path | Fatal startup error. |
| `http` with `Host` header | `forbidden_header`. |
| `http` GET with `body` field | `body_on_get_head`. |
| `http` with manifest `Authorization` + connector routing | Sent as `X-Target-Authorization`. |
| DNS returns A + AAAA, one private | `private_ip_blocked`. |
| HTTP redirect to non-allowlisted host + connector | Followed via connector. |
| HTTP redirect to non-allowlisted host, no connector | `host_not_allowed`. |
| `localhost` URL without `FF_APP_URL` match (`FF_SEED_DEMO=1`) | Blocked (`private_ip_blocked`). |
| Concurrent migration (standalone) | Advisory lock (`hashtext`) serializes. |
| `FF_DEMO_PASSWORD` in logs | Never printed. |
| `Secure` cookie over HTTP | Cookie NOT set `Secure`. Over HTTPS: `Secure`. |
| Last owner removal attempt | `cannot_remove_last_owner`. |
| `forge run` with `delay > 5m` | Rejected ("not supported in local mode"). |
| `forge run` `manual_approval` non-interactive | `non_interactive_approval_unsupported`. |
| `forge run` `--dry-run` with `manual_approval` | Step `skipped`. |
| `forge run --demo` port selection | Sequential scan 32768–61000; first available. |
| `forge run --input` typed input | JSON values parsed as native types. |
| Key rotation script (first) | Idempotent: skips entries at current version. |
| Key rotation script (second) | `key_version` increments. |
| `approve-all` with no pending tasks | `{ approved_count: 0 }`. |
| `approve-all` with timed-out tasks | Skips; counts only newly approved. |
| `allow_concurrent: true` (workflow-level) | Per-workflow lock skipped. |
| `allow_concurrent: false` (workflow-level, default) | Per-workflow lock enabled. |
| Per-run state > 200MB | `run_state_too_large`; run `failed`. |
| Worker memory > 80% heap | No new jobs dequeued until < 70%. |
| Run canceled from `queued` before any step | NOT billed. No `usage_events` row. |
| Run canceled from `running` after steps executed | Billed. `usage_events` row inserted. |
| Manual run dedup across 10s boundary | NOT deduplicated (bucket gap accepted). |
| Redis unavailable during feature-flag check | Fail closed: `plan_feature_required`. |
| `scheduler_lease` stale (worker crash) | `expires_at` (5 min) → reconciliation cleans and reprocesses. |
| `queue_timeout` (24h) | Reconciliation transitions to `failed` with reason `queue_timeout`. |
| `timeout_at` computation | `created_at + workflow_timeout_hours` (wall-clock deadline). |
| `total_running_seconds` during `paused` | Does NOT accrue (paused). |
| `total_running_seconds` during `waiting` | Does NOT accrue (waiting). |

---

## Test plan

**Test commands:**
```bash
npm test -- --run
npx playwright test --reporter=list
```

**Scenarios (39):**
1. Auth lifecycle (register, login, workspace select, protected route, logout, session revoked).
2. Workspace isolation. Workspace creation assigns Free plan + subscriptions row.
3. RBAC enforcement (member/admin/owner permissions per §3.3 matrix).
4. Invitation lifecycle (create, accept, resend, revoke, expiry).
5. Manifest validation (valid, invalid steps, duplicate ids, bad cron, expression errors, `reply` schedule-only → validation error, multiple `reply`, nesting > 4, `event`/`parallel` `_in_v1`, `env.*`, required input schedule, `body_on_get_head`).
6. Validate endpoint returns `{ valid, errors, warnings }`.
7. End-to-end manual run with inputs; execution through `http`, `for_each`, `condition`, `notify`, `log`.
8. `for_each` edge cases (empty, null, string, all fail `continue` → `failed`, all skipped, limit exceeded).
9. `condition` edge cases (truthy non-boolean, empty branch, non-empty branch output, all steps skipped, falsy no else).
10. `log` output (`{ message: "..." }`).
11. Nested `for_each` (`loop.outer.item`); multi-level step_path.
12. `on_error: continue` top-level.
13. `manual_approval` reject (`abort` → `canceled`; `continue` → `queued`); `on_timeout` default = `skip`.
14. `manual_approval` output shape (approve/reject/timeout all `{ decision, decided_by, decided_at }`).
15. Durable delay (parks `waiting`, `resume_at` set, scheduler resumes, timeout pauses during `waiting`).
16. Manual approval full flow (task created, outbox notification written, approve/reject/timeout, cancel while paused, batch approve, conflict 409).
17. `timeout_seconds` on `manual_approval` (silently ignored).
18. Scheduler idempotency (duplicate trigger → one run; crash after commit → reconciliation).
19. Delay-resume (`waiting` → `queued` via `scheduler_lease` with `{run_id}:{resume_at}` key; lease cleanup).
20. Workflow disable (scheduled skipped, manual 403, webhook 410, in-flight completes).
21. Version promotion (sets `current_version_id`, in-flight runs continue on old version, rollback works, audit event, trigger reconciliation).
22. Webhook HMAC (valid → 202; invalid → 401; missing timestamp → 401; stale → 401; replay per-trigger → 409; replay different trigger → accepted; disabled → 410; unknown → 404; header auth constant-time; `auth_mode: none` → 202; sync with reply → reply response; sync without reply → 202; non-JSON → `trigger.payload = null`; concurrency limit → 429).
23. Concurrency limits (manual/webhook 429 at cap; blocked-queued with `concurrency_block = true`; `concurrency_retry` promotes; 24h queue timeout; Community null → unlimited).
24. Free-plan hard cap (500 → 429; scheduled at cap → no run + audit; `runs_consumed` increment only for executed runs).
25. `runs_consumed` maintenance (terminal with steps → increment; canceled from queued → NOT incremented; period rollover → reset; reconciliation).
26. Plan enforcement (`manual_approval` on Free → `plan_feature_required`; Redis unavailable → fail closed).
27. Plan downgrade (paused runs complete; new gated steps fail).
28. Billing (`usage_events` on terminal with steps; canceled-queued NOT billed; `usage_daily` aggregated; `invoices` generated).
29. Audit chain integrity (concurrent writes serialized; canonical JSON deterministic; `sequence_num` monotonic; verification after purge → `truncated`; anchor from oldest retained).
30. Credential vault (encrypt/decrypt; rotation idempotent; second rotation; deletion with references → 409).
31. Expression sandbox (prototype block; operation cap; property access null; truthiness table: `0`, `""`, `[]` falsy, `{}` truthy; equality unparseable string → `false`; comparison unparseable → `type_mismatch`; date functions UTC; `filter`/`map` inner `item`/`index`; `loop.item` in filter → error).
32. Secret redaction (substring matching min 8 chars; `secret_not_found` at runtime).
33. SSE streaming (event types per §7; `run.created`, `step.started`, `step.succeeded`, `step.paused`, `run.succeeded`; replay; 1MB overflow → `truncated: true`; heartbeat; terminal closes).
34. CLI (`validate`, `run --demo` serves demo endpoints, `run` without `--demo` → `env.FF_APP_URL = null`, `run --dry-run`, `run --input` typed, `run` manual_approval stdin, non-interactive → error, `login` stores workspace slug, `push` create-or-update, `pull` writes files).
35. Egress + connector (allowlisted → direct; non-allowlisted + connector → proxy with `X-Target-URL`; manifest `Authorization` → `X-Target-Authorization`; non-allowlisted + no connector → `host_not_allowed`; private IP blocked (all ranges); redirect via connector; `forbidden_header`; `body_on_get_head`).
36. Rate limiting (Free 120/min, Pro 600/min, Studio 2000/min; webhook 100/min; 429 responses).
37. OIDC mock IdP (discovery HS256; authorize with state/nonce; token; userinfo; login creates session; state validation; nonce validation). RS256/ES256 verification with bundled fixture. Pre-workspace provider resolution.
38. Webhook secrets (encrypted retrievable; HMAC works; CRUD; empty value rejected; `trigger_id` always null in v1).
39. Escalation path (Invoice Chaser with `?include_escalations=1` → ONE invoice `days_overdue=45` → ONE `manual_approval` → approve → `succeeded`).

**Acceptance criterion:** `npm test -- --run` exits 0; `npx playwright test --reporter=list` exits 0; Playwright smoke includes single-approval escalation scenario (`data-testid` selectors).

---

## Packaging

- **Package manager:** `npm` with `package.json` workspace root.
- **Manifest:** `package.json` (workspaces: `packages/*`, `apps/*`).
- **Entry points:**
  - Server: `node apps/server/dist/index.js`
  - Worker: `node apps/worker/dist/index.js`
  - CLI: `node packages/cli/dist/index.js` (published binary: `forge`)
  - SPA: `apps/web/dist/` (built by `vite build`)
- **Minimum direct dependencies:** `fastify`, `pg`, `ioredis`, `bullmq`, `zod`, `js-yaml`, `cron-parser`, `argon2`, `luxon`, `react`, `react-dom`, `vite`, `tailwindcss`, `@radix-ui/*`, `lucide-react`, `recharts`, `@xyflow/react`, `@monaco-editor/react`, `framer-motion`, `vitest`, `@playwright/test`, `typescript`.

---

## Runtime

### Browser UI (`browser_ui`)

- **`runtime_test_command`:** `node apps/server/dist/index.js --port {port}`
- **`runtime_test_mode`:** `"playwright"`
- **`browser_smoke_plan`:**
  1. Navigate to `http://localhost:{port}`; verify landing page renders (`data-testid="landing-hero"`).
  2. Log in as demo user (`demo@acme.test` / `FF_DEMO_PASSWORD`); verify dashboard loads (`data-testid="dashboard-empty-state"`).
  3. Click "New Workflow," select "Invoice Chaser" template; verify manifest editor opens (`data-testid="template-invoice-chaser"`).
  4. Click "Run Now" (`data-testid="run-now-btn"`); wait for `data-testid="run-status-succeeded"` (default data: max `days_overdue` = 28 < 30 → no approval).
  5. Open run inspector; verify timeline shows completed steps (`data-testid="run-inspector-timeline"`).
  6. Open command palette (`Cmd+K`); type "workflows"; verify list appears (`data-testid="command-palette-input"`).
  7. Edit `fetch_overdue` URL to include `?include_escalations=1`; save new version; promote; run. Verify `paused` (`data-testid="run-status-paused"`). Click approve (`data-testid="approval-approve-btn"`). Verify `succeeded` (`data-testid="run-status-succeeded"`).

### API server (`local_api`)

- **`runtime_test_command`:** `node apps/server/dist/index.js --port {port}`
- **`runtime_test_mode`:** `"http"`

### CLI (`cli_tool`)

- **`cli_invocation`:** `forge validate workflows/invoice-chaser.ff.yaml`
- **`test_command`:** `npm test -- --run`

---

## Load-bearing assumptions

1. **The target user can select and run pre-filled templates without authoring YAML.** — If wrong, the template gallery path is the wrong interface and the product needs a visual builder. This is a market hypothesis, not a proven fact.

2. **Workflow run and step state fits within the 2 GB application memory limit at default concurrency.** — Per-run state capped at 200MB (guardrail); 4 concurrent runs ≈ 800MB peak. The 200MB guardrail may cause `run_state_too_large` failures for very large `for_each` loops with large HTTP responses. Memory extension or multiple workers needed for Studio tier concurrency (20).

3. **The egress allowlist + connector proxy model is an acceptable product constraint.** — The per-workspace allowlist makes this self-service; the connector provides an additional path. Whether customers accept pre-adding hosts or configuring a connector for production use is unproven. If broadly rejected, the security model needs redesign.

---

## Obligation Responses

OBL-1: ADDRESSED — `allow_concurrent` is now a workflow-level manifest field in §5.1 top-level schema with default `false`; the `for_each` step-level occurrence is explicitly marked reserved for future use.
OBL-2: ADDRESSED — `reply` in schedule-only workflows is rejected at validation time (`reply_in_non_webhook`); the runtime-skip edge case in §20 is removed.
OBL-3: ADDRESSED — Scheduler crash edge case reworded to "crash after commit, before BullMQ enqueue" which is possible under the stated transaction model.
OBL-4: ADDRESSED — Idempotency key standardized to `ff:{run_id}:{step_path}` in both §5.3 and §6.2; user-supplied override documented.
OBL-5: ADDRESSED — Concurrency-blocked runs use `concurrency_block = true` flag with `job_id = NULL`; blocked runs are NOT counted against the limit; `concurrency_retry` job promotes them when capacity frees.
OBL-6: ADDRESSED — Non-API routes explicitly at root (`/hooks`, `/healthz`, `/readyz`, `/mock-idp`, `/demo`); §9 note corrected.
OBL-7: ADDRESSED — `manual_approval.on_timeout` default specified as `skip` in §5.3.
OBL-8: ADDRESSED — Date functions operate in UTC; §5.4.6 defines default timezone, explicit offset handling, and naive string handling.
OBL-9: ADDRESSED — `forge run` without `--demo` sets `env.FF_APP_URL` to `null`; §11 and §5.4.8 document the behavior.
OBL-10: ADDRESSED — Allowlist matching algorithm fully specified in §8.8 with exact host, scheme, port default, no wildcards, path ignored.
OBL-11: ADDRESSED — Version promotion explicitly states in-flight runs continue on their original `workflow_version_id` in §9 and §17 EARS.
OBL-12: ADDRESSED — Same as OBL-4; idempotency key standardized to `ff:{run_id}:{step_path}` everywhere.
OBL-13: ADDRESSED — §6.2 explicitly states `total_running_seconds` pauses during `paused` state (same as `waiting`).
OBL-14: ADDRESSED — Same as OBL-8; §5.4.6 defines UTC default for all date functions.
OBL-15: ADDRESSED — `retention_purge` behavior in §7 now includes deletion of old `runs`/`run_steps` with cascade; `usage_events` preserved.
OBL-16: ADDRESSED — `concurrency_retry` job behavior fully specified in §6.3 with query and promotion logic.
OBL-17: ADDRESSED — SSE event types enumerated in §7 with 13 event types and data shapes.
OBL-18: ADDRESSED — `condition` with `when` falsy and no `else` returns `branch: "else"`, `output: null` in §5.3 and §20.
OBL-19: ADDRESSED — Same as OBL-11; §17 EARS explicitly states in-flight version pinning.
OBL-20: ADDRESSED — Same as OBL-10; full allowlist matching algorithm in §8.8.
OBL-21: ADDRESSED — `notification_outbox` retry backoff defined as exponential: 30s, 2m, 10m, 1h, 6h in §7.
OBL-22: ADDRESSED — `auth_mode: header` fully specified in §6.4: constant-time exact string comparison, lookup by `(workspace_id, auth_secret name)`, failure → 401 `invalid_signature`.
OBL-23: ADDRESSED — `webhook_secrets.trigger_id` clarified as nullable, always NULL in v1, reserved for future per-trigger scoping; lookup ignores it.
OBL-24: ADDRESSED — Same as OBL-10; `FF_HTTP_ALLOWLIST` format and matching in §8.8.
OBL-25: ADDRESSED — Same as OBL-8; `date_add`/`date_diff` timezone, unit enumeration (`second|minute|hour|day|week|month|year`), `format_date` token syntax (Luxon-style), and DST behavior (UTC, calendar roll-forward) in §5.4.6.
OBL-26: ADDRESSED — `for_each` all-fail-continue status defined as `failed` in §5.3 and §20.
OBL-27: ADDRESSED — Same as OBL-4; idempotency key standardized and user-supplied override behavior defined.
OBL-28: ADDRESSED — Same as OBL-9; `forge run` without `--demo` → `env.FF_APP_URL = null`.
OBL-29: ADDRESSED — Billing invariant resolved: runs canceled from `queued` before any step executes are NOT billed; D7 and §3.3 updated to exclude no-step canceled runs; §17 EARS specifies "with at least one executed step."
OBL-30: ADDRESSED — Overage rate cents reconciled: Pro $0.03/run = 3 cents, Studio $0.015/run = 15 cents; dollar amounts updated to match cents column.
OBL-31: ADDRESSED — Same as OBL-2; `reply` in schedule-only is validation error only, no runtime skip.
OBL-32: ADDRESSED — RBAC role-permission matrix added in §3.3 covering all roles and permissions including approve, credentials, allowlist, OIDC, tokens, audit.
OBL-33: ADDRESSED — Full expression grammar with operators, precedence, logical connectives, unary negation, parentheses, and function-call syntax in §5.4.2.
OBL-34: ADDRESSED — Truthiness table in §5.4.3: `null`, `false`, `0`, `""`, `[]` falsy; everything else truthy.
OBL-35: ADDRESSED — Equality matrix updated: unparseable string-to-number returns `false` (not `type_mismatch`); comparison operators use `type_mismatch` for unparseable strings.
OBL-36: ADDRESSED — Step path composition stated as recursive concatenation in §6.2 with examples for all nested combinations.
OBL-37: ADDRESSED — `scheduler_lease.key` format defined as `{run_id}:{resume_at_iso}` with `expires_at` column and reconciliation cleanup in §6.3.
OBL-38: ADDRESSED — `timeout_at` computed from `created_at` at run creation (not `started_at`) in §6.2.
OBL-39: ADDRESSED — Same as OBL-13; `total_running_seconds` does not accrue during `paused`.
OBL-40: ADDRESSED — `queue_timeout` (24h) enforced by reconciliation job; `created_at` is the timestamp source; 24h is fixed; §6.2 and §20 document this.
OBL-41: ADDRESSED — `condition` output when all branch steps skipped: `output: null` in §5.3.
OBL-42: ADDRESSED — `X-FlowForge-Timestamp` format specified as Unix epoch seconds (decimal string) in §6.4.
OBL-43: ADDRESSED — Replay log unique constraint changed to `(workspace_id, trigger_id, payload_hash)` in §7.
OBL-44: ADDRESSED — Non-JSON webhook payload: `trigger.payload = null`, run proceeds; `input_mapping_failed` if required fields map from null in §6.4.
OBL-45: ADDRESSED — Same as OBL-6; non-API routes at root, not under `/api/v1`.
OBL-46: ADDRESSED — OIDC state/nonce validation and pre-workspace provider resolution fully specified in §8.6.
OBL-47: ADDRESSED — Private IP ranges enumerated in §8.8 (RFC 1918, loopback, link-local, ULA, CGNAT, IPv4-mapped IPv6).
OBL-48: ADDRESSED — Redirect policy reconciled: redirects to non-allowlisted hosts can route via connector in §6.4.
OBL-49: ADDRESSED — Workspace creation assigns Free plan, creates subscriptions row; `subscriptions.plan_id` authoritative in §7 and §9.
OBL-50: ADDRESSED — `secret_not_found` error code added; Free-plan vault access fails at execution with `plan_feature_required`; credential deletion with references → 409 `credential_in_use` in §7 and §19.
OBL-51: ADDRESSED — `notification_outbox.idempotency_key` format defined as `ff:{run_id}:{step_path}` in §7.
OBL-52: ADDRESSED — `notify channel:inbox` recipient resolution by email lookup against workspace members in §7; `unknown_recipient` for non-members.
OBL-53: ADDRESSED — Same as OBL-17; SSE event types, data shapes, and 1MB overflow behavior defined in §7.
OBL-54: ADDRESSED — Approval conflict response: 409 `approval_already_decided` for already-decided, expired, or non-paused tasks in §9 and §19.
OBL-55: ADDRESSED — Version promotion trigger reconciliation, slug change propagation, and in-flight version pinning specified in §9.
OBL-56: ADDRESSED — `forge push`/`pull` create-or-update by slug, file layout (`{slug}.ff.yaml`), credentials.json format with workspace slug in §11.
OBL-57: ADDRESSED — CLI `manual_approval` stdin prompt format, non-interactive failure, and `--dry-run` skip in §11.
OBL-58: ADDRESSED — System jobs execution mechanism: scheduler tick dispatches due jobs via BullMQ, retry with 30s backoff, audit event on failure in §7.
OBL-59: ADDRESSED — Manual run dedup bucket gap accepted explicitly in §9: "boundary gap is accepted as a known limitation of bucket-based dedup."
OBL-60: ADDRESSED — Feature-flag Redis cache failure mode: fail closed (gated features denied) in §3.3 and §17 EARS.
OBL-61: ADDRESSED — E/I field syntax fully defined in §5.4.1: E fields are bare expressions, I fields use `{{ }}` with `\{{` escape.
OBL-62: ADDRESSED — Same as OBL-4; idempotency key standardized everywhere.
OBL-63: ADDRESSED — Same as OBL-2; `reply` in schedule-only is validation error only.
OBL-64: ADDRESSED — Same as OBL-8/25; full date/time semantics in §5.4.6.
OBL-65: ADDRESSED — Blocked-queued state with `concurrency_block` flag and `concurrency_retry` job query fully specified in §6.3.
OBL-66: ADDRESSED — Same as OBL-22; `auth_mode: header` constant-time comparison defined.
OBL-67: ADDRESSED — Sync webhook Redis pub/sub protocol fully specified in §6.4 with channel `ff:reply:{run_id}`, message types, and timeout teardown.
OBL-68: ADDRESSED — Same as OBL-10/20/24; full allowlist matching algorithm in §8.8.
OBL-69: ADDRESSED — Same as OBL-11/55; version promotion with in-flight pinning, rollback, and trigger reconciliation in §9.
OBL-70: ADDRESSED — Same as OBL-34; truthiness table in §5.4.3.
OBL-71: ADDRESSED — Same as OBL-26; `for_each` all-fail-continue → `failed`.
OBL-72: ADDRESSED — `filter`/`map` inner expressions: context `{ item, index }`, operation counting against 10K cap, `loop.*` unavailable, save-time parse in §5.4.7.
OBL-73: ADDRESSED — `approval_timeout_check` routine with SQL query, state transitions, and race handling in §7.
OBL-74: ADDRESSED — `scheduler_lease` TTL: `expires_at` column (5 min), reconciliation cleanup in §6.3.
OBL-75: ADDRESSED — `manifest` field in API requests is raw YAML string, clarified in §5.1 and §9.
OBL-76: ADDRESSED — `workspace_allowlist` POST validation: scheme `http`/`https` only, port optional (nullable → scheme default), no wildcards in §8.8.
OBL-77: ADDRESSED — Same as OBL-10; comprehensive allowlist matching in §8.8.
OBL-78: ADDRESSED — Same as OBL-33/34/61/72; full expression/interpolation formalization in §5.4.
OBL-79: ADDRESSED — All direct contradictions reconciled: `reply` validation-only, idempotency key `ff:` prefix, non-API routes at root, overage cents fixed, canceled-queued not billed, `allow_concurrent` workflow-level.
OBL-80: ADDRESSED — Runtime mechanics specified: blocked-queued + `concurrency_retry`, scheduler lease key/TTL, sync webhook Redis protocol, timestamp format, header auth, replay scope, SSE events, OIDC state/nonce.
OBL-81: ADDRESSED — Control-plane definitions added: RBAC matrix, workspace plan assignment, secret errors, outbox retry/idempotency, run retention, approval conflicts, promotion/trigger reconciliation, system job execution.
OBL-82: ADDRESSED — Same as OBL-10; allowlist matching semantics in §8.8.
OBL-83: ADDRESSED — Same as OBL-8; date function timezone semantics in §5.4.6.
OBL-84: ADDRESSED — Same as OBL-9; `forge run` without `--demo` env behavior in §11.
OBL-85: ADDRESSED — Same as OBL-11; in-flight run version pinning in §9 and §17.
OBL-86: ADDRESSED — `StepExecutor` interface fully defined with TypeScript signatures in §5.5.
OBL-87: ADDRESSED — Same as OBL-6; §9 corrected to place non-API routes at root.
OBL-88: ADDRESSED — Connector protocol with `X-Target-URL` header defined in §8.8.
OBL-89: ADDRESSED — `event` added to trigger enum in §5.1 so `event_trigger_not_supported_in_v1` is reachable.