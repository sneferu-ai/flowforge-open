# FlowForge Open — Architecture

How the system fits together: components, data model, runtime topology, and the primary execution flow.

---

## Project shape

FlowForge Open is a **hybrid**: a Fastify HTTP API server, a React SPA, a CLI tool, and an optional standalone worker. The server is the canonical component — it hosts the API, serves the SPA, runs migrations, drives the scheduler tick, ingests webhooks, and (in embedded mode) runs the BullMQ consumer that executes workflows. The standalone worker is the horizontally-scalable deployment path for run execution.

| Component | Technology | Role |
|---|---|---|
| **API server** (`apps/server`) | Fastify 5, TypeScript, Postgres (`pg`), Redis | HTTP API, SPA host, scheduler, webhooks, auth, SSE bridge, demo services, migrations, Postgres storage adapter |
| **Worker** (`apps/worker`) | BullMQ, Fastify (health only) | Durable run consumer + scheduler tick + outbox dispatcher; shares service modules with the server |
| **Web SPA** (`apps/web`) | React 18, Vite 6, Tailwind 4, React Router | Operator UI: dashboards, workflow editor, run inspector, templates, credentials, audit, settings |
| **CLI** (`apps/cli`) | commander, `@flowforge/engine` | `forge` — validate, init, local run, push/pull to hosted, runs list, logs, export |
| **Engine** (`packages/engine`) | zod, TypeScript | Manifest schema, expression evaluator, step executors, retry/backoff, `StorageAdapter` / `QueueAdapter` interfaces |
| **Shared** (`packages/shared`) | zod, TypeScript | Plan definitions, RBAC roles/permissions, error codes, audit event types, password policy |

## Main components and responsibilities

### API server (`apps/server/src/`)

- **`index.ts`** — Fastify bootstrap. Registers plugins (cookie, CORS), mounts non-API routes at root (`/healthz`, `/readyz`, `/hooks/*`, `/mock-idp/*`, `/demo/*`), mounts all API modules under **both** `/api` and `/api/v1`, and serves the SPA as a catch-all. Port precedence: `--port` flag > `FF_PORT` > `PORT` > `8080`.
- **`routes/`** — 16 route modules: `auth`, `workflows`, `runs`, `triggers`, `credentials`, `members`, `workspaces`, `audit`, `dashboard`, `templates`, `notifications`, `webhook-secrets`, `allowlist`, `api-tokens`, `usage`, `oidc`, plus `health`, `webhooks`, `mock-idp`, `demo`, `public`.
- **`services/run-executor.ts`** — The workflow execution engine: parses the manifest, resolves steps, evaluates expressions, handles retry/backoff, persists step state, and drives the run state machine.
- **`services/scheduler.ts`** — DB-led scheduler tick. Redis-lock serialized so the redundant server-side ticker and the standalone worker's ticker can never double-fire the same trigger.
- **`services/queue.ts`** — BullMQ run queue consumer (`startRunConsumer`). Shared by the embedded server and the standalone worker so both modes execute runs identically.
- **`auth/`** — Session management (`session.ts`), OIDC SSO (`oidc.ts`), plan entitlement enforcement (`entitlements.ts`).
- **`middleware/auth.ts`** — Two auth paths: session cookie (with CSRF) and Bearer API token. Enforces the pre-workspace plane (workspace-not-selected rejection).
- **`db/`** — Postgres pool, migration runner, seed script, idempotency keys. Seven SQL migrations under `db/migrations/`.
- **`crypto.ts`** — Credential vault encryption (AES-GCM with `FF_VAULT_KEY`). OIDC RS256 test keys are generated at test time, never stored on disk.
- **`audit/emit.ts`** — Append-only audit event writer with chain verification.

### Engine (`packages/engine/src/`)

