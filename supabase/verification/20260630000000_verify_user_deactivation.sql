-- Verification: user deactivation and historical identity
-- Run against remote: npx supabase db query --linked -f supabase/verification/20260630000000_verify_user_deactivation.sql
-- Expected: ALL queries return 'OK'

-- 1. Schema columns exist
select 'profiles.removed_at' as object,
  case when column_name = 'removed_at' then 'OK' else 'MISSING' end
from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name='removed_at';

select 'profiles.removed_by_id' as object,
  case when column_name = 'removed_by_id' then 'OK' else 'MISSING' end
from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name='removed_by_id';

-- 2. Indexes exist
select 'idx_profiles_removed' as object,
  case when count(*)>0 then 'OK' else 'MISSING' end
from pg_indexes where indexname='idx_profiles_removed';

select 'idx_profiles_active_and_role' as object,
  case when count(*)>0 then 'OK' else 'MISSING' end
from pg_indexes where indexname='idx_profiles_active_and_role';

-- 3. RPCs exist
select 'admin_remove_user_profile' as object,
  case when count(*)>0 then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='admin_remove_user_profile';

-- 4. current_user_is_active() definition: must check is_active AND removed_at IS NULL
select 'current_user_is_active checks removed_at' as object,
  case when pg_get_functiondef(p.oid) ilike '%removed_at%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='current_user_is_active';

-- 5. All mutating RPCs have active check (via current_user_is_active OR direct is_active read)
-- Check each RPC
select 'create_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_order';

select 'submit_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='submit_order';

select 'approve_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='approve_order';

select 'reject_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='reject_order';

select 'return_order_to_draft' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='return_order_to_draft';

select 'request_order_changes' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='request_order_changes';

select 'cleanup_draft_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='cleanup_draft_order';

select 'mark_order_placed' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='mark_order_placed';

select 'confirm_order_received' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='confirm_order_received';

select 'delete_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='delete_order';

select 'delete_store' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%current_user_is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='delete_store';

select 'resubmit_changed_order' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='resubmit_changed_order';

select 'resubmit_changed_order_multi_image' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='resubmit_changed_order_multi_image';

select 'admin_remove_user_profile' as rpc,
  case when pg_get_functiondef(p.oid) ilike '%is_active%' then 'OK' else 'MISSING' end
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='admin_remove_user_profile';

-- 6. RLS policies: confirm all public policies include current_user_is_active()
with policy_check as (
  select
    tablename,
    policyname,
    case
      when qual ilike '%current_user_is_active%' or with_check ilike '%current_user_is_active%'
      then 'OK'
      else 'MISSING'
    end as active_check
  from pg_policies
  where schemaname = 'public'
    and tablename not in ('lojas')
)
select tablename, policyname, active_check
from policy_check
where active_check = 'MISSING';

-- 7. Storage policies: confirm all order-images policies include current_user_is_active()
select tablename, policyname,
  case
    when qual ilike '%current_user_is_active%' or with_check ilike '%current_user_is_active%'
    then 'OK' else 'MISSING'
  end as active_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and qual ilike '%order-images%';
