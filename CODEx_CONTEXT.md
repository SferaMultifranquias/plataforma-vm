# CODEx_CONTEXT — Sfera VM

Snapshot: 2026-07-06 (Store Inventory — Loja column/filter on /estoque)

## Current session handoff

| Field | Value |
|-------|-------|
| TLC phase | **locally validated** |
| Current feature | Store Inventory — CSV/XLSX export on /estoque page |
| Git worktree | `.specs/features/store-inventory-related-to-orders/`, `public/pages/estoque.html`, `public/js/pages/inventory/inventory-data.js`, `public/js/pages/inventory/inventory-module.js`, `public/styles/pages/inventory.css`, `tests/frontend/inventory.test.js` |
| Next authorized action | User explicit approval only |
| Not authorized | Commit, push, E2E, remote mutation, DB reset, Cloudflare resource creation, production deploy |

**Reading order (next session):**
1. `AGENTS.md` — dev rules, architecture, commands
2. `CODEx_CONTEXT.md` — this file, concise handoff
3. `.specs/features/store-inventory-related-to-orders/spec.md`
4. `.specs/features/store-inventory-related-to-orders/design.md`
5. `.specs/features/store-inventory-related-to-orders/tasks.md`
6. `.specs/codebase/workflows.md`
7. Run `git status --short` before any work

## Project

Plataforma de pedidos Sfera Multifranquias. Store users create orders; admins review/approve. Auth via Supabase, server via Express, frontend pure HTML/CSS/JS with History API routing.

Stack: Node.js, Express ^4.19.2, Supabase Auth + PostgreSQL + Storage, supabase-js ^2.107.0 (dev), nodemon ^3.1.4 (dev).

## Documentation roles

| File | Purpose |
|------|---------|
| `AGENTS.md` | Dev rules, agent instructions, architecture, current priorities. |
| `CODEx_CONTEXT.md` | Canonical handoff — concise, current, English, no secrets. |
| `README.md` | Setup, install, commands, env vars. |
| `.agents/qa-project-context.md` | QA onboarding: tech stack, test frameworks, CI/CD, environments, risk areas. |
| `.specs/features/*/` | Feature specs (spec/design/tasks) for current feature. |
| `.specs/codebase/` | Codebase map, workflows, testing infra docs. |
| `docs/` | Historical reference only — directory migration, architectural decisions. |

## Current repository state

- CSP baseline implemented in `public/_headers` with Supabase API/storage allowances.
- CDN scripts in `public/index.html` are version-pinned and protected with SRI + `crossorigin="anonymous"`.
- Security workflow added at `.github/workflows/security-scan.yml` (npm audit/OSV, Semgrep, TruffleHog) with read-only permissions and no `@main`/`:latest` moving refs.
- Optional Playwright CSP smoke added at `tests/e2e/csp-smoke.spec.js`; it only runs with `E2E_REQUIRE_CSP=true` against Pages preview.
- Static contract tests now guard CSP directives, SRI coverage, pinned CDN URLs, and workflow baseline.
- All changes are intentionally uncommitted.
- No commit or push has been authorized.
- Recent commits:
  - `1e5847b test: validate full order lifecycle through UI`
  - `a469b9f feat: add order changes resubmit workflow`
  - `95c2bce docs: update project architecture and backlog`
  - `b44afd1 refactor: migrate lojas to partial`
  - `a803996 fix: remove direct order insert fallback`
  - `15fd484 feat: enforce user store visibility`

## Active directory layout

```
public/
  index.html           shell, loads globals
  pages/               HTML partials: login, lojas, novo-pedido, pedidos, usuarios
  styles/pages/        Page CSS: login, orders, order-form, users, stores
  vendor/supabase/     vendored supabase.js UMD bundle
  _redirects           Cloudflare clean-URL rewrites
  _headers             Cloudflare static response headers
  js/
    core/              app-shell.js, auth.js
    shared/            app-utils.js, order-rules.js
    pages/             dashboard/, orders/, order-form/, stores/, users/
functions/
  _shared/
    admin-core.js      pure functions (normalizers, DTOs, validators)
    admin-service.js   portable service factory (Web Crypto, fetch)
    env.js             env value helpers
    http.js            Response utilities
  api/
    config.js          GET /api/config
    health.js          GET /api/health
    admin/
      users/
        index.js       GET+POST /api/admin/users
        [id].js        PATCH+DELETE /api/admin/users/:id
      orders/
        [id].js        DELETE /api/admin/orders/:id
      inventory/
        index.js       GET+POST /api/admin/inventory
        [id].js        PATCH+POST adjust /api/admin/inventory/:id
src/server/
  app.js               Express mount
  routes/              users-admin.js, orders-admin.js
  services/            supabase-admin-service.js
supabase/
  migrations/          versioned SQL files
  verification/        read-only SQL scripts
tests/
  frontend/            Node-based browser-module tests
  server/              Node-based server tests
scripts/
  admin/               create-admin.ps1, create-admin.js
  maintenance/         check-project.js
  smoke/               smoke-test.ps1
wrangler.toml          Cloudflare Pages config
.dev.vars.example      Pages function local env template
```

