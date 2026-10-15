# QA Project Context — Sfera VM

## Product

**Name:** Sfera VM  
**Description:** Plataforma de pedidos da Sfera Multifranquias. Usuários de loja criam e acompanham pedidos de material; administradores revisam, aprovam/rejeitam e gerenciam usuários e lojas.  
**Type:** Internal web application (SaaS-like multi-tenant).  
**URLs:** Local Express `http://localhost:3000`. Cloudflare Pages preview `http://localhost:8788`. Production and staging URLs not documented in repository.

### Critical User Journeys
1. Login with email+password, session restore on page reload, blocked/inactive user denial.
2. Dashboard load showing order stats (counts by status).
3. Create draft order: select store, product type, add items, upload image (JPEG/PNG/WebP, max 5 MB).
4. Submit draft order → status `PENDING_APPROVAL` with retry idempotency.
5. Admin review: approve, reject (final), or request changes (`CHANGES_REQUESTED`).
6. Requester edits and resubmits order after `CHANGES_REQUESTED` — same order_id, atomic RPC.
7. Admin deletes order with password reauthentication, clears storage.
8. Admin CRUD users: create (with temp password), edit, list with pagination/filters, remove (soft delete with historical identity).
9. Store CRUD: create, edit, toggle active/inactive, delete.
10. Inventory management (Phase 1, admin-only API): list, create, update, adjust stock quantity with reason.
11. Permission filtering: store visibility via `user_stores`, admin routes gated by role.

## Tech Stack

### Frontend
- **Language:** Vanilla JavaScript (no framework).
- **Markup:** HTML partials under `public/pages/`.
- **Styling:** Tailwind CSS (CDN), custom CSS files under `public/styles/pages/`.
- **SDK:** `@supabase/supabase-js` v2.108.2 vendored at `public/vendor/supabase/supabase.js`.
- **Icons:** Lucide (CDN via `unpkg`).
- **Routing:** History API via `public/js/core/app-shell.js`.

### Backend — Local Development
- **Runtime:** Node.js, Express `^4.19.2`.
- **Entry point:** `server.js` → `src/server/app.js`.
- **Admin routes:** `src/server/routes/users-admin.js`, `src/server/routes/orders-admin.js`, `src/server/routes/inventory-admin.js`.
- **Admin service:** `src/server/services/supabase-admin-service.js` (service role).

### Backend — Production
- **Runtime:** Cloudflare Pages Functions (ESM, Web Crypto, `context.env`).
- **Function files:** `functions/api/config.js`, `functions/api/health.js`, `functions/api/admin/users/index.js`, `functions/api/admin/users/[id].js`, `functions/api/admin/orders/[id].js`, `functions/api/admin/inventory/index.js`, `functions/api/admin/inventory/[id].js`.
- **Shared modules:** `functions/_shared/admin-core.js` (pure functions), `admin-service.js` (factory), `env.js`, `http.js`.

### Database & Storage
- **Database:** Supabase PostgreSQL.
- **Auth:** Supabase Auth (email+password, session tokens).
- **Storage:** Supabase Storage bucket `order-images` (private).
- **Client SDK:** `supabase-js` (browser), service role REST calls (server).
- **Migrations:** Incremental under `supabase/migrations/` (21 applied).
- **Verification:** Read-only SQL under `supabase/verification/`.

### Hosting & Infra
- **Local dev:** Express on `PORT` (default 3000).
- **Production:** Cloudflare Pages + Pages Functions.
- **Tooling:** Wrangler `^4.106.0` for preview.
- **CI security scanning:** `.github/workflows/security-scan.yml` runs npm audit/OSV, Semgrep, and TruffleHog on PR, `main`, and weekly schedule.

## Test Stack

### E2E
- **Framework:** Playwright `^1.61.0`.
- **Config:** `playwright.config.js` (project root).
- **Test directory:** `tests/e2e/`.
- **Browser:** `msedge` (channel), `--workers=1`.
- **Web server:** `node server.js` (not `npm start`).
- **Screenshots/traces:** captured on failure only.
- **Helpers:** `tests/e2e/helpers/auth.js`, `runtime.js`, `users-admin.js`, `disposable-user-fixtures.js`.

### Unit / Integration
- **Runner:** Custom Node.js scripts with `node:assert`, `vm`, `fs`, `path` — no Jest, Vitest, or Mocha.
- **Test directories:** `tests/frontend/`, `tests/server/`.
- **Naming:** `*.test.js`.
- **Inventory test:** `tests/server/inventory-admin.test.js` covers auth gates, CRUD, quantity adjustment, validation, prototype pollution.

