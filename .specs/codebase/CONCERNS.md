# Concerns

## High Priority

### CSP Browser Validation Pending

**Status:** Static baseline implemented, browser validation pending.
**Evidence:** `public/_headers` defines CSP; `public/index.html` pins CDN scripts with SRI; `tests/server/cloudflare-pages-contract.test.js` guards directives/SRI/workflow. Express local runtime does not apply Cloudflare `_headers`, so `npm run e2e` against Express does not validate CSP.
**Risk:** App can pass static tests but fail in real browser under Pages due to blocked CDN scripts, inline Tailwind config, generated styles, Supabase requests, or Storage signed images.
**Fix approach:** Run Pages preview and `E2E_REQUIRE_CSP=true npm run e2e -- tests/e2e/csp-smoke.spec.js --workers=1`. For stricter CSP later, vendor/build Tailwind and move inline scripts/styles out of `index.html`.

### Tailwind CDN Requires Weak CSP

**Status:** Accepted temporary limitation.
**Evidence:** CSP currently includes `script-src 'unsafe-inline' 'unsafe-eval'` and `style-src 'unsafe-inline'`; `public/index.html` contains inline Tailwind config and inline `@apply` style block.
**Risk:** CSP blocks fewer XSS classes while Tailwind CDN remains in use.
**Fix approach:** Replace Tailwind CDN with generated CSS in `public/styles/`, then remove `unsafe-eval` and most inline allowances.

### CI Security Workflow Is Advisory

**Status:** Implemented but not proven as a deployment gate.
**Evidence:** `.github/workflows/security-scan.yml` runs npm audit/OSV, Semgrep, and TruffleHog with read-only permissions and no `@main`/`:latest` refs. Branch protection/gating is not documented.
**Risk:** Findings may be visible but not release-blocking.
**Fix approach:** After first clean run, decide which jobs block PRs and remove `continue-on-error` for blocking severities.

## Medium Priority

### E2E Cleanup Uses DB-Level Deletion via `test.afterAll`

**Evidence:** `tests/e2e/store-crud.spec.js` tracks every created store `codigo` in a describe-scoped array and deletes them in `test.afterAll()` via `supabaseRest` (service_role, Supabase REST API). Each deletion is verified by re-querying the database. Cleanup runs even if a test fails (Playwright `afterAll` guarantee).
**Remaining gap:** The `supabaseRest` helper uses the `SUPABASE_SERVICE_ROLE_KEY` from `.env`. If the key is missing or expired, cleanup fails with a clear error. No other E2E spec currently uses this pattern for stores.
**Fix approach:** Rotate the service role key before expiry. Keep the `disposable-user-fixtures.js` pattern as the canonical cleanup approach for all future E2E specs.

### Resubmit False-Error Toast

**Status:** Resolved.
**Root cause (dual):**
1. **Primary blocker:** `#f-justification` hidden textarea did not exist in `public/pages/novo-pedido.html`. `populateFormFromOrder()` wrote justification to a non-existent element — silent no-op. The visible `#f-motivo` select could not represent free-text justification values; Chromium set `selectedIndex = -1`. `syncGeneralStateFromDom()` read empty justification. Validation (`validateGeneralData`) blocked submit with "Informe a justificativa.".
2. **Secondary post-submit:** `submitForm()` success path lacked `window.history.replaceState` cleanup of stale `orderId` URL param. Post-submit re-init via `afterRenderForm` loaded the now-`PENDING_APPROVAL` order, `canEditOrder` returned false, catch block emitted false "Não foi possível abrir pedido para edição" toast.

**Fix:** Added `<textarea id="f-justification" class="hidden" aria-hidden="true">` to `public/pages/novo-pedido.html` (no `name` attribute — not submitted with form). Added `window.history.replaceState` to `submitForm()` success path in `public/js/pages/order-form/order-form-module.js` (after `resetForm()`, before `await runtimeDeps.afterRenderForm()`).

**Tests:** E2E resubmit (2/2), review branches (2/2), `npm run validate` all pass. Post-fix flow: hidden field hydrates → validation passes → RPC succeeds → success toast → URL cleaned → no false toast → re-open correctly blocked.

### Delivery Lifecycle (ORDER_PLACED → RECEIVED)

**Evidence:** `tests/e2e/order-lifecycle-ui.spec.js` covers the full delivery lifecycle: create → submit → changes-requested → resubmit → approve → mark-as-placed → confirm-receipt. Tests verify `ORDER_PLACED` drawer shows confirm button for requester, `RECEIVED` shows final message with delivery metadata. `order-review-branches.spec.js` (approve/reject) and `order-delete.spec.js` (all statuses) also pass.
**Remaining gap:** No dedicated E2E for ADMIN-only mark-as-placed edge cases (non-APPROVED order, non-admin user attempting via API). Covered by existing RPC status validation + security definer checks.
**Fix approach:** Add unit-level RPC validation tests if regressions appear.