## Routes

### Interface (History API)
- `/login` — public, partial `/pages/login.html`, init `AuthModule.afterRenderLogin`
- `/dashboard` — authed, init `DashboardModule.afterRenderDashboard`
- `/pedidos` — authed + permission, partial `/pages/pedidos.html`, init `OrdersModule.afterRenderPedidos`
- `/novo-pedido` — authed + permission, partial `/pages/novo-pedido.html`, init `FormModule.afterRenderFormulario`
- `/lojas` — authed + permission, partial `/pages/lojas.html`, init `StoresModule.afterRenderLojasCadastro`
- `/estoque` — authed + resource `stock-checks-read`, partial `/pages/estoque.html`, init `StockCheckModule.afterRenderEstoque`. Shows only received table; checks data loaded for export CSV/XLSX.
- `/usuarios` — ADMIN-only, partial `/pages/usuarios.html`, init `UsersModule.afterRenderUsuarios`

### API
- `GET /api/config` — public, exposes Supabase URL + anon key
- `GET /api/health` — public
- `GET|POST /api/admin/users` — admin token required
- `PATCH|DELETE /api/admin/users/:id` — admin token required
- `DELETE /api/admin/orders/:id` — admin token + password required (body: `{ password }`)
- `GET|PATCH /api/admin/stock-checks` — admin token required (stock analysis)
- `PATCH /api/admin/stock-checks/:orderItemId` — admin token required (update stock check)
- `GET /api/admin/received-stock` — admin token required (received stock list)

## Auth & roles

- Persisted roles: `USER`, `ADMIN` (in `profiles` table)
- Frontend normalizes: `USER` → `loja`, `ADMIN` → `admin`
- `is_active=false` blocks access
- `removed_at` distinguishes removed from blocked (`removed_at IS NOT NULL` = removed)
- Removed users: profile preserved with `is_active=false`, `removed_at`, `removed_by_id`
- Auth access disabled via `ban_duration: '876000h'` + `app_metadata.is_active=false`
- Historical FK references preserved — IDs unchanged, display shows `— usuário removido`
- `service_role` used only in `src/server/services/supabase-admin-service.js`
- Browser never receives `SUPABASE_SERVICE_ROLE_KEY`
- AuthZ enforced server-side + RLS, not browser

## Security: active-user enforcement

All 23 public functions audited via `pg_proc` against remote DB. `current_user_is_active()` checks `is_active AND removed_at IS NULL` — was only `is_active` before migration 20260630200000. Reads from DB, not JWT; immune to stale token metadata.

Every mutating RPC enforces active-user guard (via `current_user_is_active()` or direct `is_active` + FOR UPDATE):
- `create_order`, `submit_order`, `approve_order`, `reject_order`, `request_order_changes`
- `return_order_to_draft`, `cleanup_draft_order`
- `delete_order`, `delete_store`, `mark_order_placed`, `confirm_order_received`
- `resubmit_changed_order`, `resubmit_changed_order_multi_image`
- `admin_remove_user_profile` (reads profile directly with is_active check + FOR UPDATE lock)

RLS complete hardening: ALL 23 policies across all 8 application tables + storage.objects now include `current_user_is_active()`. Pre-existing `_select_own_or_admin` and `_modify_editable_orders` policies lacked active check and OR-bypassed newer `_visible_scope` policies. Fixed in migration `20260630200000_harden_rls_policies_complete.sql`.

## Order workflow

1. `create_order` RPC → `DRAFT`
2. `order_items` insert
3. Image upload to private `order-images` bucket
4. `order_images` insert
5. `submit_order` RPC → `PENDING_APPROVAL`
6. `status_history` logs each transition
7. Admin `approve_order` → `APPROVED`
8. Admin `mark_order_placed` → `ORDER_PLACED` (sets `delivery_protocol`, `delivery_date`, `placed_by_id`, `placed_at`)
9. Requester `confirm_order_received` → `RECEIVED` (sets `received_by_id`, `received_at`)
10. Admin `request_order_changes` → `CHANGES_REQUESTED` (non-final correction)
11. Requester opens `/novo-pedido?orderId=...` → edit form
12. `resubmit_changed_order_multi_image` RPC → `PENDING_APPROVAL` (same order_id, atomic item replace, multi-image metadata, remove-image IDs, history + audit append). Fallback: old `resubmit_changed_order` for single-image.
13. `cleanup_draft_order` RPC: requester deletes own DRAFT (order + items + images metadata). No storage cleanup (handled by RLS or service_role)

