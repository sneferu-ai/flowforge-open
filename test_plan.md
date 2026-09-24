# FlowForge Open — Runtime test plan

The browser proof drives the SPA over the running server (base URL from
`FF_APP_URL`) with Playwright (`npm run test:e2e`, 14 journeys in
`tests/e2e/app.spec.ts`). The server starts from the compiled tree with
`node apps/server/dist/index.js --port {port}` and answers readiness on
`/readyz` (HTTP 200 only once Postgres, Redis and all migrations report
ready; 503 before that). The same port serves the browser against
`FF_PORT`/`FF_APP_URL` set to `http://localhost:{port}`. Data lives in
Postgres (`FF_DATABASE_URL`) with BullMQ on Redis (`FF_REDIS_URL`); the
single-process entrypoint performs its own initialization — migrations,
the five plan rows and the seven system jobs seeded on every start, and
the demo workspace seeded when `FF_SEED_DEMO=true`.

Prerequisites: `npm install`, `npm run build` (the entrypoint and all
dist artifacts it needs are TypeScript build output).

Browser journeys (Playwright, chromium, `data-testid` selectors):

1. GET /healthz returns HTTP 200 with `{"status":"ok"}`.
2. Landing page renders the FlowForge hero with visible login and register actions.
3. Demo login via the on-page credentials panel (the demo account is env-driven: `FF_DEMO_EMAIL` default `demo@acme.test`, `FF_DEMO_PASSWORD` default `demo-pass-2026`, both disclosed on the page):
   a. Navigate to `/login`.
   b. Assert the element `data-testid="demo-credentials"` is visible.
   c. Read the text content of `data-testid="demo-credentials-email"` into variable `email`.
   d. Read the text content of `data-testid="demo-credentials-password"` into variable `password`.
   e. Fill the sign-in form email field (`data-testid="login-email"`) with `email`.
   f. Fill the sign-in form password field (`data-testid="login-password"`) with `password`.
   g. Click the sign-in form submit (`data-testid="login-submit"`).
   h. Assert the browser URL reaches the dashboard (`/dashboard`).
4. Dashboard shows the empty-state when the demo workspace has no runs yet.
5. Command palette opens and filters on keyboard input.
6. Templates page lists all five seeded templates (invoice-chaser, client-onboarding, order-follow-up, review-request, renewal-reminder).
7. Create a workflow from the invoice-chaser template.
8. New-workflow editor offers the template picker.
9. Create a workflow from scratch in the editor.
10. Trigger the workflow manually and view the resulting run.
11. The default invoice-chaser run succeeds without an approval step.
12. Escalation: edit → draft → promote → run pauses → approve → run succeeds.
13. Invalid login shows a visible error.
14. An API token minted via session+CSRF authenticates a Bearer request.

Non-browser scenarios covered by the vitest suite (see IMPLEMENTATION_NOTES.md for the round that added them):

- **packaging env relocation** — `packaging.json` carries `FF_SEED_DEMO`, `FF_DEMO_EMAIL`, `FF_DEMO_PASSWORD` in top-level `env_defaults` (never under `runtime_test`), and `env_var_names` lists all three.
- **demo credentials endpoint** — `GET /demo/credentials` answers 200 JSON with the configured pair when demo seeding is enabled, and a JSON 404 (never SPA HTML) when disabled.
- **login page panel** — `Login.tsx` mounts `fetchDemoCredentials()` and renders the `demo-credentials` panel as plain text nodes only (no interactive elements inside the subtree).
- **OpenAPI publication** — `GET /openapi.json` answers the compiled OpenAPI 3.1.0 document (77 path keys, 93 operations, 35 schemas) with no auth and no envelope, and every documented route is registered on the server.
- **password reconciliation** — every seeded boot re-asserts the demo password via verify-then-update (argon2 verify; rewrite only on mismatch), restores membership `role='owner'`, and leaves a converged database byte-unchanged.

Commands:

- `npm test` — the vitest suite (37 files, 557 tests; 549 passing + 8 inert
  without a database). Hermetic except the demo-account integration block,
  which is live when the lane provides `FF_DATABASE_URL` and inert otherwise.
- `npm run build` — TypeScript project build plus the SPA bundle.
- `npx playwright test --reporter=list` — the browser journeys above
  (starts the server itself with `FF_SEED_DEMO=true`, or set
  `E2E_NO_SERVER=1` and `FF_APP_URL` to reuse one).
