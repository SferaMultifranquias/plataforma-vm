# Workflows And Operations

## Order Creation

Current order creation flow:
- User opens `/novo-pedido`.
- `FormModule` loads stores, manages item state, validates fields through `OrderRules`.
- Required image must be JPEG, PNG, or WebP and within configured size limit in form code.
- `OrdersDataModule.enviarPedidoAPI` creates or reuses order draft.
- New submission calls `create_order` RPC, inserts `order_items`, uploads image to `order-images`, inserts `order_images`, then calls `submit_order`.
- Retry with `draft_order_id` calls only `submit_order`; it does not recreate order, items, upload, or image rows.

Important behavior:
- Direct insert fallback no longer exists in `orders-data.js`; `create_order` is the only frontend order-creation path.
- Store visibility was live-verified through Playwright E2E. `tests/e2e/user-store-visibility.spec.js` passed 8/8 scenarios, including browser-side tampering with an unauthorized `loja_id`.

### Order Resubmit After CHANGES_REQUESTED

1. Admin calls `request_order_changes` → order status becomes `CHANGES_REQUESTED`.
2. Requester opens `/novo-pedido?orderId=<id>` → edit mode with banner.
3. Requester modifies items, justification, priority, notes. Photo is optional in edit mode.
4. `resubmitChangedOrderAPI` uploads new photo (if provided), then calls `resubmit_changed_order_multi_image` RPC.
5. RPC validates active requester (owns order, `CHANGES_REQUESTED` status).
6. Old `order_items` deleted; new items inserted.
7. If new photo: old `order_images` + old storage objects deleted; new metadata inserted.
8. If no new photo: existing `order_images` preserved.
9. Order updated to `PENDING_APPROVAL` (same `order_id`).
10. Server appends one `status_history` entry and one `audit_logs` entry.
11. Retry is rejected because status is no longer `CHANGES_REQUESTED` (idempotent).

## Order Review

Review states:
- `DRAFT`: editable before submit.
- `PENDING_APPROVAL`: admin decisionable state.
- `CHANGES_REQUESTED`: correction state (admin requests edits).
- `APPROVED`: admin approved.
- `ORDER_PLACED`: admin placed order with delivery protocol + date.
- `RECEIVED`: requester confirmed receipt (final state).
- `REJECTED`: final rejected state.

Rules:
- Only ADMIN may approve, reject, or request changes.
- Regular USER must not approve/reject.
- Status transitions create `status_history` records.
- Requester may edit and resubmit after `CHANGES_REQUESTED` via `/novo-pedido?orderId=<id>` (uses `resubmit_changed_order_multi_image` RPC).
- `resubmit_changed_order` remains as legacy/single-image compatibility RPC.
- After ADMIN approves, ADMIN may `mark_order_placed` → `ORDER_PLACED` (sets protocol, date, placed_by).
- After placed, requester may `confirm_order_received` → `RECEIVED` (sets received_by, received_at).
- `APPROVED` is NOT final; `RECEIVED` is the sole terminal delivery state.

## User Administration

Admin UI:
- `/usuarios` is ADMIN-only.
- `UsersModule` renders filters, table, modal, pagination, create/edit/remove actions.
- `UsersDataModule` sends bearer-token requests to `/api/admin/users`.

Server flow:
- `users-admin.js` extracts bearer token.
- `supabase-admin-service.js` validates token with Supabase Auth (`auth/v1/user`), loads caller profile, requires active ADMIN.
- Service role is then used server-side for Auth admin and REST operations.
- `p_caller_id` derived from validated `caller.authUser.id`, never from request body.

Supported operations:
- List users with filters and pagination (default excludes removed users; `status=removed` filter shows them).
- Create user with generated temporary password.
- Update profile fields, role, active status, password, and store links.
- Remove user (soft-remove: `is_active=false`, `removed_at`, `removed_by_id`; Auth disabled via `ban_duration: '876000h'`).
- Removed users: profile/Auth preserved, FKs intact, display shows `— usuário removido`.

Manual validation still recommended:
- Create user.
- Edit user.
- Block/unblock user.
- Remove user (verify historical display).
- Confirm store link behavior.

## Inventory Management (Phase 2 — frontend page + admin API)

