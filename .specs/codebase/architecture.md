# Architecture

**Pattern:** Small web app with Express-served frontend + Cloudflare Pages Functions for deployment, modular browser globals, Supabase-backed data layer.

## High-Level Structure

```text
Browser
  -> Cloudflare Pages static `public/` (production)
  -> Express static `public/` (local dev)
  -> `/api/config`, `/api/health`, `/api/admin/users`
  -> Supabase Auth/Postgres/Storage directly for app data

Admin user CRUD
  Browser `UsersDataModule`
  -> Express `/api/admin/users` (local) or Pages Functions (production)
  -> `supabase-admin-service.js` (Express) or `functions/_shared/admin-service.js` (Pages)
  -> Supabase Auth Admin + REST with service role

Two-runtime strategy:
  Express mode: `node server.js` — local dev, E2E tests
  Pages mode: `wrangler pages dev public` — Cloudflare preview
  Portable core in `functions/_shared/` — shared by both runtimes
  Contract tests prevent behavioral drift between runtimes
```

## Browser Security Boundary

- `public/_headers` defines Cloudflare Pages security headers including CSP.
- External CDN scripts in `public/index.html` are version-pinned and protected by SRI + `crossorigin="anonymous"`.
- Supabase browser APIs require `connect-src https://*.supabase.co`.
- Supabase Storage signed image URLs require `img-src https://*.supabase.co`.
- Current Tailwind CDN usage requires `script-src 'unsafe-eval'` and inline script/style allowances; stricter CSP depends on vendoring/building Tailwind.
- Express local runtime does not apply Cloudflare `_headers`; browser CSP validation must use Pages preview or deployed Pages.

## Identified Patterns

### Thin Server Shell

**Location:** `server.js`, `src/server/app.js`  
**Purpose:** Serve frontend, expose safe config, protect server-only admin operations.  
**Implementation:** `server.js` loads env and starts `app`; `app.js` mounts JSON parsing, `/api/admin/inventory`, `/api/admin/users`, `/api/admin/orders`, `/api/config`, `/api/health`, static `public/`, and known UI route fallback.  
**Example:** `src/server/app.js` serves only `public/` through `express.static(PUBLIC_DIR)`.

### Browser Route Registry

**Location:** `public/js/core/app-shell.js`  
**Purpose:** Central route definitions, partial loading, permission checks, page lifecycle.  
**Implementation:** `getRouteList()` maps route path to title, resource, template/render function, initializer, and optional cleanup.  
**Example:** `/pedidos` loads `/pages/pedidos.html` then calls `OrdersModule.afterRenderPedidos()`.

### Page Modules As Globals

**Location:** `public/js/pages/**`  
**Purpose:** Keep page behavior separated without build tooling.  
**Implementation:** IIFEs attach modules like `OrdersModule`, `FormModule`, `UsersModule`, `StoresModule` to `window`.  
**Example:** `public/js/pages/orders/orders-data.js` exports `window.OrdersDataModule`.

### Stores Partial And Event Binding

**Location:** `public/pages/lojas.html`, `public/js/pages/stores/stores-module.js`
**Purpose:** Render stores page as partial and bind controls programmatically.
**Implementation:** `/lojas` loads `public/pages/lojas.html`; `StoresModule.afterRenderLojasCadastro()` binds search, brand filter, status filter, new-store button, and table actions through DOM events.
**Example:** table edit/toggle actions use delegated click handling on `#tbody-lojas`.

### Shared Pure Rules

**Location:** `public/js/shared/order-rules.js`, `public/js/shared/app-utils.js`  
**Purpose:** Reuse validation, role mapping, status mapping, permission helpers in browser and Node tests.  
**Implementation:** Browser global plus `module.exports` when available.  
**Example:** `OrderRules.validateOrderForm()` is required by `tests/frontend/order-rules.test.js`.

### Server-Side Admin Boundary

**Location:** `src/server/routes/users-admin.js`, `src/server/services/supabase-admin-service.js`  
**Purpose:** Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.  
**Implementation:** Route extracts bearer token, service validates active admin caller, then performs Auth Admin and REST operations.  
**Example:** `assertActiveAdmin()` validates `/auth/v1/user`, loads `profiles`, requires active `admin`.

## Data Flow

### Authentication

1. `AuthModule.bootstrap()` initializes Supabase using `/api/config`.
2. Supabase session restored with `sb.auth.getUser()`.
3. Profile loaded from `profiles`.
4. Inactive users are signed out and blocked.
5. Role `USER`/`ADMIN` is normalized to UI role `loja`/`admin`.
6. `AppShellModule.handleRouteChange()` renders authorized route.

### Order Creation And Resubmit

1. `/novo-pedido` loads `public/pages/novo-pedido.html`.
2. `FormModule` validates fields and image with `OrderRules`.
3. `OrdersDataModule.enviarPedidoAPI()` calls `create_order` RPC.
4. Items are inserted into `order_items`.
5. Image uploads to private `order-images` bucket.
6. Metadata is inserted into `order_images`.
7. `submit_order` RPC moves draft to `PENDING_APPROVAL`.
8. Retry with `draft_order_id` only reruns `submit_order`.

#### Delivery Lifecycle (APPROVED → ORDER_PLACED → RECEIVED)

