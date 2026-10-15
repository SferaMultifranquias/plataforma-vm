-- Forward migration: fix RLS recursion by making is_admin() SECURITY DEFINER.
--
-- Problem:
--   is_admin() (SECURITY INVOKER) reads public.profiles. Policy
--   profiles_select_self_or_admin calls is_admin() on its admin branch.
--   PostgreSQL may evaluate both branches of the OR (no short-circuit
--   guarantee for STABLE functions), creating infinite recursion:
--   is_admin() → profiles policy → is_admin() → ... → stack depth exceeded.
--
--   Same recursion via user_stores_select_self_or_admin,
--   audit_logs_admin_only, orders_select_visible_scope, and other policies
--   that call is_admin().
--
-- Fix:
--   Make is_admin() SECURITY DEFINER with search_path = ''.
--   The function only checks auth.uid()'s own profile row — safe because
--   auth.uid() is immutable per session. RLS bypass is acceptable since
--   the query is inherently scoped to the current user (id = auth.uid()).
--   This breaks the recursion because the inner profiles read no longer
--   triggers RLS policy re-evaluation.
--
--   Pattern matches current_user_is_active() (already SECURITY DEFINER).

-- ============================================================
-- 1. Recreate is_admin() as SECURITY DEFINER
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'ADMIN'
      and is_active = true
      and removed_at is null
  );
$$;

-- ============================================================
-- 2. Reaffirm grants (idempotent)
-- ============================================================
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