Confirmed frontend behavior:
- no direct `orders.insert(...)` fallback remains
- `create_order` is only frontend order-creation path
- retry uses only `draft_order_id` with `submit_order`
- resubmit uses `resubmit_changed_order_multi_image` (frontend `resubmitChangedOrderAPI`) — multi-image path for `CHANGES_REQUESTED` edits
- `mark_order_placed` is ADMIN-only; drawer shows delivery form for APPROVED
- `confirm_order_received` is requester-only; drawer shows confirm button for ORDER_PLACED
- `RECEIVED` is sole final state; `APPROVED` no longer terminal

## Order statuses
| Status | Description |
|--------|-------------|
| `DRAFT` | Initial, before submit |
| `PENDING_APPROVAL` | Awaiting admin review |
| `CHANGES_REQUESTED` | Admin requested edits |
| `APPROVED` | Admin approved |
| `ORDER_PLACED` | Admin placed order with delivery protocol |
| `RECEIVED` | Final state — requester confirmed receipt |
| `REJECTED` | Final state |

## Feature map

| Feature | Active files | State |
|---------|-------------|-------|
| App shell + router | `public/js/core/app-shell.js` | Implemented |
| Auth (login + session restore) | `public/js/core/auth.js` | Implemented |
| Dashboard | `public/js/pages/dashboard/dashboard-module.js` | Implemented |
| Orders list + filters + pagination + drawer | `public/js/pages/orders/orders-module.js`, `orders-data.js` | Implemented |
| Order form + validation + submit | `public/js/pages/order-form/order-form-module.js` | Implemented |
| Order multi-image upload | `public/js/pages/order-form/order-form-module.js`, `orders-data.js` | Implemented |
| Order approve + reject E2E | `tests/e2e/order-review-branches.spec.js` | Implemented + validated |
| Stores list | `public/js/pages/stores/stores-module.js`, `public/pages/lojas.html` | Implemented |
| Store CRUD E2E (DB-level cleanup via `afterAll`) | `tests/e2e/store-crud.spec.js` | Implemented + validated |
| Users admin (CRUD, modal, filters) | `public/js/pages/users/users-module.js`, `users-data.js` | Implemented |
| User modal redesign (sections, password inline toggle, scrollable body, pinned footer) | `public/pages/usuarios.html`, `public/styles/pages/users.css`, `public/js/pages/users/users-module.js`, `tests/frontend/users.test.js` | Implemented + validated |
| Inventory admin API (Phase 1, manual stock management) | `src/server/routes/inventory-admin.js`, `functions/api/admin/inventory/`, `tests/server/inventory-admin.test.js`, `supabase/migrations/20260703000000_add_store_inventory.sql` | **locally validated** |
| Inventory frontend (Phase 2, `/estoque` page) | `public/js/pages/inventory/inventory-data.js`, `inventory-module.js`, `public/pages/estoque.html`, `public/styles/pages/inventory.css`, `public/js/core/app-shell.js` (route + resource), `public/index.html` (nav + scripts + CSS + resources), `public/_redirects`, `tests/frontend/inventory.test.js` (30 groups) | **locally validated** |
| Inventory CSV/XLSX export | `public/pages/estoque.html` (export button + menu), `public/js/pages/inventory/inventory-module.js` (escapeCsv, downloadBlob, buildCsvRows, exportCsv, exportXlsx), `public/styles/pages/inventory.css` (export styles), `tests/frontend/inventory.test.js` (groups 24-30) | **locally validated** |
| Inventory dashboard indicators (Phase 3A) | `public/js/pages/dashboard/dashboard-module.js`, `public/js/core/app-shell.js` (deps), `tests/frontend/inventory.test.js` (25 groups) | **locally validated** |
| Inventory auto stock deduction (Phase 3B) | `supabase/migrations/20260704000000_add_inventory_auto_deduction.sql`, `supabase/verification/20260704_verify_inventory_auto_deduction.sql`, `tests/server/inventory-admin.test.js`, `scripts/verification/check-supabase-verification.js`, `tests/server/supabase-verification-assets.test.js` | **locally validated** |
| Cloudflare Pages deployment (static routing, Functions, portable core, contract tests) | `public/_redirects`, `public/_headers`, `public/vendor/supabase/supabase.js`, `functions/_shared/*`, `functions/api/*`, `wrangler.toml`, `.dev.vars.example`, `tests/server/cloudflare-pages-contract.test.js` | **locally validated** |
| User deactivation (soft-remove, historical identity, E2E validated) | `public/js/pages/users/users-module.js`, `users-data.js`, `src/server/services/supabase-admin-service.js`, `src/server/routes/users-admin.js`, `supabase/migrations/20260630000000_user_deactivation_historical_identity.sql`, `supabase/migrations/20260630220000_add_caller_id_to_admin_remove_user_profile.sql`, `tests/e2e/admin-user-removal.spec.js`, `tests/e2e/helpers/disposable-user-fixtures.js`, `scripts/maintenance/purge-stale-e2e-users.js` | Migration applied; frontend + server tests pass; **E2E 14/14 PASS** |
| Server admin API | `src/server/routes/users-admin.js` | Implemented |
| Supabase admin service | `src/server/services/supabase-admin-service.js` | Implemented |
| Full order lifecycle UI E2E | `tests/e2e/order-lifecycle-ui.spec.js` | Implemented + validated |
| Backlog & doc reconciliation | `AGENTS.md`, `CODEx_CONTEXT.md`, `docs/architectural-decisions.md` | Implemented |
| Admin users E2E (live validated) | `tests/e2e/admin-users.spec.js` | Implemented + validated |
| Store visibility fix (inactive stores visible to admin) | `public/js/pages/stores/stores-module.js` | Implemented + validated |
| Orphan E2E auth users cleanup | `scripts/maintenance/cleanup-orphan-e2e-users.js` | One-time cleanup + validated |
| Resubmit false-toast fix (dual root cause) | `public/pages/novo-pedido.html`, `public/js/pages/order-form/order-form-module.js` | Implemented + validated |
| Admin order delete (any status, password reauth) | `supabase/migrations/20260626090000_delete_order_any_status.sql`, `public/js/pages/orders/orders-module.js`, `orders-data.js`, `app-utils.js`, `index.html`, `confirmation-modal.js`, `src/server/services/supabase-admin-service.js`, `src/server/routes/orders-admin.js` | Implemented + validated |
| Admin store delete (no-orders only) | `same migration`, `public/js/pages/stores/stores-module.js`, `index.html` | Implemented + validated |
| Session-isolation fix for review-branches E2E | `tests/e2e/helpers/auth.js`, `tests/e2e/order-review-branches.spec.js` | Implemented + validated |
| Delivery lifecycle (ORDER_PLACED → RECEIVED) | `supabase/migrations/20260626170000_add_order_delivery_lifecycle.sql`, `public/js/pages/orders/orders-module.js`, `orders-data.js`, `app-utils.js`, `order-rules.js`, `index.html`, `app-shell.js` | Implemented + validated |
| Multi-image create+resubmit RPC + cleanup draft | `supabase/migrations/20260629000001_resubmit_multi_image.sql`, `supabase/migrations/20260629000002_fix_rpc_revoke_public_anon.sql`, `public/js/pages/orders/orders-data.js` | Implemented + validated |
| Order details drawer UI cleanup | `public/index.html`, `public/js/pages/orders/orders-module.js`, `public/styles/pages/orders.css`, `tests/frontend/orders-module.test.js`, `tests/e2e/order-review-branches.spec.js` | Implemented + validated |