- **`manifest-schema.ts`** — zod schemas for the manifest, steps, triggers, inputs, retry. The single source of truth for "what is a valid workflow."
- **`manifest-validator.ts`** — `validateManifest` / `parseManifest` — parse YAML, run zod validation, apply cross-field rules (auth-mode consistency, webhook path conflicts, `parallel` rejection).
- **`expression-evaluator.ts`** — The restricted expression language: `{{ ... }}` interpolation, `{{ steps.x.output.field }}` references, `{{ inputs.foo }}`, `{{ trigger.payload }}`, `{{ env.FF_APP_URL }}`, `{{ loop.item }}` inside `for_each`, with `isTruthy` for conditions.
- **`step-executor.ts`** — The `StepExecutor` / `StepExecutionContext` / `SecretResolver` interfaces. Third parties implement these to embed the engine; the CLI's local runner (`apps/cli/src/index.ts`) and the server's run executor (`apps/server/src/services/run-executor.ts`) are the two concrete executors.
- **`storage-adapter.ts`** + **`in-memory-storage-adapter.ts`** — `StorageAdapter` interface (run/step persistence) and its in-memory implementation for local execution.

### Worker (`apps/worker/src/`)

Standalone BullMQ consumer + scheduler + outbox dispatcher. Health endpoints on `FF_WORKER_PORT` (default 8081). Imports the same `@flowforge/server/services/*` modules as the embedded server, so run execution is byte-identical between modes.

## Runtime topology

```mermaid
flowchart LR
    Browser["Operator browser<br/>(React SPA)"]
    CLI["`forge` CLI"]
    API["API server<br/>Fastify :8080"]
    Worker["Standalone worker<br/>Fastify :8081<br/>(health only)"]
    PG[("PostgreSQL<br/>runs, workflows,<br/>audit, credentials")]
    Redis[("Redis<br/>queue + state")]
    Ext["External HTTP<br/>services / webhooks"]

    Browser -->|HTTP / API v1| API
    CLI -->|HTTP + Bearer token| API
    CLI -->|local in-memory| EngineLocal["engine InMemoryAdapter"]
    API --> PG
    API --> Redis
    Worker --> PG
    Worker --> Redis
    API -->|SSE events| Browser
    API -->|webhook ingress| Ext
    API & Worker -->|step http calls| Ext
```

Two execution modes (controlled by `FF_WORKER_MODE`):

- **`embedded`** (default): the API server runs the BullMQ consumer in-process. One process, one binary.
- **`standalone`**: the API server enqueues; `apps/worker` consumes. Scale run execution independently of API load.

## C4 Context diagram

```mermaid
C4Context
    title FlowForge Open — System Context

    Person(operator, "Freelancer / agency operator", "Automates recurring client back-office tasks")
    Person(member, "Workspace member", "Runs workflows, views runs, approves tasks")

    System(flowforge, "FlowForge Open", "Workflow automation: YAML manifests executed on schedule, webhook, or manual trigger")

    System_Ext(ext_http, "External HTTP services", "Client APIs, billing systems, CRMs the workflows call")
    System_Ext(idp, "OIDC Identity Provider", "SSO for Studio-plan workspaces (mock IdP built in)")
    System_Ext(pg, "PostgreSQL", "Durable run/workflow/audit/credential store")
    System_Ext(redis, "Redis", "BullMQ queue + scheduler locks + OIDC state")

    Rel(operator, flowforge, "Authors manifests, runs workflows, reviews audit")
    Rel(member, flowforge, "Runs workflows, approves manual-approval steps")
    Rel(flowforge, ext_http, "Calls via http steps")
    Rel(flowforge, pg, "Reads/writes runs, workflows, audit, credentials")
    Rel(flowforge, redis, "Enqueues runs, serializes scheduler")
    Rel(flowforge, idp, "OIDC login flow")
```

## C4 Container diagram

