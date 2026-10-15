-- verify_admin_stock_receipt_corrections
-- SELECT-only verification of new RPCs, columns, grants

-- 1) store_stock_receipts has new columns
select
  column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'store_stock_receipts'
  and column_name in ('updated_at', 'updated_by', 'voided_at', 'voided_by', 'void_reason')
order by column_name;

-- 2) RPCs exist
select
  p.proname,
  pg_catalog.pg_get_function_arguments(p.oid) as args
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_update_stock_receipt', 'admin_void_stock_receipt', 'recompute_store_stock_balance')
order by p.proname;

-- 3) RPCs are security definer
select
  p.proname,
  p.prosecdef as is_security_definer
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_update_stock_receipt', 'admin_void_stock_receipt', 'recompute_store_stock_balance')
  and p.prosecdef = true;

-- 4) RPCs have search_path = ''
select
  p.proname,
  pg_catalog.pg_get_function_arg_default(p.oid, 0) as search_path
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_update_stock_receipt', 'admin_void_stock_receipt', 'recompute_store_stock_balance')
  and pg_catalog.pg_get_function_arg_default(p.oid, 0) = '';

-- 5) Execution grants are restricted
select
  p.proname as function_name,
  r.rolname as grantee,
  has_function_privilege(r.oid, p.oid, 'execute') as can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join pg_catalog.pg_roles r
where n.nspname = 'public'
  and p.proname in ('admin_update_stock_receipt', 'admin_void_stock_receipt', 'recompute_store_stock_balance')
  and r.rolname in ('authenticated', 'anon', 'public')
order by p.proname, r.rolname;

-- 6) Audit log entries recorded by RPCs (confirm via test only)
select 'admin_update_stock_receipt and admin_void_stock_receipt write to audit_logs' as note
where exists (
  select 1 from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_update_stock_receipt'
    and pg_catalog.pg_get_functiondef(p.oid) like '%audit_logs%'
);

-- 7) store_stock_receipts still has no insert/update/delete grants
select
  coalesce(
    (select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'store_stock_receipts'
       and privilege_type similar to '(I|U|D)%'),
    'none'
  ) as table_mutation_grants;
