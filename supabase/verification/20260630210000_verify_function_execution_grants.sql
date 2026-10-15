-- Verification: function execution grants hardening
-- Run: npx supabase db query --linked -f supabase/verification/20260630210000_verify_function_execution_grants.sql
-- Expected: ALL queries return 'OK' or expected grant state

-- 1. No application function executable by PUBLIC
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function,
  'PUBLIC_EXECUTE' as check,
  case when count(*) = 0 then 'OK' else 'FAIL' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'PUBLIC'
where n.nspname = 'public'
  and p.proname not like 'pgrst%'
  and p.proname not in ('execute_sql')
group by p.proname, pg_get_function_identity_arguments(p.oid)
having count(*) > 0;

-- 2. No application function executable by anon
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function,
  'ANON_EXECUTE' as check,
  case when count(*) = 0 then 'OK' else 'FAIL' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'anon'
where n.nspname = 'public'
  and p.proname not like 'pgrst%'
  and p.proname not in ('execute_sql')
group by p.proname, pg_get_function_identity_arguments(p.oid)
having count(*) > 0;

-- 3. Externally callable RPCs have authenticated execute
-- This query should return rows for each expected RPC
select p.proname as function,
  'AUTHENTICATED_GRANT' as check,
  case when g.grantee = 'authenticated' then 'OK' else 'MISSING' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'authenticated'
where n.nspname = 'public'
  and p.proname in (
    'create_order', 'submit_order', 'approve_order',
    'reject_order', 'request_order_changes', 'return_order_to_draft',
    'cleanup_draft_order', 'resubmit_changed_order',
    'resubmit_changed_order_multi_image', 'delete_order',
    'delete_store', 'mark_order_placed', 'confirm_order_received'
  )
order by p.proname;

-- 4. RLS policy helpers have authenticated execute
select p.proname as function,
  'AUTHENTICATED_GRANT' as check,
  case when g.grantee = 'authenticated' then 'OK' else 'MISSING' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'authenticated'
where n.nspname = 'public'
  and p.proname in (
    'current_user_is_active', 'is_admin', 'user_can_access_store',
    'order_visible_to_current_user', 'order_editable_by_current_user'
  )
order by p.proname;

-- 5. Internal helpers NOT executable by authenticated
select p.proname as function,
  'AUTHENTICATED_REVOKED' as check,
  case when g.grantee = 'authenticated' then 'FAIL' else 'OK' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'authenticated'
where n.nspname = 'public'
  and p.proname in (
    'record_order_status_history', 'generate_order_internal_number',
    'handle_new_user', 'set_updated_at'
  )
order by p.proname;

-- 6. admin_remove_user_profile NOT executable by authenticated
select p.proname as function,
  'ADMIN_RPC_AUTHENTICATED_REVOKED' as check,
  case when g.grantee = 'authenticated' then 'FAIL' else 'OK' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.routine_privileges g
  on g.specific_schema = 'public'
  and g.routine_name = p.proname
  and g.privilege_type = 'EXECUTE'
  and g.grantee = 'authenticated'
where n.nspname = 'public'
  and p.proname = 'admin_remove_user_profile';

-- 7. is_admin() reads from public.profiles (DB-backed)
select 'is_admin reads public.profiles' as check,
  case
    when pg_get_functiondef(p.oid) ilike '%from public.profiles%'
    then 'OK' else 'FAIL'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';

-- 8. is_admin() checks removed_at IS NULL
select 'is_admin checks removed_at' as check,
  case
    when pg_get_functiondef(p.oid) ilike '%removed_at%'
    then 'OK' else 'FAIL'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';

-- 9. generate_order_internal_number is SECURITY DEFINER
select 'generate_order_internal_number is SECURITY DEFINER' as check,
  case
    when p.prosecdef then 'OK' else 'FAIL'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'generate_order_internal_number';

-- 10. All application functions with summary counts
select
  count(*) as total,
  sum(case when p.prosecdef then 1 else 0 end) as security_definer,
  sum(case when not p.prosecdef then 1 else 0 end) as security_invoker,
  sum(case when exists (
    select 1 from information_schema.routine_privileges g
    where g.specific_schema = 'public'
      and g.routine_name = p.proname
      and g.privilege_type = 'EXECUTE'
      and g.grantee = 'PUBLIC'
  ) then 1 else 0 end) as public_execute,
  sum(case when exists (
    select 1 from information_schema.routine_privileges g
    where g.specific_schema = 'public'
      and g.routine_name = p.proname
      and g.privilege_type = 'EXECUTE'
      and g.grantee = 'anon'
  ) then 1 else 0 end) as anon_execute,
    sum(case when exists (
    select 1 from information_schema.routine_privileges g
    where g.specific_schema = 'public'
      and g.routine_name = p.proname
      and g.privilege_type = 'EXECUTE'
      and g.grantee = 'authenticated'
  ) then 1 else 0 end) as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname not like 'pgrst%'
  and p.proname not in ('execute_sql');

-- 11. is_admin() is SECURITY DEFINER
select 'is_admin() is SECURITY DEFINER' as check,
  case
    when p.prosecdef then 'OK' else 'FAIL'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';

-- 12. is_admin() has empty search_path (safe for SECURITY DEFINER)
select 'is_admin() has empty search_path' as check,
  case
    when pg_get_functiondef(p.oid) ~ 'SET search_path\s+(TO\s+|=\s*)'''''
    then 'OK' else 'FAIL'
  end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'is_admin';