- `user-modal-redesign` complete: modal refactored into sections (Dados da conta, Configuração de acesso, Lojas permitidas), password toggle inside field, collapsed store dropdown, scrollable body + pinned footer, fieldsets with 2-col grids, required indicators, focus-visible states, 44px/10px controls, bounded store list. JS: password toggle `aria-label` now toggles between "Mostrar senha" / "Ocultar senha". All `users-create-*` IDs preserved. `npm test` (11 suites), `npm run check`, `npm run test:smoke` pass. E2E skipped (no remote mutations).

## Recent completed work

- `user-store-visibility` complete; migration applied remotely; frontend and live Playwright E2E passed.
- `changes-requested-edit-and-resubmit` complete; migration applied remotely; verification SQL passed; `npm run validate` passed; live Playwright E2E passed (full lifecycle + retry idempotency).
- `order-lifecycle-ui` E2E complete; full Playwright E2E passed (create → submit → changes-requested → resubmit → PENDING_APPROVAL).
- Direct frontend order insert fallback removed.
- `/lojas` migrated to `public/pages/lojas.html`.
- `public/js/legacy/pages-module.js` removed.
- Stores page events now bind through `StoresModule.afterRenderLojasCadastro()`.
- Backlog and documentation reconciliation cleanup — completed working sessions.
- `/usuarios` admin CRUD live E2E validated: create, edit, deactivate, reactivate, delete, and cleanup passed; no disposable users, user_stores, or audit-log blockers remained.
- `order-review-branches-e2e` complete: approve and reject branches covered via live Playwright E2E; both tests verify final-state immutability, history/audit entries, rejection reason in drawer history, and marker-based cleanup.
- `resubmit-false-toast-fix` complete: dual root cause corrected — (1) missing `#f-justification` element in `novo-pedido.html` was the primary blocker (free-text justification could not be represented by the `f-motivo` select); (2) stale `orderId` URL parameter after successful resubmit caused false error toast (secondary). Production fix: added hidden `<textarea id="f-justification">` to the partial + `window.history.replaceState` URL cleanup in `submitForm()` success path. E2E resubmit (2/2) + review branches (2/2) pass. `npm run validate` passes.
- `admin-delete-rpcs` complete: migration `20260625000000_add_admin_delete_rpcs.sql` adds `delete_order(uuid)` (DRAFT-only, audit trail, storage cleanup) and `delete_store(bigint)` (zero-orders only). Frontend wired: order drawer shows red "Excluir Pedido" block for admin on DRAFT, store table adds "Excluir" button. `npm run check` and `npm test` pass.
- `admin-delete-rpcs-hardened` complete: forward migration `20260625130000_fix_delete_rpcs_hardened.sql` hardens both RPCs with security definer, caller JWT auth, schema-qualified refs, structured error returns, and BIGINT-safe store ID in audit `previous_data`. Server service uses caller JWT for RPC, service role for storage cleanup. Confirmation modal replaces `window.confirm` with focus trap, loading state, and duplicate-confirm guard. `tests/server/orders-admin.test.js` (13 scenarios). `tests/e2e/order-delete.spec.js` (3 tests) and `tests/e2e/store-delete.spec.js` (2 tests) pass.
- `session-isolation-fix` complete: `order-review-branches.spec.js` failed consistently because `channel: 'msedge'` contexts share browser profile storage, causing admin session from `beforeAll` to leak into test contexts via Supabase session tokens in localStorage. Added `loginWithCleanSession()` helper to `auth.js` — clears localStorage, cookies, and sessionStorage before navigating to `/login` and authenticating. Applied to all 4 USER login calls in the spec. All 3 consecutive USER-scenario runs pass. `store-crud.spec.js` (8 tests) and `user-store-visibility.spec.js` (8 tests) also pass in isolation.
- `order-delete-any-status-password-reauth` complete: `supabase/migrations/20260626090000_delete_order_any_status.sql` replaces `delete_order` — no status restriction, audit snapshot includes `deleted_by`, `deleted_at`, `image_count`. Password reauth via `POST /auth/v1/token?grant_type=password` (anon key, caller email, never service role). `verifyCallerPassword()` in `supabase-admin-service.js`. `confirmPassword()` in `confirmation-modal.js`. `canDeleteOrder()` checks only ADMIN + valid ID. `deletarPedidoAPI(id, deps, password)` sends password in body. `excluirPedido()` uses password confirm modal. Server tests cover password verification (missing, wrong, other-user, guard before deleteOrder), non-DRAFT acceptance. E2E covers DRAFT + correct password, PENDING_APPROVAL + correct password, USER no-button, wrong password DB/storage untouched, cancel untouched, duplicate single request.
- `delivery-lifecycle` complete: migration `20260626170000_add_order_delivery_lifecycle.sql` adds `delivery_protocol`, `delivery_date`, `placed_by_id`, `placed_at`, `received_by_id`, `received_at` to `orders`. Two new RPCs: `mark_order_placed(order_id, protocol, delivery_date)` (ADMIN-only, sets protocol + date + status→ORDER_PLACED + history + audit) and `confirm_order_received(order_id)` (requester-only, sets receipt + status→RECEIVED + history + audit). Migration hardened: `set search_path = ''`, pg_catalog-qualified refs, PG17 `btrim` compat, REVOKE public/anon, GRANT authenticated. Drawer branch ordering fixed: APPROVED shows placement form (not review buttons), ORDER_PLACED shows confirm/waiting, RECEIVED shows final message. `FINAL_STATUSES` updated: `APPROVED` removed, `RECEIVED` sole terminal. E2E `order-lifecycle-ui.spec.js` fixed — missing approval step before placement added; drawer close before logout (overlay block). `npm run validate` passes. All 3 E2E suites pass: `order-lifecycle-ui` (1), `order-review-branches` (2), `order-delete` (6).
- `multi-image-rpc` complete: migration `20260629000000_drop_create_order_overload.sql` drops orphan 7-param `create_order` overload (caused PGRST203). Migration `20260629000001_resubmit_multi_image.sql` adds `resubmit_changed_order_multi_image` (handles multiple image metadata atomically, validates storage path pattern, atomic item replace) and `cleanup_draft_order` (requester discards own DRAFT pre-submit). Migration `20260629000002_fix_rpc_revoke_public_anon.sql` adds revoke public/anon to match latest security pattern. Frontend already wired: `formData.getAll('fotos')` for multi-upload in create path; `resubmitChangedOrderAPI` calls `resubmit_changed_order_multi_image` with image metadata + removal array. E2E `tests/e2e/order-multiple-images.spec.js` (3 serial tests): multi-image create+submit+verify (3 images), multi-image resubmit (2 new images + retry idempotency), cleanup_draft_order (DRAFT delete + non-DRAFT rejection). Fix: E2E tests `order-lifecycle-ui.spec.js` and `order-review-branches.spec.js` now wait for `#image-gallery` instead of removed `#upload-done` element. All 25 E2E tests pass. `npm run validate` passes.
- `stale-e2e-user-purge` complete: 26 stale removed E2E users (byproducts of prior failed runs, all with `e2e-user-usv` email marker) identified via remote DB inventory and purged via `scripts/maintenance/purge-stale-e2e-users.js` using service role (safe order: Storage → DB → Auth). Zero leftovers verified. All 14 user-deactivation E2E tests pass after purge.
- `e2e-user-removal-expanded` complete: two new tests added to `admin-user-removal.spec.js` — (06b) direct Supabase Auth REST API login denial verifies banned users get HTTP 400 with `user_banned` error, and (08b) stale-session token PostgREST mutation test verifies INSERT/UPDATE/DELETE on orders, order_items, order_images, profiles, and user_stores are all blocked by RLS (data integrity verified via service-role reads before and after each attempted mutation). 14/14 tests pass.
- `security-hardening` complete: 11 test sections added to `tests/server/security-hardening.test.js`:
  - **Sec 1**: http.js helpers — content-type, body size, bearer token, JSON parsing, oversized/unicode payloads
  - **Sec 2**: admin-core.js helpers — `isValidUUID`, `sanitizeObject` prototype pollution, allowlist
  - **Sec 3**: Express route hardening — UUID validation (400), auth-before-validation, content-type enforcement (415), field allowlists, `__proto__`/`constructor` rejection, non-admin 403, missing token 401, error detail concealment
  - **Sec 4**: Express app.js — `jsonParseErrorHandler`, `isLocalOrigin`, no `err.message`/`err.body` leak, no `credentials: true`, CORS uses callback pattern
  - **Sec 5**: Error message safety — no raw upstream messages in Express or Pages service, no password/token in `sendAdminError`
  - **Sec 6**: Migration SQL safety — static scan of all 22 migrations for dynamic SQL EXECUTE+concat (zero violations), RPC typed parameter verification
  - **Sec 7**: Filter normalization safety — SQLi UUID rejection, store ID normalization, role/status filter allowlist, `matchesSearch`/`matchesStore` in-memory-only, prototype pollution in `sanitizeObject`, `computeSummary` correctness
  - **Sec 8**: PostgREST URL safety — `eq.${value}` in `searchParams.set()` or `encodeURIComponent`, auth user IDs encoded, `in.()` uses `.join()` on validated IDs, `listUsers` filters in-memory, RPC calls use JSON body not URL params
  - **Sec 9**: Express route SQL injection — PATCH/DELETE/order DELETE with 5 SQLi UUID patterns (all 400), POST body SQLi handled gracefully, GET SQLi query params pass through for in-memory filtering
  - **Sec 10**: Express integration (real HTTP) — CORS origins (no origin, localhost, 127.0.0.1, [::1], external, malformed), OPTIONS preflight from loopback, external OPTIONS denial
  - **Sec 11**: CORS `isLocalOrigin` pure function — null/empty/localhost/127.0.0.1/::1 allowed, external/subdomain/IP-format attacks rejected
