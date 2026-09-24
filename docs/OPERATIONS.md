# FlowForge Open — Operations

Run, deploy, observe, and debug FlowForge Open. Audience: the operator keeping it running.

---

## Prerequisites

| Dependency | Version | Why |
|---|---|---|
| **Node.js** | 22+ | Runtime. `package.json` declares `@types/node ^22` and `engines.node >= 22`; the Dockerfile pins `node:22-bookworm-slim`. |
| **npm** | 10+ | Workspace install + build scripts. |
| **PostgreSQL** | 16 | The supported data plane (product spec commitment). Holds runs, workflows, audit, credentials, usage. |
| **Redis** | 7.4 | The supported queue plane. BullMQ queue, scheduler locks, OIDC state store. |

The CLI (`forge validate`, `forge run --demo`) and the Vitest suite need **only Node.js**.

## Runtime versions

Discoverable from `package.json` and `Dockerfile`:
- Node 22 (`engines.node >= 22`; Dockerfile pins `node:22-bookworm-slim@sha256:48e4b67d...`).
- TypeScript 5.7, Vite 6, Vitest 2.1, Fastify 5, React 18, Tailwind 4, BullMQ 5.

## Environment variables

All are read via `process.env.*` in `apps/server/src/` and `apps/worker/src/`. Source of truth: `apps/server/src/index.ts`, `apps/server/src/db/pool.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/crypto.ts`, `apps/worker/src/index.ts`, `apps/cli/src/index.ts`.

| Variable | Purpose | Required? | How to obtain | Example |
|---|---|---|---|---|
| `FF_DATABASE_URL` | Postgres connection string | **Yes** (server + worker) | Your Postgres instance | `postgres://user:pass@localhost:5432/flowforge` |
| `FF_REDIS_URL` | Redis connection string | **Yes** (server + worker; defaults to `redis://localhost:6379` when unset — set it explicitly in any multi-host deployment) | Your Redis instance | `redis://localhost:6379` |
| `FF_SESSION_SECRET` | HMAC key for session + CSRF tokens | **Yes** (auto-generated at first start and persisted under `SOD_DATA_DIR` when unset) | Generate 32+ random bytes | `openssl rand -hex 32` |
| `FF_VAULT_KEY` | Master key for credential vault encryption (HKDF-SHA256 per-workspace data keys) | **Yes** when vault used (auto-generated + persisted under `SOD_DATA_DIR` when unset) | 32-byte base64 or hex string | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `FF_ENCRYPTION_KEY` | Compatibility alias for `FF_VAULT_KEY` (same role; `FF_VAULT_KEY` takes precedence) | No | — | — |
| `FF_VAULT_KEY_VERSION` | Vault key version id (for key rotation; `FF_VAULT_KEY_OLD` holds the previous key during rotation) | No | Operator-assigned | `1` |
| `FF_APP_URL` | Base URL the server advertises (OIDC redirects, `{{ env.FF_APP_URL }}` in manifests) | **Yes** | Your external URL | `http://localhost:8080` |
| `FF_PORT` | Server listen port | No (default `8080`) | — | `8080` |
| `PORT` | Fallback port (after `FF_PORT`) | No | — | `8080` |
| `HOST` | Bind address | No (default `0.0.0.0`) | — | `0.0.0.0` |
| `FF_SEED_DEMO` | Seed the demo workspace + data on start (`1`/`true`) | No | — | `0` (off) |
| `FF_WORKER_MODE` | `embedded` (consumer in-process) or `standalone` | No (default `embedded`) | — | `embedded` |
| `FF_WORKER_CONCURRENCY` | BullMQ consumer concurrency | No (default `4`) | — | `4` |
| `FF_WORKER_PORT` | Standalone worker health port | No (default `8081`) | — | `8081` |
| `FF_OIDC_SIGNING_KEY` | 32-byte base64 symmetric key for the mock HS256 IdP | Yes when OIDC enabled (auto-generated + persisted under `SOD_DATA_DIR` when unset) | Generate 32 bytes | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SOD_DATA_DIR` | Durable data directory; generated secrets persist here (`flowforge-secrets.json`, mode 0600) | No (without it secrets are ephemeral per process) | A volume/dir writable by the runtime user (`flowforge`, uid 10001) | `/data` |
| `FF_CONNECTOR_URL` | External connector URL | No | — | — |
| `FF_CONNECTOR_TOKEN` | External connector auth token | No | — | — |
| `FF_HTTP_ALLOWLIST` | Egress host allowlist for `http` steps | No | Comma-separated hosts | `api.stripe.com,api.github.com` |
| `FF_TRUST_PROXY` | Trust `X-Forwarded-*` headers (behind a proxy) | No | — | `true` |
| `FF_DEMO_EMAIL` | Override the demo user email (seeder) | No (default `demo@acme.test`) | — | `admin@myorg.test` |
| `FF_DEMO_PASSWORD` | Override the demo user password (seeder) | No (default `demo-pass-2026`) | — | — |
| `FLOWFORGE_CONFIG_DIR` | CLI credentials directory | No (default `~/.flowforge`) | — | `~/.flowforge-prod` |
| `NODE_ENV` | Node environment (`production` sets `secure` cookies) | No | — | `production` |

**Port precedence** (`apps/server/src/index.ts:96-112`): `--port` CLI flag > `FF_PORT` > `PORT` > `8080`.

## Running locally

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

Compiles TypeScript (`tsc -b --force` — a deterministic full rebuild so stale incremental caches can never produce a broken or partial `dist/`), builds the SPA (`vite build`), copies static assets + migrations into `apps/server/dist/`.

### Seed the database

```bash
node apps/server/dist/db/seed.js all
```

Targets: `all` (everything below), `migrate` (migrations only), `plans` (5 plan rows), `jobs` (7 system jobs: billing period close, retention purge, approval timeout check, concurrency retry, replay-log cleanup, reconciliation, notification dispatch), `demo` (demo workspace + user + sample workflows — gated on `FF_SEED_DEMO=1`/`true`). `seed.js all` also runs migrations itself, so a fresh database needs nothing else before the server starts. Seeding is idempotent — a partially-seeded database self-heals on the next run.

### Start the server

```bash
export FF_DATABASE_URL="postgres://user:pass@localhost:5432/flowforge"
export FF_REDIS_URL="redis://localhost:6379"
export FF_SESSION_SECRET="$(openssl rand -hex 32)"
export FF_VAULT_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
export FF_APP_URL="http://localhost:8080"
export FF_SEED_DEMO=1

