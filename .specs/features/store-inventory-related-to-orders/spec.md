# Store Stock — Receipt-Based Stock Lifecycle

## Requirements

STK-01: Stock is store-based. Receipts inserted per `order_items` when `confirm_order_received` runs.
STK-02: SKU = `product_code` from `order_items`. No separate product catalog.
STK-03: Description from `order_items.description`.
STK-04: Phase 1: receipt-based stock only. No auto deduction, no reservation, no partial receipt.
STK-05: Orders not blocked when stock does not exist.
STK-06: Normal active users see stock for stores linked via `user_stores`.
STK-07: Admin users see all stock.
STK-08: Only admin can update `order_item_stock_checks`.
STK-09: `store_stock_receipts` immutable — INSERT only via `confirm_order_received` RPC.
STK-10: `store_stock_receipts.order_item_id` unique — one receipt row per order item.
STK-10b: Receipt confirmation requires invoice number (order-level) and unit value per item.
STK-10c: `order_receipts` table stores order-level invoice metadata.
STK-10d: `store_stock_receipts` has `received_unit_value` and `received_total_value` per item.
STK-10e: Legacy `RECEIVED` orders keep nullable invoice/value. RPC enforces NOT NULL for new confirmations.
STK-11: Admin API: list stock checks, update stock check, list received stock.
STK-12: Field allowlist + prototype pollution rejection on admin routes.
STK-13: Cloudflare Pages Functions parity with Express admin API.
STK-14: Contract + server tests for auth, validation, RLS, and parity.
STK-15: `/estoque` frontend shows requested item analysis and received items.
STK-16: Empty state only when both checks and receipts are empty.
STK-17: Loja column in both tables (checks + received) with label from `lojas(codigo,nome)` embed.
STK-18: Loja filter in toolbar populated from loaded data, filters both tables via `store_id`.
STK-19: CSS uses `stock-` prefix classes matching `stores.css` card/table visual pattern.
STK-20: Deferred: partial receipt, dashboard indicators, CSV import, consumption tracking.
STK-21: Export CSV/XLSX button in toolbar; exports checks + received respecting filters. No import feature.