- `csp-sri-security-workflow` complete (static/local): CSP baseline in `public/_headers`; CDN URLs pinned (`tailwind 3.4.17`, `lucide 1.23.0`, `js-sha256 0.11.0`, `xlsx 0.18.5`) with SRI; `img-src` allows Supabase signed Storage URLs; GitHub security workflow added with read-only permissions and no `@main`/`:latest`; `cloudflare-pages-contract.test.js` guards CSP/SRI/workflow; optional `tests/e2e/csp-smoke.spec.js` waits for `E2E_REQUIRE_CSP=true` and Pages preview. Browser validation pending.
- `store-inventory-phase-1-corrected` complete: Wrong standalone inventory model (`inventory_items`, `inventory_movements`) replaced by receipt-based stock lifecycle. Migration `20260706000000_correct_stock_lifecycle.sql` drops wrong tables, creates `order_item_stock_checks`, `store_stock_receipts`, `store_stock_balances`. `confirm_order_received` rewritten to insert receipt rows per order item. `mark_order_placed` reverted to original (no deduction). Express route `stock-checks.js` mounted at `/api/admin/stock-checks` and `/api/admin/received-stock`. Pages Functions parity. Tests: `tests/server/inventory-admin.test.js` (13 groups), `tests/frontend/inventory.test.js` (18 groups). `npm run check` (70 files), `npm test` (20 suites): PASS.
- `estoque-received-stock-render` complete: `/estoque` now loads and renders both `order_item_stock_checks` (requested items analysis) and `store_stock_receipts` (received items). Empty state only when both lists empty. Search filters both tables. `inventory-module.js` exports `renderReceivedTable` and `showBothTables`. Received section hidden when no receipts. `tests/frontend/inventory.test.js`: 3 new test groups (module loads receipts, empty state checks both, HTML has received DOM). `npm run check` (70 files), `npm test` (20 suites), `npm run test:smoke`: all PASS.
- `estoque-loja-column-filter` complete: Loja column added to both stock tables (checks + received), rendered via `lojas(codigo,nome)` embed with `Loja #store_id` fallback. Loja filter in toolbar populates from loaded data, filters both tables by `store_id`. CSS migrated from old `inv-*` prefix to `stock-*` classes matching stores.css card/table pattern. `inventory-data.js` selects `lojas(id,codigo,nome)` in both queries. `inventory-module.js` exports `getStoreLabel`, `populateStoreFilter`. `tests/frontend/inventory.test.js`: 3 new groups (data selects lojas, module has loja filter logic, HTML has loja columns/filter). `npm run check` (70 files), `npm test` (20 suites), `npm run test:smoke`: all PASS.
- `estoque-table-column-alignment` complete: Loja column moved to first position in both tables. Consistent column order with fixed layout via `table-layout: fixed` + `colgroup` width classes (`stock-col-*`). `inventory-module.js` render order updated: Loja cell before Produto/SKU in both tables. `inventory.css` adds `.stock-col-*` width classes, `min-width`, `table-layout: fixed`. `tests/frontend/inventory.test.js`: 2 new groups (Loja first in both tables, CSS fixed layout + column widths), 2 groups updated (colgroup assertion, Loja-before-SKU pattern). `npm run check` (70 files), `npm test` (20 suites), `npm run test:smoke`: all PASS.