1. Admin opens order drawer on `APPROVED` status → sees delivery form (protocol + date).
2. Admin fills protocol + delivery date, clicks "Marcar como Realizado".
3. `OrdersDataModule.markOrderPlacedAPI()` calls `mark_order_placed` RPC.
4. RPC validates active ADMIN + `APPROVED` status.
5. Order updated: `delivery_protocol`, `delivery_date`, `placed_by_id`, `placed_at`, status `ORDER_PLACED`.
6. Server appends `status_history` + `audit_logs`.
7. Requester opens order drawer on `ORDER_PLACED` → sees confirm modal with invoice number + item unit values.
8. Requester fills invoice number + unit value per item, clicks "Confirmar Recebimento".
9. `OrdersDataModule.confirmReceiptAPI()` calls `confirm_order_received` RPC with `p_invoice_number` + `p_item_values`.
10. RPC validates active requester + ownership + `ORDER_PLACED` status.
11. Creates `order_receipts` row with invoice number.
12. Insert `store_stock_receipts` rows with unit value and computed total value.
13. Order updated: `received_by_id`, `received_at`, status `RECEIVED`.
14. Server appends `status_history` + `audit_logs`.
15. Retry rejected: status check fails (idempotent).

#### CHANGES_REQUESTED Resubmit (edit-and-resubmit)

1. Admin calls `request_order_changes` RPC → status `CHANGES_REQUESTED`.
2. Requester opens `/novo-pedido?orderId=...` → `FormModule` in edit mode.
3. `OrdersDataModule.resubmitChangedOrderAPI()` calls `resubmit_changed_order` RPC.
4. RPC validates active requester + ownership + `CHANGES_REQUESTED` status.
5. Old `order_items` deleted, new items inserted (atomic).
6. If new image: old storage objects deleted, old `order_images` deleted, new metadata inserted.
7. If no new image: existing `order_images` preserved.
8. Order updated to `PENDING_APPROVAL` (same `order_id`).
9. Server appends `status_history` + `audit_logs`.
10. Retry rejected: status no longer `CHANGES_REQUESTED`.

### Admin Inventory Management

1. Admin sends bearer-token requests to `/api/admin/inventory`.
2. Express or Pages route validates active ADMIN via Supabase Auth and `profiles`.
3. Service role performs inventory CRUD and quantity adjustments against `inventory_items` + `inventory_movements`.
4. `product_code` normalized via `upper(btrim(product_code))` for unique per-store SKU matching.
5. `inventory_movements` are immutable INSERT-only — adjust endpoint writes movement record.

### Inventory Frontend

1. Normal users access `/estoque` (resource `inventory-read`) — read-only via RLS-safe Supabase queries.
2. `InventoryDataModule.loadAllItems()` queries `inventory_items` with join to `lojas`, filtered by `user_stores`.
3. Admin users see full list plus create/edit/adjust controls gated by `data-resource="inventory-admin"`.
4. Create/update/adjust goes through `InventoryDataModule` → `fetch` to `/api/admin/inventory`.
5. Movement history opens inline modal via `InventoryDataModule.loadMovementHistory()` (RLS-safe Supabase query on `inventory_movements`).
6. Dashboard inventory section: 4 stat cards (SKUs ativos, abaixo do mínimo, alertas em pedidos, SKUs sem estoque), Alertas de Estoque table (3 alert types), Top SKUs em Pedidos.
7. Dashboard data loaded in `afterRenderDashboard()` via `InventoryDataModule.loadAllItems()` + direct Supabase query on orders with items.
8. RLS handles scope: normal users see only linked stores; admins see all stores.
9. Graceful degradation: dashboard remains usable if inventory data fails (try/catch).
10. Phase 3A: manual stock management only; no auto-deduction, no reservation.

### Admin User Management

1. `/usuarios` initializes `UsersModule`.
2. `UsersDataModule` sends bearer token to `/api/admin/users`.
3. Express route validates active ADMIN via Supabase Auth and `profiles`.
4. Service role performs user list/create/update/delete, store links, audit logs.

## Code Organization

**Approach:** Layered by runtime and feature.

**Structure:**

- `public/`: browser shell, partials, styles, frontend modules.
- `src/server/`: Express app, routes, server-only services.
- `supabase/`: schema migrations and read-only verification SQL.
- `tests/`: Node-based frontend and server tests.
- `scripts/`: admin, maintenance, smoke scripts.

**Module boundaries:** Frontend modules communicate through explicit dependency objects from `AppShellModule`; server route delegates admin logic to service module.

---

## Asset Serving & Cache Strategy

### Static file serving
- `express.static(PUBLIC_DIR, { setHeaders })` in `src/server/app.js`
- `.html`, `.js`, `.mjs` files get `Cache-Control: no-store, max-age=0`
- Other file types (CSS, images, fonts) keep `Cache-Control: public, max-age=0` (default Express behavior with ETag revalidation)
- SPA route fallbacks (`/dashboard`, `/login`, etc.) also set `Cache-Control: no-store, max-age=0`

### Version marker
- `window.APP_VERSION` in `public/index.html` — single source of truth
- Incremented as part of each release/deployment

### Asset versioning
- All local `<script src>` and `<link>` tags in `index.html` include `?v=APP_VERSION` query string
- Partial HTML loading (`app-shell.js` → `loadPagePartial()`) appends `?v=APP_VERSION` to fetched partial URLs
- CDN/external scripts remain unversioned (immutable CDN URLs)