```mermaid
C4Container
    title FlowForge Open — Containers

    Boundary(b, "FlowForge Open") {
        Container(spa, "Web SPA", "React 18 + Vite 6 + Tailwind 4", "Operator UI: dashboard, editor, runs, templates")
        Container(api, "API Server", "Fastify 5 + TypeScript", "HTTP API, auth, scheduler, webhooks, migrations, SPA host")
        Container(worker, "Worker", "BullMQ + Fastify (health)", "Durable run consumer + outbox dispatcher")
        Container(cli, "CLI", "commander + engine", "validate, init, run, push, pull, export")
        Container(engine_pkg, "Engine package", "zod + TypeScript", "Manifest schema, expression evaluator, step executors")
        Container(shared_pkg, "Shared package", "zod + TypeScript", "Plans, RBAC, error codes, audit events")
    }

    ContainerDb(pg, "PostgreSQL", "PostgreSQL 16", "users, workspaces, workflows, runs, steps, credentials, audit, usage")
    ContainerQueue(redis, "Redis", "Redis 7.4", "BullMQ queue, scheduler locks, OIDC state store")

    Rel(spa, api, "HTTP /api/v1, session cookie + CSRF")
    Rel(cli, api, "HTTP /api/v1, Bearer API token")
    Rel(cli, engine_pkg, "Local parse + run")
    Rel(api, engine_pkg, "validateManifest, parseManifest")
    Rel(api, pg, "pg Pool")
    Rel(api, redis, "BullMQ enqueue, scheduler lock")
    Rel(worker, redis, "BullMQ consume")
    Rel(worker, pg, "run/step persistence")
    Rel(api, shared_pkg, "plans, RBAC, errors")
    Rel(worker, shared_pkg, "plans, RBAC, errors")
```

## Component diagram — API server modules

```mermaid
flowchart TD
    subgraph "API server (apps/server/src)"
        idx["index.ts<br/>bootstrap + mount"]
        subgraph routes["routes/"]
            AuthR["auth"]
            WfR["workflows"]
            RunR["runs + approvals"]
            TrigR["triggers"]
            CredR["credentials"]
            MemR["members + invitations"]
            WsR["workspaces"]
            AuditR["audit + verify"]
            DashR["dashboard"]
            TmplR["templates"]
            NotifR["notifications"]
            SecR["webhook-secrets"]
            AllowR["allowlist"]
            TokR["api-tokens"]
            UseR["usage + subscription + invoices"]
            OidcR["oidc providers + SSO"]
            HookR["webhooks ingress"]
            DemoR["demo services"]
            HealthR["health"]
        end
        subgraph services["services/"]
            Exec["run-executor"]
            Sched["scheduler"]
            Queue["queue consumer"]
            NotifP["notification-processor"]
            Redis["redis client"]
        end
        subgraph auth["auth/ + middleware/"]
            Sess["session"]
            OidcA["oidc"]
            Ent["entitlements"]
            AuthMw["auth middleware<br/>cookie + Bearer + CSRF"]
        end
        subgraph db["db/"]
            Pool["pool + txn"]
            Mig["migration-runner"]
            Seed["seed"]
            Idem["idempotency"]
        end
        Crypto["crypto (vault)"]
        AuditE["audit/emit"]
    end

    idx --> routes
    AuthR --> Sess
    AuthR --> AuthMw
    WfR --> Engine["engine: validateManifest"]
    RunR --> Queue
    Queue --> Exec
    Exec --> Pool
    Sched --> Redis
    Sched --> Pool
    AuthMw --> Sess
    AuthMw --> Ent
    Ent --> Shared["shared: getPlanDefinition"]
    CredR --> Crypto
    AuditR --> AuditE
    AuditE --> Pool
    OidcR --> OidcA
    OidcA --> Redis
```

## Sequence — manual trigger to run completion

This is the primary user flow: the operator clicks **Run now** on a workflow.