### Smoke
- **Tool:** PowerShell script via `npm run test:smoke`.

### Manual
- **Status:** No manual test cases or suites documented in repository.

## CI/CD
- **Platform:** GitHub Actions security scanning detected. Deploy target is Cloudflare Pages (manual via dashboard or Wrangler CLI).
- **Run triggers:** Security scan runs on PR, push to `main`, and weekly schedule. Functional gates still run locally.
- **Blocking gates:** `npm run validate` (check + test + smoke) passes before deploy. Security scan workflow is present; gating policy remains advisory until branch protection is configured.

## Environments

| Environment | Runtime | URL | Notes |
|-------------|---------|-----|-------|
| Local dev | Express | `http://localhost:3000` | `.env` with Supabase keys |
| Pages preview | Wrangler | `http://localhost:8788` | Requires `.dev.vars` with real keys |
| Production | Cloudflare Pages | Unknown | Deployed manually via Cloudflare Dashboard |
| Staging | Unknown | Unknown | Not documented |

Staging/production URLs, Supabase Auth redirect configuration, and production environment parity unknown.

## Quality Goals

- **Coverage target:** Not defined.
- **Flake tolerance:** Not defined.
- **Suite duration:** Not defined.
- **Current gates:** `npm run check` (static syntax + reference validation), `npm test` (20 Node scripts), `npm run test:smoke` (PowerShell), `npm run validate` (all three combined).
- E2E suite runs only on explicit `npm run e2e` with environment variables. Not gated in CI.

## Risk Areas

| Area | Risk Level | Business Impact | Notes |
|------|-----------|----------------|-------|
| Auth + session restore | Critical | Complete app inaccessible. Data exposure on auth bypass. | Supabase Auth session, RLS, `is_active`, `removed_at` gates. Stale JWT after removal is a known attack surface. |
| Order submit/resubmit | Critical | Lost orders, duplicate orders, incorrect status. | Multi-stage RPC (`create_order`, image upload, `submit_order`). Retry idempotency. `CHANGES_REQUESTED` resubmit atomic RPC. Image storage cleanup on resubmit. |
| Admin user management | Critical | Privilege escalation, ghost accounts, loss of audit trail. | Soft remove preserves FK references. ADMIN final protection. `current_user_is_active()` on all mutating RPCs. |
| Image upload + storage | Critical | Stale/dead objects, broken image links, storage billing leak. | Private bucket. No lifecycle policy documented. Storage cleanup relies on application-level logic. |
| Express vs Pages API parity | Important | Production-only bugs despite local tests passing. | Contract tests validate core pure functions and file existence but cannot validate Cloudflare runtime env injection. |
| Store visibility | Important | Users see wrong stores or miss their stores. | `user_stores` filtering in backend. `getStoreById()` fallback behavior differs for admin vs non-admin. |
| Inventory API / RLS | Important | Non-admin users read inventory for linked stores via RLS. No frontend page yet — API-only Phase 1. | Admin-only endpoints at `/api/admin/inventory`. RLS policies on `inventory_items` grant SELECT for linked stores. No write access via RLS. |
| RLS regression | Critical | Data leakage or unauthorized mutation. | 21 migrations, 11 RLS policies hardened with `current_user_is_active()`. Inventory migration adds 3 new policies. Any new migration risks policy gap. |
| SQL / PostgREST injection | Critical | Data exfiltration, deletion, or privilege escalation. | Static analysis confirms no dynamic SQL in migrations. All PostgREST URLs use `URLSearchParams` or `encodeURIComponent`. Route UUID params validated. Filter normalization in-memory (not SQL). Constant validation via `security-hardening.test.js` (11 sections). |
| XSS / DOM injection | Critical | Session theft, UI defacement, phishing. | `escapeHtml()` in shared utils. Allowlist-based role/status/icon mappers. `data-*` attribute delegation. No inline events in partials or generated HTML. Enforced by `xss-escape.test.js` (52 tests) + `no-inline-events.test.js` (48 tests). |
| Express route injection | High | Unauthorized access, mass assignment. | UUID validation before mutation. Body field allowlists strip unknown keys. `__proto__`/`constructor`/`prototype` rejected. Content-Type enforcement (415). Enforced by `security-hardening.test.js` sec 3. |
| CORS misconfiguration | High | Cross-origin data theft. | `isLocalOrigin()` restricts to loopback only. No `credentials: true`. Tested via `security-hardening.test.js` sec 7 (16 assertions). |
| Error information leakage | Medium | Upstream detail leakage aids attackers. | `sendAdminError` does not include `password` or `token` values. `jsonParseErrorHandler` does not expose `err.message` or `err.body`. Verified via `security-hardening.test.js` sec 4-5. |
| E2E runtime guards | Critical | Accidental production mutation. | `E2E_TARGET_ENV` rejects `production`/`prod`/`live`. `E2E_ALLOW_LIVE_WRITES` and `E2E_ALLOW_LIVE_CRUD` must be exactly `true`. Enforced by `e2e-runtime-safety.test.js` (19 tests). |
| Verification SQL safety | Medium | Destructive SQL executed on live DB. | All 7 verification files start with SELECT. Checker strips SQL comments before validation. No `fetch`, `pg.Client`, or `psql` calls. Enforced by `supabase-verification-assets.test.js` (10 test groups). |
| CSP / SRI drift | High | Browser fails to boot or CDN tampering risk. | CSP baseline in `public/_headers`; CDN scripts pinned + SRI; static guards in `cloudflare-pages-contract.test.js`. Browser validation under Pages preview still pending. Tailwind CDN requires `unsafe-inline`/`unsafe-eval`. |

