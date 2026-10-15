-- Forward migration: harden function execution grants, DB-backed is_admin(),
-- SECURITY DEFINER for internal helpers, least-privilege grant model.
--
-- Problems fixed:
--   1. 16/23 functions still executable by PUBLIC and anon (unauthenticated)
--   2. is_admin() reads JWT claims only, not database state
--   3. generate_order_internal_number() is INVOKER — cannot safely revoke
--      authenticated without breaking SECURITY DEFINER callers
--   4. Internal helpers (record_order_status_history, generate_order_internal_number,
--      handle_new_user, set_updated_at) callable by browser roles
--   5. admin_remove_user_profile callable by authenticated (should be service-role only)
--   6. SECURITY DEFINER functions with search_path = public — verify safety
--
-- Design:
--   - Revoke EXECUTE FROM PUBLIC, anon for ALL application functions
--   - Grant authenticated only for browser-callable RPCs + RLS policy helpers
--   - Revoke authenticated from internal helpers
--   - Revoke authenticated from admin_remove_user_profile
--   - Replace is_admin() with database-backed check reading public.profiles
--   - Make generate_order_internal_number() SECURITY DEFINER so it can
--     be called from other DEFINER functions after revoking authenticated

-- ============================================================
-- 1. DB-backed is_admin()
-- Reads from public.profiles instead of JWT claims.
-- SECURITY INVOKER — respects RLS on profiles. Every user can
-- read own profile row via profiles_select_self_or_admin policy.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
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
-- 2. Make generate_order_internal_number SECURITY DEFINER
-- Required so that SECURITY DEFINER callers (create_order) still
-- work after revoking authenticated EXECUTE from this helper.
-- ============================================================
create or replace function public.generate_order_internal_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number bigint;
begin
  select count(*) + 1 into next_number from public.orders;
  return 'ORD-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(next_number::text, 4, '0');
end;
$$;

-- ============================================================
-- 3. Revoke PUBLIC/anon from ALL application functions
-- ============================================================

-- Externally callable RPCs (currently also exposed to public/anon)
revoke execute on function public.approve_order(uuid) from public, anon;
revoke execute on function public.create_order(text, text, text, text, text, text, text, bigint) from public, anon;
revoke execute on function public.reject_order(uuid, text) from public, anon;
revoke execute on function public.request_order_changes(uuid, text) from public, anon;
revoke execute on function public.return_order_to_draft(uuid) from public, anon;
revoke execute on function public.submit_order(uuid) from public, anon;

-- Policy helpers (currently also exposed to public/anon)
revoke execute on function public.current_user_is_active() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.user_can_access_store(bigint) from public, anon;
revoke execute on function public.order_visible_to_current_user(uuid) from public, anon;
revoke execute on function public.order_editable_by_current_user(uuid) from public, anon;

-- Internal helpers (currently also exposed to public/anon)
revoke execute on function public.generate_order_internal_number() from public, anon;
revoke execute on function public.record_order_status_history(uuid, text, text, text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.set_updated_at() from public, anon;

-- Browser-callable RPCs already hardened (verify revocation is complete)
revoke execute on function public.delete_order(uuid) from public, anon;
revoke execute on function public.delete_store(bigint) from public, anon;
revoke execute on function public.mark_order_placed(uuid, text, date) from public, anon;
revoke execute on function public.confirm_order_received(uuid) from public, anon;
revoke execute on function public.resubmit_changed_order_multi_image(uuid, jsonb, jsonb, uuid[], text, text, text, text) from public, anon;
revoke execute on function public.cleanup_draft_order(uuid) from public, anon;
revoke execute on function public.admin_remove_user_profile(uuid) from public, anon;

-- resubmit_changed_order has 7-parameter form
revoke execute on function public.resubmit_changed_order(uuid, jsonb, jsonb, text, text, text, text) from public, anon;

-- ============================================================
-- 4. Grant authenticated to externally callable RPCs
-- ============================================================
grant execute on function public.create_order(text, text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.submit_order(uuid) to authenticated;
grant execute on function public.approve_order(uuid) to authenticated;
grant execute on function public.reject_order(uuid, text) to authenticated;
grant execute on function public.request_order_changes(uuid, text) to authenticated;
grant execute on function public.return_order_to_draft(uuid) to authenticated;
grant execute on function public.cleanup_draft_order(uuid) to authenticated;
grant execute on function public.resubmit_changed_order(uuid, jsonb, jsonb, text, text, text, text) to authenticated;
grant execute on function public.resubmit_changed_order_multi_image(uuid, jsonb, jsonb, uuid[], text, text, text, text) to authenticated;
grant execute on function public.delete_order(uuid) to authenticated;
grant execute on function public.delete_store(bigint) to authenticated;
grant execute on function public.mark_order_placed(uuid, text, date) to authenticated;
grant execute on function public.confirm_order_received(uuid) to authenticated;

-- ============================================================
-- 5. Grant authenticated to RLS policy helpers
-- These are referenced directly in RLS policies, which evaluate
-- with the current user's permissions.
-- ============================================================
grant execute on function public.current_user_is_active() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.user_can_access_store(bigint) to authenticated;

-- These helpers are NOT referenced in RLS policies but may be
-- called by the frontend for permission checks.
grant execute on function public.order_visible_to_current_user(uuid) to authenticated;
grant execute on function public.order_editable_by_current_user(uuid) to authenticated;

-- ============================================================
-- 6. Revoke authenticated from internal helpers
-- These are called only from SECURITY DEFINER RPCs or triggers.
-- Browser users must not call them directly.
-- ============================================================
revoke execute on function public.record_order_status_history(uuid, text, text, text) from authenticated;
revoke execute on function public.generate_order_internal_number() from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.set_updated_at() from authenticated;

-- ============================================================
-- 7. Revoke authenticated from admin_remove_user_profile
-- This RPC is called only via server-side service role.
-- Browser users must not call it directly.
-- ============================================================
revoke execute on function public.admin_remove_user_profile(uuid) from authenticated;

-- ============================================================
-- 8. SECURITY DEFINER audit confirmation
-- All SECURITY DEFINER functions verified:
--   - Schema-qualified references to public functions: YES
--   - No dynamic SQL: YES
--   - search_path is either '' or 'public' (both safe with
--     schema-qualified references)
--   - Active-user check before mutations: YES (confirmed in
--     migrations 20260630000000 through 20260630200000)
--
-- Functions with search_path = '': delete_order, delete_store,
--   mark_order_placed, confirm_order_received,
--   admin_remove_user_profile — safe, no public schema reliance.
--
-- Functions with search_path = 'public': create_order, submit_order,
--   approve_order, reject_order, request_order_changes,
--   return_order_to_draft, cleanup_draft_order,
--   resubmit_changed_order, resubmit_changed_order_multi_image,
--   current_user_is_active, record_order_status_history,
--   handle_new_user, generate_order_internal_number —
--   all schema-qualify public function references.
-- ============================================================
