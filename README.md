<div align="center">

# FlowForge Open

**Workflow automation for freelancers and micro-agencies, with every workflow kept as a YAML file you own.**

FlowForge turns the chores every small agency repeats into versioned YAML workflows: chasing unpaid invoices, onboarding clients, following up on orders, asking for reviews, reminding about renewals. An engine runs them on a schedule, from a webhook or on demand, pauses for a human where one is needed, and keeps a hash-chained audit trail of everything it did.

![Node 22](https://img.shields.io/badge/node-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Fastify%20·%20React%2018-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Tests](https://img.shields.io/badge/tests-557%20passing-2ea44f)
![Browser journeys](https://img.shields.io/badge/browser%20journeys-14%2F14-2ea44f)
![Built by Sneferu SOD](https://img.shields.io/badge/built%20by-Sneferu%20SOD-0f5c4d)

<img src="docs/screenshots/dashboard.png" alt="The FlowForge dashboard for the demo workspace Acme Creative: 11 workflows, 6 runs, 1 pending approval; recent runs of Invoice Chaser, Renewal Reminder, Client Onboarding, Order Follow-Up (paused) and Review Request; run usage and runs per day" width="880">

<sub>A fresh demo workspace after running each of the five templates, plus one Invoice Chaser run that needed approval. Order Follow-Up is waiting for a person: one demo order is stalled past its threshold, and the workflow asks before escalating it to a call.</sub>

</div>

---

**FlowForge Open is the first showcase product of [Sneferu's Software On Demand](https://sneferu.ai).** A written request went in; this working product came back, specified, built, tested and delivered by Sneferu. See [How it was made](#how-it-was-made).

## What it does

A workflow is a YAML manifest. It declares its triggers (schedule, webhook, event or manual), its inputs, and a list of steps. The step types are `http`, `notify`, `condition`, `delay`, `transform`, `for_each`, `log`, `reply` and `manual_approval`. Runs are stored in PostgreSQL and can be followed step by step. A run paused for approval picks up where it left off after a server restart.

Five templates come ready to run: **Invoice Chaser**, **Client Onboarding**, **Order Follow-Up**, **Review Request** and **Renewal Reminder**. They run against built-in demo services, so every one of them works on a fresh install without any outside accounts.

<div align="center">
<img src="docs/screenshots/templates.png" alt="The Templates page: Invoice Chaser, Client Onboarding, Order Follow-Up, Review Request and Renewal Reminder, each with a one-line description and a Use template button" width="430">
&nbsp;
<img src="docs/screenshots/manifest-editor.png" alt="The Invoice Chaser workflow open in the manifest editor: YAML on the left, a step diagram on the right, with Validate and Save version buttons" width="430">
<br><sub>Pick a template, or edit the YAML directly. Saving creates a draft version, and nothing changes until you promote it.</sub>
</div>

<div align="center">
<img src="docs/screenshots/run-approval.png" alt="A paused Invoice Chaser run: 'Approval required — Approve escalation email for invoice INV-0990 (45 days overdue)?' with Approve and Reject buttons above the step list" width="430">
&nbsp;
<img src="docs/screenshots/audit-log.png" alt="The Audit Log: 'Chain verified · 24 events', append-only SHA-256 hash-chained records of runs, approvals, workflow updates and logins" width="430">
<br><sub>Left: an invoice 45 days overdue stops the run until a person approves the escalation email. Right: every action lands in an append-only, SHA-256 hash-chained audit log that verifies itself.</sub>
</div>

It also covers the hosted-service basics: workspaces with roles, an encrypted credential vault, a per-workspace allowlist of hosts a workflow may call, API tokens, OIDC single sign-on, plan limits and metered runs, and an OpenAPI 3.1 document at `/openapi.json`. The `forge` command-line tool validates and runs manifests locally, and pushes and pulls them to a server.

## Run it

You need Node.js 22. The server also needs PostgreSQL 16 and Redis. The command-line tool needs neither.

```bash
npm ci
npm run build
npm test                 # 549 pass; 8 more need a database (set FF_DATABASE_URL to run all 557)

# Run a workflow locally against the built-in demo server, no database needed:
node apps/cli/dist/index.js run workflows/invoice-chaser.ff.yaml --demo
```

Start the web app and API:

```bash
export FF_DATABASE_URL="postgres://user:pass@localhost:5432/flowforge"
export FF_REDIS_URL="redis://localhost:6379"
export FF_SESSION_SECRET="$(openssl rand -hex 32)"
export FF_VAULT_KEY="$(openssl rand -base64 32)"
export FF_APP_URL="http://localhost:8080"
export FF_SEED_DEMO=true
node apps/server/dist/index.js      # migrates, seeds the demo workspace, serves http://localhost:8080
```

Sign in with the demo account shown on the login page (`demo@acme.test` / `demo-pass-2026`). The browser journeys run with `npm run test:e2e`. They start their own server when `FF_DATABASE_URL` and `FF_REDIS_URL` are set, and need Playwright's Chromium (`npx playwright install chromium`).

For the full walkthrough, see the product's own [quick start](QUICKSTART.md), written during the build. The [user guide](docs/USER_GUIDE.md), [architecture](docs/ARCHITECTURE.md), [API and CLI reference](docs/API.md), [UI guide](docs/UI.md) and [operations guide](docs/OPERATIONS.md) are in `docs/`.

## What's in the box

| Path | What |
|---|---|
| `apps/server` | Fastify API, the web app, scheduler, webhooks, demo services and the built-in job runner |
| `apps/web` | React 18 single-page app (Vite 6, Tailwind 4) |
| `apps/worker` | optional standalone job runner (BullMQ) for scaling run execution separately |
| `apps/cli` | the `forge` command-line tool |
| `packages/engine`, `packages/shared` | manifest schema, expression language, step executors; plans, roles, error codes |
| `workflows/`, `examples/` | the sample Invoice Chaser manifest and four more runnable examples |
| `tests/` | unit, integration and Playwright browser tests (the 14 journeys are listed in `test_plan.md`) |
| `problem_statement.md`, `SOUL.md`, `DESIGN.md` | the product specification, the design brief and the design system the build followed |
| `docs/sod-release/` | Sneferu's release record: manifest, evidence, limitations and the delivery notes |
| `AGENTS.md` | a note left behind by the build's coding tool; not part of the product |

## Status, honestly

**Checked while preparing this repository (Sep 24, 2026):**

- A clean install and build succeeded, and all **557 of 557** unit and integration tests passed against a real PostgreSQL 16 and Redis.
- All **14 of 14** Playwright browser journeys passed against the app running from source.
- The command-line demo run completed, and all five templates ran from the gallery.
- A run paused for approval survived a server restart and finished once it was approved.

**Known issues:**

- **Sneferu's Docker delivery has a job-runner bug.** It isn't in this repository, but its record is in `docs/sod-release/`.
  - Started from its exact images, it was ready in about 20 seconds and passed 13 of the 14 journeys.
  - It runs two job runners on the same queue: the app's built-in one and a separate worker container. The worker isn't given the app's address, so runs it picks up fail with `host_not_allowed`. That happened to 2 of 3 runs in our test.
  - Running from source, as above, uses one process and is not affected. The fix will come through Sneferu as a new release.
- **Signing in needs HTTPS or localhost.** In production mode the session cookie is marked secure. Over plain http from another address, signing in silently lands back on the login page.
  - Sneferu's own launch check browsed from such an address. That is where the 12 "limitations" recorded in its release come from.
- **The editor's step diagram can leave steps out.** It reads the YAML with a simple pattern, and for Invoice Chaser it shows `fetch_overdue → log_completion` without the `per_invoice` loop between them. The run itself is unaffected.
- **Run now can return the previous run.** Manual runs are de-duplicated in 10-second windows by workflow and inputs, not by version. If you click Run now again within 10 seconds, even after promoting a new version, you get the earlier run back.

**Runtime link to Sneferu:** none. Sneferu built FlowForge, and FlowForge runs entirely on its own.

## How it was made

FlowForge Open was built by **Software On Demand (SOD)**, Sneferu's product line for turning a request into a running application.

- **The request and the specification.** The request became a specification that rival models argued out: [`problem_statement.md`](problem_statement.md), with its design brief in [`SOUL.md`](SOUL.md). It is candid about positioning. It names n8n, Windmill, Activepieces and Zapier, claims no technical novelty, and bets only on the freelancer segment and its five templates.
- **The build.** Sneferu's coders built against that specification until it passed. SOD then tested the result, installed it on a clean machine, and ran it in a preview where the customer tried it before accepting.
- **The release.** The accepted release is `rel-1af5d44f6b78174ed7fa6955` (version 1, Sep 24, 2026).
  - 220 files, each bound by a SHA-256 hash in [`RELEASE_MANIFEST.json`](docs/sod-release/RELEASE_MANIFEST.json).
  - Release evidence of passing automated tests, browser and runtime phases in [`evidence.json`](docs/sod-release/evidence.json).
  - Its recorded limitations in [`LIMITATIONS.json`](docs/sod-release/LIMITATIONS.json).

This repository is that release's source, and every source file in it matches the release manifest's SHA-256 hash. There are only two differences. The release's original README is now [`QUICKSTART.md`](QUICKSTART.md), so this page can sit on top. And build leftovers the release carried (a test-results file and five TypeScript build caches) are not included.

## Built by Sneferu

These are the SOD screens that make products like this one.

<div align="center">
<img src="docs/screenshots/sneferu-sod-preview.webp" alt="Sneferu Software On Demand, Preview & Test for the project 'FlowForge Open — Product Specification': the FlowForge Open API explorer (OpenAPI 3.1, Apache-2.0) served from the project's own preview host" width="860">
<br><sub>FlowForge itself in SOD's Preview & Test: the working application on its own host, serving its own API explorer, before it was accepted.</sub>
</div>

<div align="center">
<img src="docs/screenshots/sneferu-sod-blooms.webp" alt="SOD Public Blooms: the 'FlowForge Open — Product Specification' bloom, 177 ideas explored, scored and pruned to three, with a Build this idea button" width="860">
<br><sub>FlowForge's specification was also published as a public idea bloom: 177 directions explored, scored and pruned to three. Any of them can start a new build.</sub>
</div>

<div align="center">
<img src="docs/screenshots/sneferu-sod-build.webp" alt="SOD's Build form: the product request, how hard Sneferu argues the plan, the starting point, the planning team and the coders, with the build plan and 'Create project and review exact quote'" width="430">
&nbsp;
<img src="docs/screenshots/sneferu-sod-spec.webp" alt="An approved SOD specification: revision v1, run id, SHA-256 and status Approved, with its own table of contents" width="430">
<br><sub>Left: one form, before any money moves. You describe the product, choose how hard the models argue the plan and pick the coders, and the quote and spending ceiling come first. Right: an approved specification, versioned and hashed. Nothing is coded until you've read it and said yes.</sub>
</div>

<p align="center"><b><a href="https://sneferu.ai">See Software On Demand at sneferu.ai →</a></b></p>

<div align="center">

---

**Built by [Sneferu](https://sneferu.ai)**

<sub>README by Claude (Anthropic). App screenshots are from a fresh demo workspace running this source. SOD screenshots are from sneferu.ai.</sub>

</div>