```mermaid
sequenceDiagram
    autonumber
    participant U as Operator (SPA)
    participant API as API server
    participant DB as PostgreSQL
    participant Q as Redis (BullMQ)
    participant W as Run consumer
    participant EXT as External HTTP service

    U->>API: POST /api/v1/workflows/:id/trigger (cookie + CSRF)
    API->>API: requireAuth (session + workspace + RBAC)
    API->>API: checkRunLimit + checkConcurrencyLimit (entitlements)
    API->>DB: INSERT runs (status=queued)
    API->>Q: queue.add(runId)
    API-->>U: 200 { data: { run_id, status: queued } }

    W->>Q: queue consumer picks up job
    W->>DB: UPDATE runs SET status=running
    W->>DB: load workflow manifest (frozen version)
    loop each step
        W->>W: resolve expressions (engine evaluator)
        alt step type = http
            W->>EXT: HTTP request
            EXT-->>W: response
        end
        alt step type = manual_approval
            W->>DB: INSERT approval_tasks (status=pending)
            W->>DB: UPDATE runs SET status=paused
            W-->>U: run paused for approval (SPA polls every 1.5s)
            U->>API: POST /api/v1/approvals/:id/approve
            API->>DB: UPDATE approval_tasks SET status=approved
            W->>DB: poll / resume → status=running
        end
        W->>DB: INSERT run_steps (status, output)
    end
    W->>DB: UPDATE runs SET status=succeeded
    W->>DB: INSERT usage_events (metering)
    W-->>U: run completed
    U->>API: GET /api/v1/runs/:id/steps
    API-->>U: step table with outputs
```

## Data model

Seven migrations build the schema (`apps/server/src/db/migrations/001_init_schema.sql` through `007_oidc_providers_enabled.sql`). Core entities:

```mermaid
erDiagram
    users ||--o{ workspace_members : "belongs to"
    workspaces ||--o{ workspace_members : "has"
    workspaces ||--o{ workflows : "owns"
    workspaces ||--o{ subscriptions : "has"
    workspaces ||--o{ audit_events : "logs"
    workflows ||--o{ workflow_versions : "versioned"
    workflows ||--o{ runs : "executed as"
    workflows ||--o{ triggers : "has"
    runs ||--o{ run_steps : "records"
    runs ||--o{ approval_tasks : "may wait on"
    workspaces ||--o{ credentials : "stores"
    workspaces ||--o{ api_tokens : "issues"
    workspaces ||--o{ ip_allowlist : "restricts"

    users {
        uuid id PK
        text email UK
        text password_hash
        text name
        timestamptz created_at
        timestamptz last_login_at
    }
    workspaces {
        uuid id PK
        text name
        text plan_id
        text api_secret
        text slug UK
        bool is_enabled
        timestamptz deleted_at
    }
    workspace_members {
        uuid workspace_id FK
        uuid user_id FK
        text role "owner|admin|member|viewer"
    }
    workflows {
        uuid id PK
        uuid workspace_id FK
        text name
        text slug UK
        uuid current_version_id "FK → workflow_versions"
        bool is_enabled
    }
    workflow_versions {
        uuid id PK
        uuid workflow_id FK
        int version_num
        text manifest_yaml
        bool is_current
    }
    runs {
        uuid id PK
        uuid workspace_id FK
        uuid workflow_id FK
        uuid workflow_version_id "frozen at creation"
        text status "queued|running|waiting|paused|succeeded|failed|canceled"
        jsonb state "inputs + engine cursor"
        text idempotency_key
        timestamptz created_at
        timestamptz finished_at
        timestamptz timeout_at
    }
    run_steps {
        uuid id PK
        uuid run_id FK
        text step_id
        text step_path "recursive (e.g. loop[0].child)"
        int attempt
        int iteration
        text status
        jsonb output
    }
    triggers {
        uuid id PK
        uuid workflow_id FK
        text type "schedule|webhook|event"
        jsonb config
        bool is_enabled
        timestamptz next_fire_at
    }
    approval_tasks {
        uuid id PK
        uuid run_id FK
        text step_id
        text step_path
        text prompt
        text status "pending|approved|rejected|canceled"
        timestamptz timeout_at
    }
    credentials {
        uuid id PK
        uuid workspace_id FK
        text name
        text type
        text value_enc "AES-256-GCM ciphertext"
        text nonce
        text key_version
    }
    audit_events {
        uuid id PK
        uuid workspace_id FK
        bigint sequence_num "UK with workspace_id"
        uuid actor_id "FK → users"
        text action
        text entity_type
        text entity_id
        jsonb metadata
        text prev_hash "hash chain link"
        text hash
    }
    subscriptions {
        uuid id PK
        uuid workspace_id FK
        text plan_id "FK → plans (authoritative)"
        text status
        timestamptz current_period_start
        timestamptz current_period_end
        int runs_consumed
    }
    api_tokens {
        uuid id PK
        uuid workspace_id FK
        uuid user_id FK
        text token_hash "SHA-256"
        timestamptz last_used_at
        timestamptz revoked_at
    }
```