## Known issues

- Documentation drift: `CODEx_CONTEXT.md` and `AGENTS.md` can drift if not refreshed after cleanup. Run `npm run check` and `npm test` after doc changes.
- Stale browser cache: Fixed via `Cache-Control: no-store, max-age=0` for HTML/JS, `APP_VERSION=20260629-1`, version query strings on all local script/link tags. Stale server instance (PID 27204) found and replaced. Manual user still needs one reload to clear old cache.
- MS Edge channel session leak: `channel: 'msedge'` in Playwright config causes browser profile storage to leak between contexts within the same test file. Supabase session tokens in localStorage persist across context.close() + fresh context cycles. Mitigation: `loginWithCleanSession()` helper clears localStorage and cookies before navigation/login. Applied to `order-review-branches.spec.js` (all 4 USER login calls). Other E2E files that switch between admin and user identity in the same file should also use this helper.
- Parallel E2E instability mitigated: `--workers=1` consistently passes all tests. Not investigated for root cause.

## Approved business decisions

- Only ADMIN may approve/reject orders
- Product image required before submission
- Regular USER must not approve/reject
- `REJECTED` is final state; `CHANGES_REQUESTED` is correction state
- Retry preserves `draft_order_id`, does not duplicate order
- `service_role` stays server-side only
- Browser is never authZ source of truth
- `RECEIVED` is sole final delivery state; `APPROVED` is not terminal
- `mark_order_placed` is ADMIN-only; `confirm_order_received` is requester-only
- Idempotent RPCs: second call to `mark_order_placed`/`confirm_order_received` fails (status check), no double-publish
- User removal is soft: profile preserved with `is_active=false`, `removed_at`, `removed_by_id`; Auth identity preserved with `ban_duration: '876000h'` + `app_metadata.is_active=false`
- Final active ADMIN cannot be removed (RPC-level guard)
- Historical actor display uses `formatHistoricalActorName()` helper — appends `— usuário removido` only when `removed_at` present

