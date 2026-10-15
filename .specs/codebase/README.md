# Brownfield Codebase Map

Snapshot: 2026-06-30 (handoff finalization).

Purpose: Sfera VM order platform. Store users create orders; admins review, approve, reject, request changes, manage users, and manage stores.

Tech stack:
- Node.js entrypoint with Express server.
- Pure HTML, CSS, and browser JavaScript frontend. No frontend framework.
- Supabase Auth, PostgreSQL, RLS, RPCs, and private Storage.
- Browser loads Supabase JS from CDN and receives only public config from `/api/config`.

Repository layout:
- `server.js`: thin server entrypoint. Loads `.env`, imports `src/server/app.js`, starts listener.
- `src/server/app.js`: Express app, public config endpoint, health endpoint, admin users router, static `public/` serving, UI route fallback.
- `src/server/routes/users-admin.js`: protected `/api/admin/users` route handlers.
- `src/server/services/supabase-admin-service.js`: service-role admin user operations and caller admin validation.
- `public/index.html`: app shell, sidebar, shared modals/drawers, script/style loading.
- `public/pages/`: HTML partials for login, orders, new order, users.
- `public/js/core/`: router and auth bootstrap.
- `public/js/shared/`: shared mapping, permission, status, and order validation utilities.
- `public/js/pages/`: page modules for dashboard, orders, order form, stores, and users.
- `public/pages/lojas.html`: dedicated stores partial.
- `public/styles/pages/`: page-level CSS.
- `supabase/migrations/`: versioned schema, RLS, RPC, storage policy migrations.
- `supabase/verification/`: read-only SQL verification scripts.
- `tests/frontend/`: DOM/module tests run with Node.
- `tests/server/`: Express and admin service tests run with Node.
- `scripts/maintenance/check-project.js`: syntax and reference checker.
- `scripts/admin/`: admin creation scripts.
- `scripts/smoke/`: PowerShell smoke test.

Current validation:
- `npm run check`: PASS (53 files)
- `npm test`: PASS (11 suites)
- `npm run test:smoke`: PASS
- `npm run validate`: PASS
- Playwright E2E: 49 tests total, all pass (requires env vars)

Current entry point: `CODEx_CONTEXT.md` — concise handoff with reading order.
Feature detail: `.specs/features/user-deactivation-and-historical-identity/`.

Context caveats:
- `.specs/codebase/README.md` is a static snapshot; current state in `CODEx_CONTEXT.md`.