node apps/server/dist/db/seed.js all
node apps/server/dist/index.js
```

### What success looks like

```
Migrations: 9 applied, 0 skipped
Seeded 5 plans
Seeded 7 system jobs
Seeded demo workspace: <uuid>
Demo user: demo@acme.test
Server listening on 0.0.0.0:8080
```

Proof:

```bash
curl http://localhost:8080/healthz
# {"status":"ok","timestamp":"..."}

curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@acme.test","password":"demo-pass-2026"}'
# 200 + Set-Cookie: ff_session=...
```

Open http://localhost:8080 and sign in.

### Run the tests

```bash
npm test
```

Verified result: **476 tests pass across 33 files** (Vitest). For browser e2e (`npx playwright test --reporter=list`, 14 journeys):

```bash
npx playwright test --reporter=list
```

### Start the standalone worker (optional)

```bash
export FF_DATABASE_URL="postgres://..."
export FF_WORKER_MODE=standalone   # set this on the API server process
node apps/worker/dist/index.js
# [worker] health endpoints on :8081
# [worker] BullMQ consumer + scheduler + outbox dispatcher started
```

`FF_WORKER_MODE` is read by the **API server**: with `standalone` it stops running its own BullMQ consumer and outbox dispatcher. The worker process itself always runs the consumer, scheduler tick, and outbox dispatcher (the scheduler tick is Redis-lock serialized so both processes can tick safely). Keep the API server running for HTTP ingress and the worker running for run execution. Worker health endpoints (`/healthz`, `/readyz`) listen on `FF_WORKER_PORT` (default 8081).

## Deployment

### Docker (the primary path)

The `Dockerfile` is a multi-stage build: compile TypeScript + SPA, then run as non-root (`flowforge`, uid 10001) on port 8080.

```bash
docker build -t flowforge-open .
docker run -p 8080:8080 \
  -e FF_DATABASE_URL="postgres://user:pass@host:5432/flowforge" \
  -e FF_REDIS_URL="redis://host:6379" \
  -e FF_APP_URL="https://flowforge.example.com" \
  -v /srv/flowforge:/data \
  -e SOD_DATA_DIR=/data \
  flowforge-open