### Stale Browser Cache Hiding Application Fixes

**Status:** Mitigated (Phase 3, 2026-06-29).

**Root cause:** Express default `Cache-Control: public, max-age=0` allowed browsers to serve stale JS from disk/memory cache if revalidation was skipped. No version query strings on JS/CSS URLs. `window.APP_VERSION` was stale (`20260618-2`).

**Mitigation applied:**
- Server sets `Cache-Control: no-store, max-age=0` for all `.html`, `.js`, `.mjs` files
- All local `<script>` and `<link>` tags include `?v=20260629-1` query string
- `window.APP_VERSION` updated to `20260629-1` — single source of truth
- Partial HTML loading already appends `?v=APP_VERSION` via `app-shell.js`
- Stale server instance (PID 27204) killed and replaced

**Remaining gap:** Manual browser user must reload once to get fresh assets. Normal navigation after first reload will always receive `no-store` headers. Cannot auto-invalidate cache on deployed assets without a deployment mechanism — current fix relies on developer restarting Express.

**Monitoring:** E2E filechooser test asserts `Cache-Control: no-store` on HTML and JS responses.

### MS Edge / Supabase localStorage Session Leak

**Status:** Resolved.
**Root cause:** Playwright `channel: 'msedge'` causes browser profile storage to leak between contexts within the same test file. Supabase session tokens persist in `localStorage` across `context.close()` + fresh context cycles. When `test.beforeAll` creates an admin session (to create disposable users via admin API), the admin auth tokens remain in browser profile storage. Tests that then try to log in as a different identity (USER) fail because Supabase auto-restores the leaked admin session during bootstrap — `login()` helper's "already authenticated" fast path detects `#sidebar-username` and returns without authenticating. The test then acts as ADMIN, not USER, and queries for orders by the USER's ID, finding none.
**Evidence:**
- Page snapshot showed ADMIN sidebar (Usuários, Lojas links, Administrador badge) when test expected USER session
- Console errors `TypeError: Failed to fetch` at Supabase `_getUser` when stale tokens are used
- Same pattern confirmed in `order-delete.spec.js` (USER cannot delete DRAFT) — stabilized with localStorage clear
**Fix:** Added `loginWithCleanSession(email, password)` to `tests/e2e/helpers/auth.js`. Clears `localStorage`, cookies, navigates to `/login` with `networkidle`, fills credentials directly, submits, waits for redirect. Applied to all 4 USER login calls in `order-review-branches.spec.js` (and available for any future file that switches identities).
**Affected tests:** `order-review-branches.spec.js` (2 tests), `order-delete.spec.js` (1 test — already used inline pattern).
**Verification:** USER scenario runs 3/3 consecutive passes. All dependent E2E files pass.

## Resolved

### Inactive Store Visibility

**Status:** Resolved.
**What happened:** Removed `.eq('ativo', true)` from `loadStores()` in `stores-module.js:158`. RLS (`lojas_select_authenticated`) already enforces `(public.is_admin() or lojas.ativo = true)` — admin sees all stores, non-admin sees only active. Frontend filter was redundant for non-admin and destructive for admin. E2E updated: deactivate test verifies store remains visible with `Inativa` badge; new reactivation test covers toggle back. Non-admin coverage implicit via RLS + `user-store-visibility.spec.js` (pre-existing). Files: `stores-module.js`, `store-crud.spec.js`.

### Orphan Auth Users

**Status:** Resolved.
**What happened:** Two pre-existing auth users (`6ea04e26-d9f2-473a-9a3c-09918416bbec`, `f0215205-d2d5-4aa5-912f-272dc2677475`) deleted via one-time cleanup script `scripts/maintenance/cleanup-orphan-e2e-users.js`. Script: dry-run by default, `--confirm` required for deletion, 6 safety checks per target (auth resolves, email exact match, E2E domain, e2e-user- prefix, not admin, profile absence). Both verified: auth 404, profiles 0, user_stores 0, audit_logs 0.

### User-Store Authorization Bypass via `getStoreById()`