Key design points:
- **Workflows are versioned.** Creating or editing a workflow writes a new `workflow_versions` row; the active version is the one referenced by `current_version_id` (switched via `POST /workflows/:id/promote/:versionId`). In-flight runs stay on the version they started with.
- **Runs are immutable history.** `run_steps` are append-only (one row per `(run_id, step_path, attempt)`); a run's outcome is reconstructable from its rows.
- **Audit is a hash chain.** Each `audit_events` row carries `prev_hash` + `hash`; `GET /audit/verify` walks the chain to detect tampering and reports `truncated: true` + `anchor_sequence_num` after a retention purge (a shortened chain verifies from its anchor forward; `sequence_num` never resets).
- **Credentials are encrypted at rest.** AES-256-GCM via `FF_VAULT_KEY`; only ciphertext is stored.

## Key design decisions

1. **Manifest-first, not visual-first.** The canonical artifact is a YAML file. The visual editor edits the same YAML. This makes `forge push`/`pull` and one-click export trivially correct — there is no second representation to drift.
2. **Two auth planes.** A pre-workspace session (after login, before workspace selection) can only reach `/auth/me`, `/auth/select-workspace`, `/workspaces` (create/list), and logout. Every workspace-scoped route rejects it with `workspace_not_selected`. This enforces workspace isolation at the middleware boundary.
3. **One execution path, two deployment modes.** The BullMQ consumer is the same code in embedded and standalone mode. The scheduler tick is Redis-lock serialized so the server's ticker and the worker's ticker never double-fire.
4. **Entitlements gate at the run boundary and the feature boundary.** Plan limits (run cap, concurrency) are checked in the manual trigger (`runs.ts`) and the scheduler — a disabled or over-limit trigger returns a typed `429` / `403` before any work starts. Feature flags (`credential_vault`, `audit_log`, `manual_approval`) are enforced by the `requireFeature` middleware on the credentials/audit/approvals routes AND inside the step executors (vault secrets/credential references and approval steps fail with `plan_feature_required` on plans that lack them). Entitlement checks are cached in Redis for 5 minutes and fail closed on Redis outage (§3.3). OIDC provider management is hard-gated to the Studio plan at the route (`oidc.ts:76-83`). The SPA renders those pages on every plan; the server is the enforcement boundary — see [API reference](API.md) for the per-route enforcement status.
5. **Crash recovery via durable state.** Runs, steps, and the queue are persisted. A restart rehydrates in-flight runs from their last-persisted step; the run state machine (`queued → running → waiting → running → succeeded`) drives resumption.

## Deployment / runtime model

- **Local development:** `npm run build` then `node apps/server/dist/index.js` against local Postgres + Redis. The CLI's `forge run --demo` needs neither — it spins an in-process demo HTTP server and uses the in-memory storage adapter.
- **Docker:** a multi-stage `Dockerfile` builds TypeScript + the SPA, then runs as a non-root user (`flowforge`, uid 10001). The default `CMD` is the single-process server entrypoint (`node apps/server/dist/index.js`), which performs its own initialization every start — migrations + plans + system jobs, plus the demo workspace gated internally on `FF_SEED_DEMO=1` — then serves on port 8080. Health check polls `/healthz` every 10s.
- **Standalone worker:** `node apps/worker/dist/index.js` — needs `FF_DATABASE_URL` + `FF_REDIS_URL`; exposes `/healthz` + `/readyz` on `FF_WORKER_PORT` (default 8081). Run alongside the API server when `FF_WORKER_MODE=standalone`.

See [Operations](OPERATIONS.md) for the full environment-variable table and deployment commands.
