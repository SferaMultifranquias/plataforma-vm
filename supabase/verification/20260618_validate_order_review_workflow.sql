-- Read-only post-migration validation for the order review workflow.
-- This script does not modify data.

-- 1) Required table and column checks
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'orders' and column_name in ('store_id', 'cancelled_by_id', 'cancelled_at', 'cancellation_reason'))
    or (table_name = 'user_stores' and column_name in ('user_id', 'store_id', 'created_at'))
  )
order by table_name, column_name;

-- 2) Status constraint validation
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname = 'public'
  and r.relname = 'orders'
  and c.contype = 'c';

select distinct status
from public.orders
order by status;

-- 3) RPC existence checks
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_order',
    'submit_order',
    'return_order_to_draft',
    'approve_order',
    'reject_order',
    'request_order_changes'
  )
order by
  p.proname,
  pg_get_function_identity_arguments(p.oid);

-- 4) Direct update blocking checks via policies
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'orders'
order by policyname;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('order_items', 'order_images', 'status_history', 'user_stores')
order by tablename, policyname;

-- 5) ADMIN review capability checks
select
  proname,
  prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('approve_order', 'reject_order', 'request_order_changes');

-- 6) USER store-based policy checks
select
  policyname,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'orders'
  and policyname like '%visible%';

select
  policyname,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'user_stores';

-- 7) Storage bucket and policy checks
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'order-images';

select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

-- 8) Required indexes
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('orders', 'user_stores', 'status_history', 'order_images')
order by tablename, indexname;

-- 9) Status history trigger check
select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'orders'
order by trigger_name;

-- 10) Legacy compatibility sanity checks
select
  count(*) as orders_without_store_id
from public.orders
where store_id is null;

select
  count(*) as rejected_orders_remaining
from public.orders
where status = 'REJECTED';
