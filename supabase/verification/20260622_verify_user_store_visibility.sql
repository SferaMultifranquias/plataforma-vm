-- Read-only verification for store visibility before applying migration.
-- This script does not modify data.

-- 1) Current RLS policies on target tables
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
  and tablename in ('lojas', 'orders', 'user_stores', 'profiles')
order by tablename, policyname;

-- 2) Function signatures and definitions for helpers + RPCs
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin',
    'current_user_is_active',
    'create_order',
    'submit_order',
    'user_can_access_store',
    'order_visible_to_current_user',
    'order_editable_by_current_user'
  )
order by p.proname;

-- 3) Store activity stats
select
  ativo,
  count(*) as total
from public.lojas
group by ativo
order by ativo;

-- 4) Profile activity stats
select
  is_active,
  role,
  count(*) as total
from public.profiles
group by is_active, role
order by is_active, role;

-- 5) User-store linkage stats
select
  count(*) as total_user_stores,
  count(distinct user_id) as distinct_users,
  count(distinct store_id) as distinct_stores
from public.user_stores;

-- 6) User-store linkage by store activity
select
  l.ativo,
  count(us.*) as total_links
from public.lojas l
left join public.user_stores us on us.store_id = l.id
group by l.ativo
order by l.ativo;

-- 7) User-store linkage by profile activity
select
  p.is_active,
  count(us.*) as total_links
from public.profiles p
left join public.user_stores us on us.user_id = p.id
group by p.is_active
order by p.is_active;

-- 8) Orders linked to inactive stores
select
  o.id,
  o.internal_number,
  o.status,
  o.store_id,
  l.nome as store_name,
  l.ativo as store_active
from public.orders o
join public.lojas l on l.id = o.store_id
where l.ativo = false
order by o.created_at desc;

-- 9) Orders created by inactive users
select
  o.id,
  o.internal_number,
  o.status,
  o.requester_id,
  p.is_active as requester_active,
  p.name as requester_name
from public.orders o
join public.profiles p on p.id = o.requester_id
where p.is_active = false
order by o.created_at desc;

-- 10) Grants on new/modified functions
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
    'current_user_is_active',
    'create_order',
    'user_can_access_store'
  )
order by routine_name, grantee, privilege_type;

-- 11) Grants on target tables
select
  table_schema,
  table_name,
  privilege_type,
  grantee
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('lojas', 'orders', 'user_stores', 'profiles')
order by table_name, grantee, privilege_type;