## Pending decisions

| Decision | Status |
|----------|--------|
| Permissions table vs role + user_stores + RLS | Deferred — no use case yet |
| `update_order` RPC design | Rejected — status-specific RPCs cover all known cases |
| Last editor / audit metadata fields | Deferred — `status_history` + `audit_logs` are current truth |

## Supabase

- 24 migrations applied (through 20260706000000_correct_stock_lifecycle). Local and remote sync.
- Known RPCs (24 total): `confirm_order_received` now inserts receipt stock rows.
- Stock tables: `order_item_stock_checks` (order-item analysis), `store_stock_receipts` (immutable INSERT-only via RPC), `store_stock_balances` (estimated balance from received purchases). Old `inventory_items`/`inventory_movements` dropped.
- Storage bucket: `order-images` — private with `current_user_is_active()` on all 3 policies.
- RLS uses `is_admin()` helper — recursion fix migrations applied.
- RLS complete coverage: all 23 policies include `current_user_is_active()` for defense-in-depth.

## Environment vars

**Browser-safe:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
**Server-only (Express):** `PORT`, `SUPABASE_SERVICE_ROLE_KEY`
**Server-only (Pages Functions):** `context.env.SUPABASE_SERVICE_ROLE_KEY`

`.env` and `.dev.vars` are gitignored. No real values committed.

## Tests (21 files + 7 E2E + helpers)

