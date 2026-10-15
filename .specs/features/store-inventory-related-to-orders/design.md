# Stock Lifecycle Design

## Model

```
order_item_stock_checks
  id uuid PK
  order_id uuid FK -> orders(id)
  order_item_id uuid FK -> order_items(id) UNIQUE
  store_id bigint FK -> lojas(id)
  product_code text
  description text
  requested_quantity numeric(12,2)
  stock_status text  -- pending_check, in_stock, partial_stock, out_of_stock, needs_purchase
  available_quantity numeric(12,2)
  checked_by uuid FK -> profiles(id)
  checked_at timestamptz
  notes text
  created_at timestamptz
  updated_at timestamptz
  UNIQUE (order_item_id)

order_receipts
  id uuid PK
  order_id uuid FK -> orders(id) UNIQUE
  invoice_number text NOT NULL
  confirmed_by uuid FK -> profiles(id)
  confirmed_at timestamptz
  created_at timestamptz

store_stock_receipts
  id uuid PK
  order_id uuid FK -> orders(id)
  order_item_id uuid FK -> order_items(id) UNIQUE
  order_receipt_id uuid FK -> order_receipts(id)
  store_id bigint FK -> lojas(id)
  product_code text
  description text
  received_quantity numeric(12,2)
  unit text
  received_unit_value numeric(12,2)   -- unit value from invoice (nullable for legacy)
  received_total_value numeric(12,2)  -- quantity * unit_value (nullable for legacy)
  received_by uuid FK -> profiles(id)
  received_at timestamptz   -- immutable
  created_at timestamptz
  -- INSERT only via confirm_order_received RPC

store_stock_balances
  id uuid PK
  store_id bigint FK -> lojas(id)
  product_code text
  description text
  received_quantity_total numeric(12,2)
  unit text
  last_received_at timestamptz
  updated_at timestamptz
  created_at timestamptz
  UNIQUE (store_id, upper(btrim(product_code)))
```

## RLS Policies

- `order_item_stock_checks_select`: active user AND (is_admin() OR user_can_access_store(store_id))
- `order_item_stock_checks_admin_insert/update/delete`: is_admin() AND current_user_is_active()
- `store_stock_receipts_select`: active user AND (is_admin() OR user_can_access_store(store_id))
- `store_stock_balances_select`: active user AND (is_admin() OR user_can_access_store(store_id))

## Stock Policy

Receipt-only: stock entries created when requester confirms delivery (`confirm_order_received`).
No order submit/resubmit/approve/ORDER_PLACED creates stock.
`store_stock_balances` is estimated balance from received purchases.
Consumption tracking is deferred.

## API (Express + Pages)

```
GET    /api/admin/stock-checks              -> listStockChecks
PATCH  /api/admin/stock-checks/:orderItemId -> updateStockCheck
GET    /api/admin/received-stock            -> listReceivedStock
```

### Invoice/Value Fields

- `order_receipts.invoice_number` — order-level nota fiscal, required on new confirmations.
- `store_stock_receipts.received_unit_value` — unit price per item from invoice.
- `store_stock_receipts.received_total_value` = `received_quantity * received_unit_value`.
- Nullable on both columns for legacy data. RPC requires values for new confirmations.

Normal-user reads go through Supabase browser client with RLS, not admin API.

## Frontend (`/estoque`)

- Loads `order_item_stock_checks` (checks table) and `store_stock_receipts` (received items table).
- Both queries include `lojas(id,codigo,nome)` embed for store label rendering.
- `store_stock_receipts` query includes `order_receipts(invoice_number)` embed for invoice display.
- Received table shows invoice number, unit value, total value columns. Legacy rows show blank.
- Search box filters both tables client-side.
- Status filter affects checks only.
- Loja filter affects both tables (populated from unique stores in loaded data, by `store_id`).
- Loja column is first in both tables; renders `codigo — nome` from embed, fallback `Loja #store_id`.
- Tables use fixed layout with `colgroup` width classes matching `stores.css`/`users.css` pattern.
- Empty state only when both lists empty.
- Received section hidden when no receipts.
- Admin stock check updates via `/api/admin/stock-checks/:orderItemId`.
- API parity: Express + Pages Functions.
- Toolbar uses `stock-*` CSS classes matching `stores.css` card/table pattern.

## Pages Function Structure

```
functions/api/admin/stock-checks/
  index.js              GET + PATCH
  [orderItemId].js      re-export from index.js
functions/api/admin/received-stock/
  index.js              GET only
```

Shared helpers in `functions/_shared/admin-core.js` and `admin-service.js`.
