


<div align="center">


<div align="center">
<img width="207" height="98" alt="image" src="https://github.com/user-attachments/assets/a25bb0ec-6ae2-4bc6-a6af-9ee5c5eb9980" />
&nbsp;

</div>

**Workflow automation for freelancers and micro-agencies, with every workflow kept as a YAML file you own.**

<a href="https://sneferu.ai" class="brand" href="#top" aria-label="Sneferu home"><img src="https://github.com/user-attachments/assets/436aaac6-d48b-440d-bc58-38b14a209583" width="180px" alt="Sneferu"></a>

FlowForge turns the chores every small agency repeats into versioned YAML workflows: chasing unpaid invoices, onboarding clients, following up on orders, asking for reviews, reminding about renewals. An engine runs them on a schedule, from a webhook or on demand, pauses for a human where one is needed, and keeps a hash-chained audit trail of everything it did. read the [product spec](flowforge-open-product-specification-specification.md)

![Node 22](https://img.shields.io/badge/node-22-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Fastify%20·%20React%2018-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Tests](https://img.shields.io/badge/tests-557%20passing-2ea44f)
![Browser journeys](https://img.shields.io/badge/browser%20journeys-14%2F14-2ea44f)
![Built by Sneferu SOD](https://img.shields.io/badge/built%20by-Sneferu%20SOD-0f5c4d)

<img src="docs/screenshots/dashboard.png" alt="The FlowForge dashboard for the demo workspace Acme Creative: 11 workflows, 6 runs, 1 pending approval; recent runs of Invoice Chaser, Renewal Reminder, Client Onboarding, Order Follow-Up (paused) and Review Request; run usage and runs per day" width="880">

<sub>A fresh demo workspace after running each of the five templates, plus one Invoice Chaser run that needed approval. Order Follow-Up is waiting for a person: one demo order is stalled past its threshold, and the workflow asks before escalating it to a call.</sub>

</div>



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

It also covers the hosted-service basics: 

- workspaces with roles,
- an encrypted credential vault,
- a per-workspace allowlist of hosts a workflow may call,
- API tokens,
- OIDC single sign-on,
- plan limits and metered runs,
- and an OpenAPI 3.1 document at `/openapi.json`.
- The `forge` command-line tool validates and runs manifests locally, and pushes and pulls them to a server.

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

For the full walkthrough, see the product's own 
- [Product Spec](flowforge-open-product-specification-specification.md)
- [quick start](QUICKSTART.md)
- [user guide](docs/USER_GUIDE.md)
- [architecture](docs/ARCHITECTURE.md)
- [API and CLI reference](docs/API.md)
- [UI guide](docs/UI.md) and
- [operations guide](docs/OPERATIONS.md) are in `docs/`.

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

**Runtime link to Sneferu:** none. Sneferu built FlowForge, and FlowForge runs entirely on its own.


## Built by Sneferu Software on Demand

<div align="center">
<img src="docs/screenshots/sneferu-sod-build.webp" alt="SOD's Build form: the product request, how hard Sneferu argues the plan, the starting point, the planning team and the coders, with the build plan and 'Create project and review exact quote'" width="860">
&nbsp;

<sub>Left: one form, before any money moves. You describe the product pick your model cast and let it rip.</sub>
</div>

<div align="center">
<img src="docs/screenshots/sneferu-sod-blooms.webp" alt="SOD Public Blooms: the 'FlowForge Open — Product Specification' bloom, 177 ideas explored, scored and pruned to three, with a Build this idea button" width="860">
<br><sub>FlowForge's specification was also published as a public idea bloom: 177 directions explored, scored and pruned to three. Any of them can start a new build.</sub>
</div>

<div align="center">
<img src="docs/screenshots/sneferu-sod-preview.webp" alt="Sneferu Software On Demand, Preview & Test for the project 'FlowForge Open — Product Specification': the FlowForge Open API explorer (OpenAPI 3.1, Apache-2.0) served from the project's own preview host" width="860">
<br><sub>FlowForge itself in SOD's Preview & Test: the working application on its own host, serving its own API explorer, before it was accepted.</sub>
</div>

<div align="center">


builder:

<a href="https://sneferu.ai" class="brand" href="#top" aria-label="Sneferu home"><img src="https://github.com/user-attachments/assets/436aaac6-d48b-440d-bc58-38b14a209583" width="220px" alt="Sneferu"></a>


</div>