```
tests/frontend/order-rules.test.js
tests/frontend/orders-module.test.js
tests/frontend/order-form.test.js
tests/frontend/router.test.js
tests/frontend/auth.test.js
tests/frontend/stores.test.js
tests/frontend/users.test.js
tests/frontend/xss-escape.test.js
tests/frontend/no-inline-events.test.js
tests/frontend/account.test.js
tests/frontend/inventory.test.js
tests/server/startup.test.js
tests/server/users.test.js
tests/server/order-resubmit-contract.test.js
tests/server/orders-admin.test.js
tests/server/cloudflare-pages-contract.test.js
tests/server/e2e-runtime-safety.test.js
tests/server/supabase-verification-assets.test.js
tests/server/security-hardening.test.js
tests/server/inventory-admin.test.js
tests/e2e/order-resubmit.spec.js
tests/e2e/order-lifecycle-ui.spec.js
tests/e2e/order-multiple-images.spec.js
tests/e2e/user-store-visibility.spec.js
tests/e2e/admin-users.spec.js
tests/e2e/admin-user-removal.spec.js
tests/e2e/order-review-branches.spec.js
tests/e2e/store-crud.spec.js
tests/e2e/order-delete.spec.js
tests/e2e/store-delete.spec.js
tests/e2e/helpers/users-admin.js
tests/e2e/helpers/runtime.js
tests/e2e/helpers/disposable-user-fixtures.js
tests/e2e/helpers/auth.js
```

## Validation status

- `store-inventory-phase-1` admin API + migration + contract tests: PASS
- `store-inventory-phase-2` frontend `/estoque` page: PASS
- `store-inventory-phase-3a` dashboard indicators: PASS
- `store-inventory-phase-3b` auto stock deduction: PASS
- `npm run check`: PASS (70 files)
- `npm test`: PASS (20 suites, 8 verification files)
- `npm run test:smoke`: PASS
- `npm run validate`: PASS
- `estoque-loja-column-filter`: PASS (21 frontend test groups)
- `estoque-table-column-alignment`: PASS (23 frontend test groups)
- `cloudflare-pages-contract` static file/core/contract tests: PASS (includes inventory parity)

Latest validated commands:
- `npm run check`: PASS (70 files)
- `npm test`: PASS (20 suites, 8 verification files)
- `npm run test:smoke`: PASS
- `npm run validate`: PASS
- E2E (49 tests total): ALL PASS
  - Multi-image create/resubmit: 2/2 pass
  - Cleanup draft order: 1/1 pass
  - Order delete (any-status, password reauth): 6/6 pass
  - Order resubmit lifecycle: 2/2 pass
  - Order lifecycle UI: 1/1 pass
  - Order review branches (incl. drawer UI validation): 2/2 pass
  - Store delete: 2/2 pass
  - User store visibility: 8/8 pass
  - Store CRUD: 9/9 pass
  - Multiple images: 2/2 pass
  - **User deactivation & historical identity: 14/14 PASS**
- Server admin delete unit tests (18 scenarios): PASS
- Full schema-wide function audit: ALL 23 functions classified — 8 intentionally without active check, 15 enforce correctly
- `current_user_is_active()` updated to check `is_active AND removed_at IS NULL`, applied to remote
- RLS complete hardening: ALL 23 policies (11 corrected) include `current_user_is_active()`
- 21/21 migrations synced local↔remote (22nd and 23rd pending remote sync)
- User deactivation E2E spec validated: `tests/e2e/admin-user-removal.spec.js` (14 tests, **ALL PASS**) — includes new tests: Auth REST denial (06b) + stale-session PostgREST mutation block (08b)
- 26 stale E2E removed users purged via `scripts/maintenance/purge-stale-e2e-users.js`; zero leftovers verified

### E2E Playwright webServer root cause & fix
| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| `page.goto: Timeout 15000ms` | `reuseExistingServer: false` detected port occupied by orphaned `node server.js` (survived `npm start` kill) | Changed command to `node server.js`, added `stdout/stderr: 'pipe'` |

## Deferred work priority

1. Inventory Phase 3C: CSV/XLSX import/export, stock trend indicators, E2E tests for inventory dashboard.
2. Review remaining global wrappers only when they cause active maintenance pain (accepted technical debt).
3. Revisit architectural decisions (see Pending decisions table) when use cases emerge.
4. Investigate parallel E2E `storageState` hypothesis (shared admin auth, parallel-only failure — `--workers=1` temporary mitigation).
5. Historical actor display audit complete: only `requester_name` is rendered; `placed_by_id`, `received_by_id`, `uploaded_by_id` queried but never displayed; drawer shows no requester (intentional). No frontend changes needed.
6. Clean up 26 stale removed users from prior failed E2E runs — **DONE** (all purged via `scripts/maintenance/purge-stale-e2e-users.js`; zero leftovers verified).