## Team

- **Size:** Unknown. No QA headcount documented.
- **Dev:QA ratio:** Unknown.
- **Methodology:** Unknown.
- **QA engagement point:** Unknown.

## Conventions

### Test naming
- Unit/integration: `*.test.js` in `tests/frontend/` and `tests/server/`.
- E2E: `*.spec.js` in `tests/e2e/`.

### Selector strategy
- No formal documented standard observed.
- Existing E2E tests use:
  - `data-*` attributes (`[data-user-action="edit"]`, `[data-store-action="toggle"]`).
  - Element IDs (`#login-screen`, `#content`, `#sidebar`).
  - CSS classes for status fields (`.status-badge`).
  - Some inline `onclick` handlers in legacy HTML (partials are clean, `index.html` shell has some).
- Recommendation for new tests: prefer `data-testid` attributes for stability.

### Partial HTML rules
- Partials under `public/pages/` must not contain `<!doctype>`, `<html>`, `<head>`, `<body>`, `<script>` tags, or inline event handlers (`onclick`, `onchange`, `onsubmit`). Enforced by `npm run check`.

### Environment variables
- Browser-safe: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `PORT`.
- E2E: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_TARGET_ENV`, `E2E_ALLOW_LIVE_READS`, `E2E_ALLOW_LIVE_WRITES`, `E2E_ALLOW_LIVE_CRUD`.
  - `E2E_TARGET_ENV` identifica o ambiente alvo (`local`, `test`, `testing`, `staging`, `preview`). Não autoriza mutações por si só; exige também `E2E_ALLOW_LIVE_WRITES` ou `E2E_ALLOW_LIVE_CRUD`. Valores de produção são rejeitados. Nunca deve ser usado para autorizar escritas em produção.
- Files: `.env` (local), `.env.e2e` (E2E), `.dev.vars` (Pages Functions local).

### Git conventions
- Stale generated files (`.wrangler/tmp/`) ignored by check script after fix. `.env`, `.dev.vars` in `.gitignore`.

## Known Testing Limitations

1. No functional CI pipeline: security scanning exists, but `npm run validate` is still local/manual and no branch protection is documented.
2. No headless unit test framework: custom Node `vm` scripts cannot mock browser globals well; ESM `functions/` code requires dynamic import for testability.
3. Live Supabase required for E2E: local Supabase stack is configured (`supabase/config.toml`, api:54321, db:54322) but not active. E2E tests run against whichever Supabase instance is configured via environment variables (remote by default).
4. No staging environment documented: changes validated only on local Express + remote Supabase.
5. No numeric quality targets: no coverage %, flake %, or suite duration budgets defined.
6. Team size unknown: automation ownership model unclear.
7. Playwright runs without trace viewer by default; traces on failure only.
8. No visual regression testing.
9. No performance/load testing.
10. No accessibility (a11y) testing.
11. Security hardening tests are static analysis + contract tests. No live Supabase / hosted environment validation performed. SQL injection testing covers migration files, PostgREST URL construction, and route param validation, but not RPC/RLS bypass via real Supabase.
12. CSP/SRI baseline is static-tested but not browser-validated under Cloudflare Pages preview. Tailwind CDN + inline script/style still require weak CSP directives (`unsafe-inline`, `unsafe-eval`).

## Commands

### Safe to run (read-only, no mutation)
- `npm run check` — static syntax, partial markup, local reference validation (66 files).
- `npm test` — 20 Node test scripts (frontend + server + security + contract).
- `npm run test:smoke` — PowerShell smoke checks.
- `npm run validate` — runs check + test + smoke sequentially.
- `npm run preview:pages` — starts Wrangler local dev server (`pages dev`). Command itself is read-only. Browser actions against the preview server may call the configured Supabase project if `.dev.vars` contains real keys.

### May modify real data
- `npm run e2e` — Playwright E2E suite against live Supabase. Mutates data when `E2E_ALLOW_LIVE_WRITES=true` or `E2E_ALLOW_LIVE_CRUD=true`. Requires `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`. Writes include: creating users, orders, stores; uploading/deleting images; removing users. Uses disposable user fixtures with cleanup.
- `npm run test:e2e:ui` — Playwright UI mode (`playwright test --workers=1 --ui`).
- Individual E2E spec files with live mutations: `admin-user-removal.spec.js`, `admin-users.spec.js`, `store-crud.spec.js`, `store-delete.spec.js`, `order-delete.spec.js`, `order-resubmit.spec.js`, `order-lifecycle-ui.spec.js`, `order-multiple-images.spec.js`, `user-store-visibility.spec.js`.
- `npm run create:admin` — admin user creation script.
- `supabase db push` — applies migrations to local Supabase by default; `supabase db push --linked` targets linked remote project.
- `supabase db up` — referenced in README as targeting local Supabase, but is not a standard Supabase CLI command. Use `supabase db push` for local or `supabase db push --linked` for remote.
- Direct REST/RPC calls via helper scripts using `service-role` key.

## Security Test Tiers

| Tier | Location | Scope | Approval Required |
|------|----------|-------|-----------------|
| Static / local safe | `tests/server/security-hardening.test.js` | Migration SQL, filter norm, PostgREST URL, route injection, XSS, inline events, CORS, error safety | No |
| Static / local safe | `tests/server/e2e-runtime-safety.test.js` | E2E env guards, target validation, production rejection | No |
| Static / local safe | `tests/server/supabase-verification-assets.test.js` | Verification SQL syntax, destructive keyword rejection | No |
| Express integration | `security-hardening.test.js` sec 6 | CORS headers, preflight, local origin restriction | No |
| Supabase local | N/A (not active) | RLS, active-user denial, stale-session block, Storage policy | Yes |
| Hosted non-production | `tests/e2e/*.spec.js` | Live RLS, IDOR, stale session, admin route denial, Storage | Yes (requires `E2E_*` flags) |
| Destructive | E2E specs + scripts | Admin remove, order delete, backup/restore drill | Separate explicit approval |

## Risk Priority

| Priority | Risk | Coverage |
|----------|------|----------|
| P0 Critical | IDOR, RLS bypass, stale session, admin route bypass, Storage leak | Static tests + E2E (hosted) |
| P0 Critical | SQL / PostgREST injection | `security-hardening.test.js` sec 6-9 |
| P0 Critical | XSS, DOM injection | `xss-escape.test.js`, `no-inline-events.test.js` |
| P1 High | Mass assignment, route injection | `security-hardening.test.js` sec 3, 9 |
| P1 High | CORS misconfiguration | `security-hardening.test.js` sec 6-7 |
| P2 Medium | Error leakage, brute force | `security-hardening.test.js` sec 4-5. Rate limit: not tested |
| P3 Operational | Backup/restore, staging parity, CI scanning | Not validated |

## Forbidden

- Production writes: never. Any command targeting `production`/`prod`/`live` env is rejected.
- Remote DB mutation without explicit approval and non-production target.
- Printing secrets, tokens, passwords, or service-role key.
- Weakening RLS or Storage policies to make tests pass.
- `supabase db reset` against remote.
- Purge scripts on non-test data.

## Verification

```bash
test -f .agents/qa-project-context.md \
  && ! grep -nE '<[^>]+>|TODO_PLACEHOLDER|TBD_PLACEHOLDER|REPLACE_ME' .agents/qa-project-context.md \
  && echo "context complete: file exists, no placeholders"
```