```

The `FF_VAULT_KEY` / `FF_SESSION_SECRET` / `FF_OIDC_SIGNING_KEY` secrets are **generated at first start and persisted under `SOD_DATA_DIR`** (`flowforge-secrets.json`, mode 0600) when the environment does not provide them — mount a durable volume so encrypted data stays decryptable across restarts. Setting any of them explicitly wins over generation.

The default `CMD` is the single-process entrypoint `node apps/server/dist/index.js` — migrations + plans + system jobs seed on **every** start; demo data seeds only when `FF_SEED_DEMO=1`/`true` is set explicitly (add `-e FF_SEED_DEMO=1` to the run above to see the demo workspace; the default is off). The CLI initializer `node apps/server/dist/db/seed.js all` performs the same pass standalone.

The `HEALTHCHECK` polls `/healthz` every 10s (3 retries, 5s timeout).

### Production considerations

- **Demo seeding is opt-in** (`FF_SEED_DEMO` defaults to off, `0`) — only set `1`/`true` when the demo workspace/user are wanted; the demo password must then be overridden from its known default. Sneferu deployments receive `FF_SEED_DEMO`, `FF_DEMO_EMAIL`, and `FF_DEMO_PASSWORD` automatically: `packaging.json` declares them under top-level `env_defaults`, which the Sneferu runtime injects on every run lane (launch proof, preview, workers, and the delivered installation's `runtime-defaults.env`; overridable in `product.env`).
- **Change the demo credentials** if you keep demo on: set `FF_DEMO_EMAIL` and `FF_DEMO_PASSWORD`. The seeder re-asserts both on every boot (the password hash is reconciled verify-then-update; membership is restored to `role='owner'`). **If `FF_DEMO_EMAIL` is rotated, the old demo user retains workspace owner access until an operator manually revokes the old user's membership** (Workspace → Members); the new email creates a fresh owner account.
- **When demo seeding is enabled the credentials are public by design**: they are displayed on the login page and returned by `GET /demo/credentials`. Never enable demo seeding in production or internet-exposed environments.
- **Put it behind TLS.** Set `FF_APP_URL` to the external HTTPS URL and `FF_TRUST_PROXY=true` if behind a reverse proxy so `secure` cookies and `X-Forwarded-*` work.
- **Run the standalone worker** as a separate deployment when run execution needs to scale independently of API load (`FF_WORKER_MODE=standalone`).
- **Postgres + Redis** must be reachable from both the API server and any standalone workers.

### No other deployment path is defined

There is no Kubernetes manifest, Terraform, or serverless config in the repository. The Docker image + a Postgres/Redis pair is the supported deployment. For bare-metal, run the two Node processes (`index.js` + optional `worker/index.js`) under a process manager (systemd, pm2) with the env vars above.

## Observability

### Logs

The server and worker write to **stdout/stderr** (console). There is no structured-logging framework — look for `[scheduler]`, `[worker]`, and route-level output. Run-level execution detail is persisted in the database (`runs`, `run_steps`, `audit_events`, `usage_events`), not in log files.

- **Run inspection:** `GET /api/v1/runs/:id/steps` or the Runs page in the SPA.
- **Audit trail:** `GET /api/v1/audit` (Pro+) with chain verification at `GET /api/v1/audit/verify`.
- **CLI:** `forge logs <runId>` prints the step table for a hosted run.

### Health checks

| Endpoint | Checks | Healthy | Unhealthy |
|---|---|---|---|
| `GET /healthz` | Postgres `SELECT 1` | `200 {"status":"ok","timestamp":...}` | `200 {"status":"degraded","timestamp":...}` (always 200 — liveness only) |
| `GET /readyz` | Postgres + migrations + Redis | `200 {"status":"ok","checks":{"postgres":true,"migrations":true,"redis":true}}` | `503 {"status":"not_ready","checks":{...}}` with failing checks flagged `false` |
| `GET /health` | Alias of `/healthz` (packaging harness) | `200` | — |

The server also applies migrations at startup (before serving). The Docker `HEALTHCHECK` uses `/healthz`. Use `/readyz` for load-balancer readiness (it fails when Redis or the migration marker is down, which breaks scheduling and OIDC).

### Metrics / traces

There is no Prometheus/OpenTelemetry instrumentation in the repository. Usage metering lives in `usage_events` (one row per billed run) and is exposed via `GET /api/v1/usage`.

### The two interval system jobs

The `system_jobs` table is the schedule of record for the two long-interval jobs; the scheduler tick dispatches due rows to the `forge-scheduler` BullMQ queue and either the embedded server or the standalone worker executes them (3 retries, 30s backoff, `system_job.failed` audit event after exhaustion).

- **`billing_period_close`** (1st of month 00:00 UTC) — for every active subscription whose period has ended: inserts the `invoices` row (plan base + overage runs × overage rate, `status = 'open'`), then rolls the subscription to the next 30-day period with `runs_consumed = 0`. Overage exists only on soft-threshold plans (Pro 3¢/run beyond 10,000; Studio 15¢/run beyond 50,000); Free (hard cap, no overage) and Community/Demo (unlimited) always invoice zero overage.
- **`retention_purge`** (daily 02:00 UTC) — deletes `audit_events` older than the workspace plan's `audit_retention_days` and `runs` older than `run_history_days` (steps/events/approvals cascade; `usage_events` are permanent), deletes `notifications` older than 30 days, and recomputes `usage_daily` from `usage_events`. After a purge, `GET /api/v1/audit/verify` reports `truncated: true` with `anchor_sequence_num` = the oldest retained event; the chain verifies from that anchor forward.

The five short-interval jobs (approval timeout check, concurrency retry, replay-log cleanup, reconciliation, notification dispatch) run directly on the scheduler tick or the outbox dispatcher and do not travel through the queue.

Advancing these jobs for testing (e.g. forcing a period close):

```bash
# Below-cap invoice on the demo workspace — no overage rows are ever wrong here
UPDATE subscriptions SET current_period_end = now() - INTERVAL '1 hour' WHERE status = 'active';
UPDATE system_jobs SET next_run_at = now() WHERE job_type = 'billing_period_close';
```

## Troubleshooting

### 1. Server exits immediately: "FF_DATABASE_URL is required" or migration failure

**Diagnose:**
```bash
echo $FF_DATABASE_URL      # empty?
node -e "require('pg').Pool.prototype.connect.call(new (require('pg').Pool)({connectionString: process.env.FF_DATABASE_URL})).then(c => c.query('SELECT 1')).then(() => console.log('db ok')).catch(e => console.error('db fail:', e.message))"
```
**Fix:** set `FF_DATABASE_URL` to a reachable Postgres. Ensure the database exists (`CREATE DATABASE flowforge;`) and the user has `CREATE`/`USAGE` on it (migrations create tables/extensions including `pgcrypto`).

### 2. Login returns 503 or "readyz" reports `redis: false`, or gated features return 403 `plan_feature_required`

**Diagnose:**
```bash
redis-cli -u "$FF_REDIS_URL" ping    # expect PONG
```
**Fix:** start Redis, or fix `FF_REDIS_URL`. The scheduler and OIDC state both depend on Redis; without it the server starts but `/readyz` stays 503 and scheduling/OIDC login fail. The queue itself is ledger-backed through Postgres, but BullMQ requires Redis for the consumer. Plan-feature checks (`credential_vault`, `audit_log`, `manual_approval`) are Redis-cached and **fail closed** on outage (§3.3): credentials, audit, and approvals return `403 plan_feature_required` until Redis is reachable again — restore Redis and retry.

### 3. "403 csrf_token_invalid" on every POST from the SPA

**Diagnose:** the CSRF token in `sessionStorage` (`ff_csrf_token`) is stale or missing. This happens after a long idle period or a server restart that rotated the session.
**Fix:** refresh the page — the app fetches `/auth/me` on load, which returns the current `csrf_token` alongside the user. If it persists, sign out and back in. The token is `HMAC-SHA256(FF_SESSION_SECRET, session_token)[:32]`, so changing `FF_SESSION_SECRET` invalidates all existing tokens (restart required).

### 4. Manual trigger returns 429 run_limit_exceeded

**Diagnose:** the Free plan caps at 500 runs/month. Check current usage:
```bash
curl -b cookie.txt http://localhost:8080/api/v1/usage
```
**Fix:** upgrade the workspace plan via the API (`POST /api/v1/subscription` with a `plan_id` — the SPA has no plan-management page yet), or wait for the monthly counter to reset (it counts `usage_events` since `date_trunc('month', now())`).

### 5. A run is stuck in `waiting` forever

**Diagnose:** the run hit a `manual_approval` step. List pending approvals:
```bash
curl -b cookie.txt http://localhost:8080/api/v1/approvals
```
**Fix:** approve or reject the approval (`POST /api/v1/approvals/:id/approve` or the run's **Approval required** card on the run detail page — the SPA has no separate approvals screen). If the approval should auto-skip on timeout, the manifest's `manual_approval` config sets `on_timeout: skip` with a `timeout_seconds`.

### 6. Webhook trigger returns 401/403

**Diagnose:** the trigger's `auth_mode` decides validation. `hmac` requires a signature; `header` requires the configured header + secret; `none` requires nothing.
**Fix:** match the trigger config. For `hmac`, send the HMAC signature in the header the trigger expects. For `header`, send the shared secret in `auth_header`. Check the trigger config via `GET /api/v1/workflows/:id/triggers`. An empty secret returns a `validation_error` at create time.

### 7. SPA shows "Frontend not built"

**Diagnose:** `apps/server/dist/web/` is missing — `npm run build` wasn't run or the copy step failed.
**Fix:** run `npm run build` (the `scripts/copy-static-assets.js` step copies `apps/web/dist` → `apps/server/dist/web`), then restart the server. The API at `/api/v1/*` still works without the SPA.

### 8. OIDC login fails with "OIDC state missing or expired"

**Diagnose:** the state token in Redis expired (600s TTL) or Redis was unavailable when the login started.
**Fix:** retry the login. If persistent, verify Redis is up (`/readyz`) and `FF_OIDC_SIGNING_KEY` is set. The built-in mock IdP at `/mock-idp/*` is for local testing only.

---

For the full API surface and the `forge` CLI, see [API & CLI reference](API.md).
For the system design, see [Architecture](ARCHITECTURE.md).
