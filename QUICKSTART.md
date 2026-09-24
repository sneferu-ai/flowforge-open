# FlowForge Open

Open-source workflow automation for freelancers and micro-agencies. Convert repeatable client operations — chasing unpaid invoices, onboarding clients, following up on orders, requesting reviews, reminding about contract renewals — into versioned YAML workflow manifests that an engine executes on schedule, webhook, or manual trigger.

Everything in this repository is **Apache-2.0 licensed**. There is no proprietary component. The same engine and manifest format that power the hosted cloud run here, self-hosted, with zero lock-in: manifests export to plain YAML in one command.

> **Product guide for end users:** see [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for the full sign-in, run-a-workflow, and recovery walkthrough.

---

## Quick start

### Prerequisites

- **Node.js 22+** (the project targets the Node 22 runtime; `package.json` declares `@types/node ^22` and `engines.node >= 22`)
- **npm 10+** (ships with Node 22)
- **PostgreSQL 16** and **Redis 7.4** for the hosted API server (the supported data and queue planes per the product spec; see [Operations](docs/OPERATIONS.md))

The CLI and the in-memory local runner need **only Node.js** — no database, no Redis.

### 1. Install

```bash
npm install
```

This is an npm workspace repo (`packages/*` + `apps/*`). One install at the root hydrates every package.

### 2. Build

```bash
npm run build
```

Compiles TypeScript (`tsc -b`), builds the React SPA (`vite build` under `apps/web`), and copies the SPA bundle + SQL migrations into `apps/server/dist/`. Verified output:

```
✓ 1955 modules transformed.
apps/web/dist/assets/index-blY4WpLJ.js   376.34 kB
copied apps/server/src/db/migrations → apps/server/dist/db/migrations
copied apps/web/dist → apps/server/dist/web
```

### 3. Test

```bash
npm test
```

Runs the Vitest suite. Verified result: **476 tests pass across 33 files** (engine schema/expression, CLI, OIDC crypto, mock IdP, queue, auth middleware, cron, pagination, routes, demo seed contract).

### 4. Prove the CLI works (no database needed)

Validate and run the sample workflow against a built-in demo server, end to end:

```bash
node apps/cli/dist/index.js validate workflows/invoice-chaser.ff.yaml
node apps/cli/dist/index.js run workflows/invoice-chaser.ff.yaml --demo
```

Expected output from `run --demo`:

```
Demo server on http://localhost:32768   (first available port in 32768–61000)
▶ Running "invoice-chaser" locally (3 steps, 0 inputs)
  ⤷ fetch_overdue: GET http://localhost:32768/api/v1/demo/invoices?status=overdue
       → HTTP 200
  ✉ send_reminder: email → billing@acme.test "Invoice INV-1042 — 17 days overdue"
  ✉ send_reminder: email → ap@northwind.test "Invoice INV-1027 — 27 days overdue"
  • log_completion: [info] Pursued 2 invoices
✓ Run completed (7 steps)
```

### 5. Start the hosted API + SPA (needs Postgres + Redis)

```bash
export FF_DATABASE_URL="postgres://user:pass@localhost:5432/flowforge"
export FF_REDIS_URL="redis://localhost:6379"
export FF_SESSION_SECRET="$(openssl rand -hex 32)"
export FF_VAULT_KEY="$(openssl rand -hex 32)"
export FF_APP_URL="http://localhost:8080"
export FF_SEED_DEMO=1
node apps/server/dist/index.js
```

The server initializes itself on start (migrations + plan/system-job seeding + the demo workspace when `FF_SEED_DEMO=1`). For a standalone
initialize-only pass, `node apps/server/dist/db/seed.js all` is available.

Open **http://localhost:8080**. Sign in with the seeded demo account:

- **Email:** `demo@acme.test`
- **Password:** `demo-pass-2026`
- **Workspace:** `Acme Creative` (slug `acme-creative`)

When demo seeding is enabled, the login page displays the configured demo credentials (email and password) in a panel above the sign-in form — the values always reflect the live `FF_DEMO_EMAIL` / `FF_DEMO_PASSWORD` configuration.

API documentation is available as an OpenAPI 3.1 document at `GET /openapi.json` (no auth, no envelope).

Proof step — the health check returns `{"status":"ok"}`:

```bash
curl http://localhost:8080/healthz
```

---

## What this project does

FlowForge Open turns recurring freelance/agency back-office tasks into **versioned YAML workflow manifests**. Each manifest declares triggers (schedule, webhook, event), inputs, and a sequence of steps (`http`, `notify`, `condition`, `delay`, `transform`, `for_each`, `log`, `reply`, `manual_approval`). The engine executes manifests durably — runs are persisted, crash-recoverable, and replayable step by step.

Five opinionated templates ship in the box: **Invoice Chaser**, **Client Onboarding**, **Order Follow-Up**, **Review Request**, **Renewal Reminder**.

## Why use it

- **You own the format.** Manifests are Apache-2.0 YAML. `forge export <id>` pulls a workflow back to a file; `forge push` puts it back. No lock-in.
- **It targets a real buyer.** The templates are pre-filled for the five workflows freelancers repeat every week — not a blank canvas.
- **The hosted path is safe to leave.** Revenue comes from managed infrastructure, SSO, audit retention, and support — the same model as Ghost, Plausible, and n8n Cloud. The engine is identical self-hosted and hosted.

## Common next steps

- Run a workflow from the template gallery: sign in → **Templates** → pick one → **Create workflow** → **Run now**.
- Run an example locally (no server needed): `node apps/cli/dist/index.js run examples/order-follow-up.ff.yaml --demo` — see [examples/](examples/README.md) for all four.
- Author a manifest: `node apps/cli/dist/index.js init my-workflow` then edit the generated `.ff.yaml`.
- Inspect runs: `node apps/cli/dist/index.js runs list` (after `forge login`).
- Full deployment with Docker: see [Operations](docs/OPERATIONS.md).

## Documentation

| Document | Audience | Contents |
|---|---|---|
| **[Product guide](docs/USER_GUIDE.md)** | End user | Sign in, run a workflow, view results, recover after restart |
| [Architecture](docs/ARCHITECTURE.md) | Engineer | C4 diagrams, components, data model, runtime topology |
| [API & CLI reference](docs/API.md) | Integrator | Every HTTP endpoint, the `forge` CLI, auth model, manifest format |
| [UI guide](docs/UI.md) | Designer / operator | SPA pages, routes, flows, states |
| [Operations](docs/OPERATIONS.md) | Operator | Env vars, local run, Docker deploy, health checks, troubleshooting |

## Repository layout

```
flowforge-open/
  apps/
    server/    Fastify API + static SPA + scheduler + webhooks + demo services
    worker/    Standalone BullMQ consumer + scheduler + outbox dispatcher
    web/       React 18 SPA (Vite 6 + Tailwind 4)
    cli/       `forge` CLI (commander)
  packages/
    engine/    Manifest schema (zod), expression evaluator, step executors
    shared/    Plan definitions, RBAC, error codes, audit event types
  workflows/   Sample manifests (invoice-chaser.ff.yaml)
  examples/    Four runnable workflow manifests (use `forge run --demo`)
  tests/       OIDC crypto + mock-IdP unit tests, Playwright e2e
  Dockerfile   Multi-stage image (build → non-root runtime, seeds demo on start)
```

## License

Apache-2.0. See `package.json` (`"license": "Apache-2.0"`).
