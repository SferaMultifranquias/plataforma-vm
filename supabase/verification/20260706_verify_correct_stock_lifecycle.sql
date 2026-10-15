-- Read-only verification for corrected stock lifecycle.
-- Does not modify data.

-- 1) Wrong tables do not exist
select
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in ('inventory_items', 'inventory_movements')
order by table_name;

-- 2) Correct tables exist
select
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in ('order_item_stock_checks', 'store_stock_receipts', 'store_stock_balances')
order by table_name;

-- 3) order_item_stock_checks columns
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_item_stock_checks'
order by ordinal_position;

-- 4) store_stock_receipts columns
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'store_stock_receipts'
order by ordinal_position;

-- 5) store_stock_balances columns
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'store_stock_balances'
order by ordinal_position;

-- 6) order_items does not have inventory_item_id
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'order_items'
  and column_name = 'inventory_item_id';

-- 7) RLS enabled on correct tables
select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('order_item_stock_checks', 'store_stock_receipts', 'store_stock_balances');

-- 8) RLS policies
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('order_item_stock_checks', 'store_stock_receipts', 'store_stock_balances')
order by tablename, policyname;

-- 9) confirm_order_received exists
select
  p.proname as function_name,
  pg_catalog.pg_get_function_result(p.oid) as return_type
from pg_proc p
where p.proname = 'confirm_order_received'
  and p.prorettype = 'public.orders'::regtype;

-- 10) mark_order_placed has no inventory deduction
select
  p.proname,
  pg_catalog.pg_get_functiondef(p.oid) as function_def
from pg_proc p
where p.proname = 'mark_order_placed'
  and p.prorettype = 'public.orders'::regtype;
