# Examples

Four runnable FlowForge Open workflow manifests. Each uses the built-in demo HTTP endpoints (`/api/v1/demo/*`) so you can run them locally with `forge run --demo` — no database or Redis required.

## Prerequisites

```bash
npm install
npm run build
```

## Running

```bash
# validate without running
node apps/cli/dist/index.js validate examples/<file>.ff.yaml

# run locally with the in-process demo server
node apps/cli/dist/index.js run examples/<file>.ff.yaml --demo
```

## The examples

### 1. `order-follow-up.ff.yaml` — webhook trigger + for_each

Webhook-triggered check for stalled orders. Fetches `/demo/orders?status=stalled`, iterates over each, and sends an email alert. Demonstrates `webhook` trigger (no auth), `http` step, `for_each` with a bare-expression `over`, and `notify`.

```bash
node apps/cli/dist/index.js run examples/order-follow-up.ff.yaml --demo
# → fetch_stalled: HTTP 200
#   send_alert (×2): email → ops@acme.test "Order ORD-5511 stalled for 60h",
#                    email → ops@northwind.test "Order ORD-5518 stalled for 30h"
#   done: [info] Followed up on 2 stalled orders
# ✓ Run completed (5 steps)
```

### 2. `review-request.ff.yaml` — schedule trigger + for_each

Weekly Monday sweep of demo clients, asking each for a review. Demonstrates `schedule` trigger (`cron` + `timezone`) and `for_each` over `steps.fetch_clients.output.body.clients`.

```bash
node apps/cli/dist/index.js run examples/review-request.ff.yaml --demo
# → fetch_clients: HTTP 200
#   send_request (×4): email → hello@acme.test, hello@northwind.test,
#                      hello@bloom.test, hello@halcyon.test
#   log_count: [info] Sent 4 review requests
# ✓ Run completed (7 steps)
```

### 3. `conditional-escalation.ff.yaml` — condition + input parameter

Fetches overdue invoices (with escalations) and splits each into an escalation or a gentle reminder based on a configurable `escalation_threshold` input. Demonstrates `inputs`, `condition` with a bare-expression `when`, and `for_each`.

```bash
node apps/cli/dist/index.js run examples/conditional-escalation.ff.yaml --demo -i escalation_threshold=20
# → fetch_overdue: HTTP 200
#   gentle_reminder: INV-1042 (17 days — under threshold)
#   escalate (×2): INV-1027 (27 days), INV-0990 (45 days)
#   summary: [info] Processed 3 overdue invoices with escalation threshold 20 days
# ✓ Run completed (9 steps)
```

### 4. `client-onboarding.ff.yaml` — webhook + delay + reply

Webhook-triggered onboarding sequence: fetch the first client, send a welcome email, wait 2 seconds, send a follow-up, and return a synchronous webhook response. Demonstrates `delay` (with `duration`), `reply` (with string `body` + `status`), and array indexing (`clients[0]`).

```bash
node apps/cli/dist/index.js run examples/client-onboarding.ff.yaml --demo
# → fetch_clients: HTTP 200
#   send_welcome: email → hello@acme.test "Welcome aboard, Acme Studio!"
#   wait_2s: waiting 2s
#   send_followup: email → hello@acme.test "Getting started checklist"
#   reply_webhook: reply 200 {"status":"onboarding_started","client":"Acme Studio"}
#   done: [info] Onboarding sequence started for Acme Studio
# ✓ Run completed (6 steps)
```

## Key manifest conventions

- **`for_each.over` and `condition.when`** use bare expressions (no `{{ }}`): `over: "steps.x.output.body.items"`, `when: "loop.item.days_overdue > 30"`.
- **`for_each` children live at step level** (`steps:` on the `for_each` step, outside `with`). The validator also accepts `with.steps`, but the local runner and the canonical examples use step-level `steps:` — see the Invoice Chaser in `workflows/invoice-chaser.ff.yaml`.
- **`condition` branches live inside `with`** (`then:` / `else:`), per the step config schema.
- **String fields** (URL, subject, body, message) use `{{ }}` interpolation: `url: "{{ env.FF_APP_URL }}/api/v1/demo/invoices"`.
- **Array indexing** uses brackets: `items[0].name`, not `items.0.name`.
- **`delay`** uses `duration` (e.g. `"2s"`, `"30m"`), not `for_s`.
- **`reply`** uses `body` (string), `status` (number), `headers` (object).

For the full manifest schema, see [API & CLI reference](../docs/API.md).