**Status:** Resolved.
**Root cause:** `getStoreById()` in `order-form-module.js:148` checked `StoresModule.findStoreById()` (global all-stores list) before `cachedStores` (user-authorized stores). For non-admin users, an active but unauthorized store (e.g., RODO for a one-store HALFELD-only user) was found in `StoresModule` and accepted, defeating the tamper clearing logic.
**Fix:** Non-admin users now query only `cachedStores` — the store list filtered by `user_stores` during `loadStoresIntoSelect`. Admin users retain the original two-source lookup (StoresModule first, cachedStores fallback). When an unauthorized store is detected and cleared, the submit button is also disabled. Files: `public/js/pages/order-form/order-form-module.js` (`getStoreById`, `syncStoreFieldsFromSelection`).
**Tests:** All 8 `user-store-visibility.spec.js` tests pass — including previously-failing test 6 "Browser tampering clears unauthorized loja_id". All regression E2E pass.

### Suspected Parallel E2E Instability with Shared Admin `storageState`

**Evidence:** `tests/e2e/store-crud.spec.js` fails intermittently (test 2 timeout on `#loja-nova` visibility) when run in parallel with `tests/e2e/admin-users.spec.js` at `--workers=2`. Single-worker execution (`--workers=1`) consistently passes all tests across all files.

**Status:** Mitigated. No shared `storageState` file exists in config. Root cause may be related to the MS Edge channel storage leak pattern described above — parallel workers accessing the same browser profile storage. `--workers=1` remains the official mitigation.
**Fix approach:** If parallel execution is required, each spec file should use `loginWithCleanSession` instead of relying on inherited Playwright storage. Consider switching to `channel: 'chromium'` (isolated contexts) if Edge-specific behavior is not required.

### Multi-Image RPC + Cleanup Draft

**Status:** Implemented and validated.
**What was done:**
- Migration `20260629000001_resubmit_multi_image.sql`: atomic multi-image resubmit RPC + draft cleanup RPC
- Migration `20260629000002_fix_rpc_revoke_public_anon.sql`: revoke public/anon for both new RPCs
- Both RPCs: auth.uid() validation, business logic guards, no storage.objects access
- E2E `tests/e2e/order-multiple-images.spec.js`: 3 tests — multi-image create+submit, resubmit with 2 new images + retry idempotency, cleanup_draft_order
- No new concerns: frontend already wired for multi-image; existing tests pass

## Medium Priority

### Password Reauthentication for Order Deletion

**Justification:** Every order deletion requires password reauthentication via Supabase Auth password grant. This adds a non-trivial dependency on the Supabase Auth HTTP endpoint being available and responsive. If the Auth endpoint is down or slow, order deletion is blocked regardless of Express or database health.
**Architecture:** Password verification uses the public anon key (`POST /auth/v1/token?grant_type=password`), not the service role key. The caller email is obtained from the verified JWT token, never from the request body. The returned access/refresh tokens are discarded immediately. The Auth response is never stored or logged.
**Risk:** A slow/failing Auth endpoint blocks deletion. Mitigation: the Auth endpoint is the same one the login flow already depends on — no new availability risk. The generic "Senha incorreta" error does not leak credential validity.
**Remaining gap:** No circuit breaker or timeout fallback. If the Auth endpoint degrades, admins cannot delete orders until it recovers. Acceptable given the auth dependency is the same as login.

### Documentation Names Were Not Skill-Canonical

**Evidence:** Existing `.specs/codebase/` includes lowercase docs; skill also expects uppercase canonical files.
**Risk:** Future agents may miss files if they assume only uppercase names.
**Fix approach:** Keep current docs synchronized and use canonical files for skill-required summaries.

### Inventory Phase 3A — Dashboard Indicators Locally Validated

**Status:** Locally validated.
**Evidence:** Dashboard shows 4 inventory stat cards (SKUs ativos, abaixo do mínimo, alertas em pedidos, SKUs sem estoque), Alertas de Estoque table (3 alert types), Top SKUs em Pedidos. RLS-safe loading. Graceful degradation on failure.
**Risk:** Stock may drift from physical inventory until auto-deduction is implemented in Phase 3B. No CSV/XLSX import/export yet.
**Fix approach:** Phase 3B adds CSV/XLSX import/export, auto-deduction on order fulfillment, and stock trend indicators.

### Inventory / Order Cross-Reference

**Status:** Local validation only; requires Supabase live validation for production deployment.
**Evidence:** Migration `20260703000000_add_store_inventory.sql` adds `order_items.inventory_item_id` as nullable FK with RLS. No auto-deduction on `submit_order` or `APPROVED` status.
**Risk:** Phase 1 is alerts-only — stock may drift from actual physical inventory until auto-deduction is implemented in Phase 2.
**Fix approach:** Phase 2 adds stock deduction triggered by fulfillment event (business decision pending).