Current state:
- Frontend `/estoque` page available at route `/estoque` with resource `inventory-read`.
- Normal users: read-only inventory via RLS-safe Supabase queries (join `lojas`, filter by `user_stores`).
- Admin users: full CRUD and quantity adjustment via `/api/admin/inventory` (Express + Pages Functions).
- Page partial in `public/pages/estoque.html` with toolbar (search, store filter, active/inactive filter, below-minimum checkbox, admin "Novo Item" button), inventory table, create/edit modal with adjustment section, movement history modal.
- `InventoryDataModule` (`public/js/pages/inventory/inventory-data.js`): RLS-safe reads + admin API calls.
- `InventoryModule` (`public/js/pages/inventory/inventory-module.js`): page logic, filters, render, modals, event binding with dedup via `dataset.bound`.
- Admin-only create/edit/adjust controls gated by `data-resource="inventory-admin"` + `isAdmin` check.
- `GET /api/admin/inventory` — list inventory items with store, product_code, current_quantity.
- `POST /api/admin/inventory` — create new inventory item (store_id, product_code, description, initial_quantity).
- `PATCH /api/admin/inventory/:id` — update item metadata (product_code, description).
- `POST /api/admin/inventory/:id/adjust` — adjust quantity with `delta` and `reason`; writes to `inventory_movements`.
- Product code normalized via `upper(btrim(product_code))` for unique per-store matching.
- Phase 2: manual stock management only; no auto-deduction, no reservation.

### Dashboard Inventory Indicators (Phase 3A)

Current state:
- 4 stat cards on dashboard: SKUs ativos, Abaixo do Mínimo, Alertas em Pedidos, SKUs sem Estoque
- Alertas de Estoque table: loja, SKU, description, current_quantity, minimum_quantity, ordered_qty, alert_type
- Alert types: Abaixo do mínimo (inventory), Pedido acima do estoque atual (order > stock), SKU pedido sem estoque cadastrado (no inventory record)
- Top SKUs em Pedidos: top 10 SKUs by total ordered quantity grouped by store+product_code
- Data sources: `InventoryDataModule.loadAllItems()` for inventory, direct Supabase query on `orders` with `order_items` for pending/active orders
- RLS-scoped: normal users see only linked stores; admins see all stores
- Graceful degradation: dashboard remains functional if inventory query fails (cards show "—", sections show error state)
- Deferred to Phase 3B: CSV/XLSX import/export, auto-deduction on order fulfillment, stock trend indicators, full E2E tests.

## Stores

Current state:
- `/lojas` uses `public/pages/lojas.html`.
- `StoresModule.afterRenderLojasCadastro()` binds page controls and loads table data.
- `StoresModule` handles table load, filtering, modal actions, and store maintenance.

Completed cleanup:
- Legacy `PagesModule.renderLojasCadastro()` removed.
- `public/js/legacy/pages-module.js` removed from runtime.

## Testing

Commands:
- `npm run check`: syntax, partial markup, and local reference checks.
- `npm test`: 21 Node-based frontend/server/security/contract tests (25 inventory groups including dashboard indicators).
- `npm run test:smoke`: PowerShell smoke test.
- `npm run validate`: check, tests, smoke.
- `npm run e2e`: Playwright E2E headless (49 tests, requires env vars, runs with `--workers=1`).

E2E Playwright server: `node server.js` (not `npm start`); Playwright manages lifecycle.

## Operational Constraints

- Do not modify applied migrations; add new migration only when approved.
- Do not run Supabase remote mutations or migrations without explicit approval.
- Do not print `.env` values or secrets.
- Do not weaken RLS or storage policies to pass tests.
- Do not stage or commit without request.
- Preserve unrelated worktree changes.
- Do not run E2E or purge scripts without explicit approval.
- `p_caller_id` must come from server-validated caller, never from request body.
- `is_admin()` is DB-backed (reads `public.profiles`), not JWT-based.

## Security Verification

Static/local flow:
- Run `npm run check`.
- Run `npm test`.
- Confirm `cloudflare-pages-contract.test.js` passes CSP/SRI/workflow guards.

Browser CSP flow:
- Use Pages preview, not Express, because Cloudflare `_headers` are required for CSP.
- Run `E2E_REQUIRE_CSP=true npm run e2e -- tests/e2e/csp-smoke.spec.js --workers=1` against preview.
- Fail on console CSP violations, SRI failures, missing CDN globals, or missing CSP response header.

Hosted security flow:
- RLS, IDOR, Storage privacy, and stale-session checks require explicit non-production approval.
- Do not run hosted mutations unless `E2E_TARGET_ENV` is non-production and `E2E_ALLOW_LIVE_*` flags are intentionally enabled.
