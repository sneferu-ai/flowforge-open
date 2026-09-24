# FlowForge Open — User Guide

This guide is for the person **using** FlowForge Open to automate client work. It covers signing in, creating a workflow from a template, running it, reading the results, and recovering after a restart. It does not cover installation or server administration — for that, see the [README](../README.md) and [Operations](OPERATIONS.md).

---

## What you are looking at

FlowForge Open is a workflow automation product. You pick a pre-built template (or write a YAML manifest), and the system runs it on a schedule, when a webhook fires, or when you click **Run now**. Each run is recorded step by step so you can see exactly what happened.

The five ready-made templates target the work freelancers and micro-agencies repeat every week:

| Template | What it does |
|---|---|
| **Invoice Chaser** | Weekday sweep for invoices 14+ days overdue; escalates past 30 days after approval. |
| **Client Onboarding** | A webhook fires when a new client signs up; sends a welcome email and a synchronous reply. |
| **Order Follow-Up** | Finds stalled orders on a schedule and nudges the client; long-stalled orders need approval. |
| **Review Request** | After a delivered order, asks the client for a review. |
| **Renewal Reminder** | Reminds clients about upcoming contract renewals. |

---

## Opening the application

1. Open **http://localhost:8080** in your browser (replace with your hosted URL if an operator gave you a different address).
2. You land on the FlowForge Open landing page. Click **Sign in** (top right) to go to the login page.

## Signing in

FlowForge Open ships a demo workspace with a pre-filled account so you can explore immediately.

- **Email:** `demo@acme.test`
- **Password:** `demo-pass-2026`

When demo seeding is enabled, the login page shows the demo email and password in a credentials panel above the sign-in form — read the values from there and type them in (they always match the server's live configuration). Click **Sign in**.

### What happens after login

FlowForge uses a two-step sign-in: you log in, then you pick a **workspace** (an isolated space that holds your workflows, runs, and team members).

1. After login, if you belong to exactly one workspace you may be taken straight to the dashboard.
2. If you see the **Select a workspace** page, click **Acme Creative** (the seeded demo workspace).

You are now on the **Dashboard**, which shows run statistics, active workflows, and pending approvals.

> **No account yet?** Click **Create account** on the landing page. Registering creates a pre-workspace session; you then create your first workspace (the free plan is assigned automatically) and land on the dashboard.

## The primary journey: run a workflow from a template

This is the complete path from sign-in to a visible, saved run outcome.

### Step 1 — Open the template gallery

From the dashboard, click **Templates** in the left navigation. You see the five templates as cards, each with a name, summary, and icon.

### Step 2 — Create a workflow from a template

1. Click **Invoice Chaser**.
2. Review the manifest summary (the YAML the system will store).
3. Click **Create workflow**.

The system validates the manifest, stores it as version 1, and takes you to the **Workflow Editor** for the new workflow. The workflow is **enabled** by default.

### Step 3 — Run it now

1. In the Workflow Editor (or on the **Workflows** list), click **Run now**.

   This is a **manual trigger** — it fires the workflow immediately regardless of its schedule or webhook triggers.

2. The system queues a run and opens the new run's **Run Detail** page, where its status starts as `queued` and quickly moves to `running`.

### Step 4 — Watch the run and read the result

1. On **Run Detail** you see the run's status (`running`, `succeeded`, `failed`, `canceled`, `waiting`, or `paused`) and a table of **steps**, each with its status and output:
   - `fetch_overdue` (http) — fetched overdue invoices from the demo service.
   - `per_invoice` (for_each) — looped over each invoice.
   - `send_reminder` (notify) — sent an email reminder per invoice.
   - `log_completion` (log) — recorded a summary line.
2. When the status reads **succeeded**, the outcome is saved. Expand any step to see its output JSON.

**Proof it worked:** the run status is `succeeded`, and `send_reminder` step outputs show the email subject and recipient for each overdue invoice. The run is permanently recorded — you can return to **Runs** any time and reopen it.

### Step 5 (if a step needs approval)

Some templates include a **manual approval** step (for example, Invoice Chaser escalates past 30 days only after someone approves). When a run hits an approval step, its status becomes **`paused`** and the run's detail page shows an **Approval required** card. (The dashboard's "Pending Approvals" stat also counts it.)

