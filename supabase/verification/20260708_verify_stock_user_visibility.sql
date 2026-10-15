-- verify_stock_user_visibility
-- SELECT-only verification of stock RLS and grant restrictions

-- 1) order_item_stock_checks RLS: SELECT policy uses user_can_access_store
select
  'order_item_stock_checks_select' as policy_name,
  tablename,
  qual as condition
from pg_policies
where schemaname = 'public'
  and tablename = 'order_item_stock_checks'
  and policyname = 'order_item_stock_checks_select'
  and (qual ilike '%user_can_access_store%' or qual ilike '%is_admin%');

-- 2) store_stock_receipts RLS: SELECT policy uses user_can_access_store
select
  'store_stock_receipts_select' as policy_name,
  tablename,
  qual as condition
from pg_policies
where schemaname = 'public'
  and tablename = 'store_stock_receipts'
  and policyname = 'store_stock_receipts_select'
  and (qual ilike '%user_can_access_store%' or qual ilike '%is_admin%');

-- 3) store_stock_balances RLS: SELECT policy uses user_can_access_store
select
  'store_stock_balances_select' as policy_name,
  tablename,
  qual as condition
from pg_policies
where schemaname = 'public'
  and tablename = 'store_stock_balances'
  and policyname = 'store_stock_balances_select'
  and (qual ilike '%user_can_access_store%' or qual ilike '%is_admin%');

-- 4) store_stock_receipts has no INSERT/UPDATE/DELETE RLS policies
select
  tablename,
  count(*) as non_select_policies
from pg_policies
where schemaname = 'public'
  and tablename = 'store_stock_receipts'
  and cmd <> 'SELECT'
group by tablename;

-- 5) store_stock_balances has no INSERT/UPDATE/DELETE RLS policies
select
  tablename,
  count(*) as non_select_policies
from pg_policies
where schemaname = 'public'
  and tablename = 'store_stock_balances'
  and cmd <> 'SELECT'
group by tablename;

-- 6) recompute_store_stock_balance has no direct execute grant to authenticated
select
  p.proname as function_name,
  r.rolname as grantee,
  has_function_privilege(r.oid, p.oid, 'execute') as can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join pg_catalog.pg_roles r
where n.nspname = 'public'
  and p.proname = 'recompute_store_stock_balance'
  and r.rolname in ('authenticated', 'public', 'anon')
order by r.rolname;
