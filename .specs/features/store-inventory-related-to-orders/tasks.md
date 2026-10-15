# Stock Lifecycle Tasks

## States
- planned/in progress/implemented/locally validated

## Tasks

### Corrected Migration
- [x] Drop wrong inventory model tables (inventory_items, inventory_movements)
- [x] Drop order_items.inventory_item_id FK
- [x] Revert mark_order_placed to original (no deduction)
- [x] Rewrite confirm_order_received to insert receipt stock
- [x] Create order_item_stock_checks table
- [x] Create store_stock_receipts table
- [x] Create store_stock_balances table
- [x] RLS policies and grants for new tables
- [x] Verification SQL: 20260706_verify_correct_stock_lifecycle.sql
- [x] Migration applied to remote
Status: **locally validated**

### Express Backend
- [x] stock-checks.js route (GET stock checks, PATCH update check)
- [x] received-stock.js route (GET received stock)
- [x] app.js mount /api/admin/stock-checks and /api/admin/received-stock
- [x] supabase-admin-service.js: listStockChecks, updateStockCheck, listReceivedStock, findOrderItemById
- [x] Remove inventory-admin.js route and methods
Status: **locally validated**

### Cloudflare Pages Functions
- [x] stock-checks/index.js (GET+PATCH) and [orderItemId].js (re-export)
- [x] received-stock/index.js (GET)
- [x] Remove old inventory functions
Status: **locally validated**

### Frontend `/estoque`
- [x] inventory-data.js: loadOrderItemChecks, loadReceivedStock, updateStockCheck
- [x] inventory-module.js: allChecks + allReceipts, showBothTables, renderReceivedTable
- [x] estoque.html: checks table + received section (sc-received-* IDs)
- [x] Empty state only when both empty
- [x] Search filters both tables
- [x] Received section hidden when no receipts
- [x] Loja column in both tables (checks + received)
- [x] Loja filter in toolbar (populated from data)
- [x] Status filter affects checks only; loja filter affects both
- [x] Loja column moved to first position in both tables
- [x] colgroup added with width classes (stock-col-*) for fixed-layout alignment
- [x] inventory.css: stock- prefix classes (stores.css card/table pattern)
- [x] inventory.css: table-layout: fixed + min-width for column alignment
- [x] Visual pattern matches Usuários/Lojas pages
- [x] Removed checks table from display; kept checks data for export only
- [x] Export button + dropdown (CSV / XLSX) in toolbar
- [x] CSV: BOM, `;` separator, escapeCsv injection guard
- [x] XLSX: two sheets (Solicitados, Recebidos) via existing `XLSX` library
- [x] Export respects active search and loja filters
Status: **locally validated**

### Tests
- [x] Frontend: 30 test groups (static + received stock + loja column/filter + CSS pattern + export helpers)
- [x] Server: 13 test groups (auth, validation, parity, mutation scope)
- [x] Cloudflare Pages contract: expected files updated
- [x] Verification SQL assets: count 7
Status: **locally validated**

### Invoice/Value on Receipt Confirmation
- [ ] Migration: create order_receipts table, add columns to store_stock_receipts, update RPC
- [ ] Frontend: receipt modal with invoice number + unit value per item
- [ ] Inventory: show invoice/value columns in received table + export
- [ ] Backend: admin APIs expose invoice/value fields
- [ ] Legacy: nullable invoice/value for existing received rows
- [ ] Tests: server RPC contract, frontend modal, inventory display, E2E
Status: **planned**

### Deferred
- Partial receipt (full-order only for now)
- Dashboard inventory indicators (current: no-op)
- Consumption tracking
- Correction/void receipt flow
- E2E tests for stock lifecycle

### Validation
- [x] npm run check (70 files)
- [x] npm test (20 suites)
- [x] npm run validate (including smoke test)
Status: **locally validated**