1. Open the run from **Runs** (or follow the dashboard).
2. On the run's **Approval required** card, review the prompt (which step it is and what it wants to do).
3. Click **Approve** or **Reject**.
4. The run resumes (approve) or cancels (reject — unless the workflow was authored to continue after a rejection), and its status updates on the Runs page.

## Using in-product help

- The **left navigation** labels every section: Dashboard, Workflows, Templates, Runs, Credentials, Audit Log, Settings.
- The Workflow Editor shows the manifest name, summary, and trigger/run counts up front, with **Run now**, **Edit manifest**, and enable/disable controls.
- This guide (`docs/USER_GUIDE.md`) is linked from the repository README and covers the full user journey.

## Restart and recovery

### The server restarted — what happened to my work?

All workflows, runs, and step outputs are **persisted in the database**. A server restart does not lose data. When the server comes back:

1. Open **http://localhost:8080** again.
2. **Sign back in** with the same email and password. (If your session expired, you'll see the login page — just sign in again.)
3. **Re-select your workspace** if prompted.
4. Go to **Runs**. Every past run is still there with its full step history.

### Runs that were mid-flight when the restart happened

The engine is **crash-recoverable**. A run that was `running` when the server stopped is picked up by the reconciliation job on restart: it is re-queued (up to 3 recovery attempts) and continues from its last persisted step; if recovery is exhausted it is marked `failed` with `recovery_exhausted`, and a run stuck in the queue for 24 hours is marked `failed` with `queue_timeout`. You do not need to do anything — check the Runs page and the status will reflect the final outcome.

### Verifying your saved work

- **Workflows** page lists every workflow with its version number, run count, and trigger count.
- **Runs** page shows the full history. Click any run to see its steps.
- **Audit Log** page shows every workspace action with a tamper-evident chain indicator. The page renders on every plan, but the server enforces the `audit_log` feature flag — on a plan without it, the underlying API calls return `403 plan_feature_required` and the page shows an error state.

## Common errors and exact recovery actions

| What you see | Why | What to do |
|---|---|---|
| **401 — Not authenticated** or redirected to login. | Your session cookie expired. | Sign in again with your email and password, then re-select your workspace. |
| **403 — Select a workspace first** | You have a valid session but no workspace selected. | Go to **Select a workspace** and pick one, or create a new workspace. |
| **403 — Invalid CSRF token** | The anti-forgery token is stale (e.g. after a long idle period). | Refresh the page — the app fetches a fresh CSRF token via `/auth/me` automatically — then retry the action. |
| **423 — Account locked** | Five failed login attempts within 15 minutes. | Wait 15 minutes for the lock to expire, then sign in with the correct password. |
| **429 — run_limit_exceeded** | The Free plan caps at 500 runs per month. | Upgrade the workspace plan via the API (`POST /api/v1/subscription` with a `plan_id`) — the SPA does not yet have a plan-management page — or wait for the monthly counter to reset. |
| **429 — concurrency_limit_exceeded** | Too many runs are active at once (Free = 1, Pro = 5). | Wait for an active run to finish, or cancel one from the Runs page, then retry. |
| **403 — workflow_disabled** | You clicked **Run now** on a disabled workflow. | Enable the workflow (toggle it in the Workflow editor), then run again. |
| **Run status `failed`** | A step raised an error (bad URL, missing input, timeout, etc.). | Open the run, find the red step, read its `error` output. Fix the manifest or the external service, then run again. |
| **Run status `paused`** | The run is parked at a manual-approval step. | Open the run and use its **Approval required** card to approve or reject it. |
| **Page shows "Frontend not built"** | The SPA bundle is missing in the server's static path. | Run `npm run build` (operator action), then restart the server. |

---

For server setup, environment variables, and deployment, see [Operations](OPERATIONS.md).
For the full HTTP API and CLI reference, see [API & CLI reference](API.md).
