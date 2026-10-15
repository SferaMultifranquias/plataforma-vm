-- Read-only verification for the remote Supabase schema before applying the migration.
-- This script does not modify data.

-- 1) Table columns and types
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs')
order by table_name, ordinal_position;

select
  table_name,
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs')
order by table_name, constraint_type, constraint_name;

-- 2) Foreign keys
select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs')
order by tc.table_name, tc.constraint_name;

-- 3) Status constraints and current statuses
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname = 'public'
  and r.relname = 'orders'
  and c.contype = 'c';

select
  status,
  count(*) as total
from public.orders
group by status
order by total desc, status;

-- 4) Active RLS policies
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
where schemaname in ('public', 'storage')
  and tablename in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs', 'objects')
order by schemaname, tablename, policyname;

-- 5) Function signatures and definitions
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  pg_get_userbyid(p.proowner) as owner_name,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin',
    'create_order',
    'submit_order',
    'return_order_to_draft',
    'approve_order',
    'reject_order',
    'request_order_changes',
    'user_can_access_store',
    'order_visible_to_current_user',
    'order_editable_by_current_user',
    'record_order_status_history'
  )
order by
  p.proname,
  pg_get_function_identity_arguments(p.oid);

-- 6) Triggers
select
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs')
order by event_object_table, trigger_name;

-- 7) Indexes
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs', 'user_stores')
order by tablename, indexname;

-- 8) Grants
select
  table_schema,
  table_name,
  privilege_type,
  grantee
from information_schema.table_privileges
where table_schema in ('public', 'storage')
  and table_name in ('profiles', 'lojas', 'orders', 'order_items', 'order_images', 'status_history', 'audit_logs', 'user_stores', 'objects')
order by table_schema, table_name, grantee, privilege_type;

select
  routine_schema,
  routine_name,
  specific_name,
  privilege_type,
  grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'is_admin',
    'create_order',
    'submit_order',
    'return_order_to_draft',
    'approve_order',
    'reject_order',
    'request_order_changes',
    'user_can_access_store',
    'order_visible_to_current_user',
    'order_editable_by_current_user',
    'record_order_status_history'
  )
order by routine_name, grantee, privilege_type;

-- 9) Storage bucket configuration
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'order-images';

select
  bucket_id,
  name,
  owner,
  created_at,
  updated_at,
  last_accessed_at,
  metadata
from storage.objects
where bucket_id = 'order-images'
order by created_at desc
limit 50;

-- 10) Legacy store compatibility checks
with exact_code_matches as (
  select o.id
  from public.orders o
  join public.lojas l
    on trim(coalesce(o.cost_center, '')) = trim(coalesce(l.codigo, ''))
),
name_matches as (
  select o.id
  from public.orders o
  join public.lojas l
    on trim(coalesce(o.store, '')) = trim(coalesce(l.nome, ''))
),
ambiguous_code_matches as (
  select o.id
  from public.orders o
  join public.lojas l
    on trim(coalesce(o.cost_center, '')) = trim(coalesce(l.codigo, ''))
  group by o.id
  having count(*) > 1
),
ambiguous_name_matches as (
  select o.id
  from public.orders o
  join public.lojas l
    on trim(coalesce(o.store, '')) = trim(coalesce(l.nome, ''))
  group by o.id
  having count(*) > 1
)
select
  (select count(*) from public.orders) as total_orders,
  (select count(distinct id) from exact_code_matches) as orders_matched_by_code,
  (select count(distinct id) from (
    select id
    from name_matches
    except
    select id
    from exact_code_matches
  ) only_name) as orders_matched_only_by_unique_name,
  (select count(*) from public.orders o
    where not exists (select 1 from exact_code_matches e where e.id = o.id)
      and not exists (select 1 from name_matches n where n.id = o.id)
  ) as unmatched_orders,
  (select count(*) from ambiguous_code_matches) as ambiguous_code_matches,
  (select count(*) from ambiguous_name_matches) as ambiguous_name_matches;

-- 11) Rejected order compatibility checks
select
  count(*) as total_rejected_orders,
  count(*) filter (where rejected_at is not null) as rejected_with_timestamp,
  count(*) filter (where rejection_reason is not null) as rejected_with_reason
from public.orders
where status = 'REJECTED';

select
  o.id,
  o.internal_number,
  o.status,
  o.updated_at,
  o.submitted_at,
  o.rejected_at,
  o.rejection_reason
from public.orders o
where o.status = 'REJECTED'
order by o.updated_at desc
limit 100;

-- 12) Image inconsistency checks
select
  count(*) as image_metadata_without_matching_order
from public.order_images oi
left join public.orders o on o.id = oi.order_id
where o.id is null;

select
  count(*) as duplicate_storage_paths
from (
  select storage_path
  from public.order_images
  group by storage_path
  having count(*) > 1
) duplicate_paths;

select
  count(*) as null_or_malformed_storage_paths
from public.order_images
where storage_path is null
   or trim(storage_path) = ''
   or position('/' in storage_path) = 0;

select
  oi.id,
  oi.order_id,
  oi.storage_path,
  oi.original_filename,
  oi.created_at
from public.order_images oi
left join public.orders o on o.id = oi.order_id
where o.id is null
   or oi.storage_path is null
   or trim(oi.storage_path) = ''
order by oi.created_at desc;
