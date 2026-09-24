# Software On Demand delivery

Release: `rel-1af5d44f6b78174ed7fa6955` (version 1)

## Run with the exact accepted image

```sh
# Requires Docker Compose 2.30.0 or later.
sh runtime/start.sh
# open http://localhost:8080
# Stop: sh runtime/start.sh --stop
# Restart: sh runtime/start.sh --stop && sh runtime/start.sh
# Persistent data is retained. Keep runtime/.env with this installation.
# Upgrade from an existing download (requires Python 3 on Linux/macOS):
# sh runtime/start.sh --upgrade /path/to/previous/sod-product
# Upgrades briefly stop writers, copy data, run the new entrypoint and check readiness.
# Use a maintenance window: pause external client traffic until this command finishes.
# Failed startup automatically restores the old application and its original data.
```

## Product settings

The accepted image and application defaults apply when `runtime/product.env` is absent. A declared `APP_BASE_URL` defaults to this download's localhost address in `runtime/runtime-defaults.env`, beside the product's own declared defaults (`env_defaults` in its packaging — the values the accepted preview ran with); override any of them in `runtime/product.env` when serving the product at another address or without them. To configure the product, copy `runtime/product.env.example` to `runtime/product.env` and uncomment only the settings you need. Supply any credentials required by the product yourself. Values are literal: dollar signs and quotes are preserved. `NAME=` explicitly sets an empty value; leave a setting commented to keep its default. Shell environment variables are not forwarded to the product. Keep this file private. Managed upgrades preserve it unless the new download already has its own `runtime/product.env`. Managed-service credentials stay in `runtime/.env`.

## Limitations

- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-003-90c5ccd8b137 (Demo login via the on-page credentials panel (the demo account is env-driven: `FF_DEMO_EMAIL` default `demo@acme.test`, ): error: adjudicated by two lineages as the test's own assumption, not a product finding — correct the test: 2 distinct lineage(s) judged: deepseek=denied, zhipu=denied | observed: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account E
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-004-e8791c57d7cd (Dashboard shows the empty-state when the demo workspace has no runs yet.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-005-bdf5acf1b1f9 (Command palette opens and filters on keyboard input.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-006-2bc819b14de0 (Templates page lists all five seeded templates (invoice-chaser, client-onboarding, order-follow-up, review-request, rene): error: adjudicated by two lineages as the test's own assumption, not a product finding — correct the test: 2 distinct lineage(s) judged: deepseek=denied, zhipu=denied | observed: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account E
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-007-bc057fd91de3 (Create a workflow from the invoice-chaser template.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-008-c3c98be7c11d (New-workflow editor offers the template picker.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-009-4af9d2717267 (Create a workflow from scratch in the editor.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-010-9acc564d6b62 (Trigger the workflow manually and view the resulting run.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-011-008d5d820971 (The default invoice-chaser run succeeds without an approval step.): error: adjudicated by two lineages as the test's own assumption, not a product finding — correct the test: 2 distinct lineage(s) judged: deepseek=denied, zhipu=denied | observed: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Pas
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-012-11790f069522 (Escalation: edit → draft → promote → run pauses → approve → run succeeds.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-014-f998877b0a10 (An API token minted via session+CSRF authenticates a Bearer request.): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-019-4654ce2ececb (**password reconciliation** — every seeded boot re-asserts the demo password via verify-then-update (argon2 verify; rewr): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register
- Launch-proof observation, accepted with this release after the customer verified the preview (the proof's primary journey passed; this item did not): TP-022-dbf89548a586 (`npx playwright test --reporter=list` — the browser journeys above): fail: TimeoutError: Page.wait_for_selector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator("[data-testid=\"dashboard\"], [data-testid=\"dashboard-empty-state\"]") to be visible
 — the page was at http://10.203.24.254:49215/login and showed: FlowForge Open Demo account Email: demo@acme.test Password: demo-pass-2026 Email Password Sign in No account? Register

## Build from source

The exact application source is under `source/`. The runtime definition is under `runtime/`. A source rebuild is a new image and needs its own tests; the image above is the accepted image. Review `LIMITATIONS.json` and `evidence/evidence.json` before deployment.
