-- Forward migration: add p_caller_id param to admin_remove_user_profile
-- so backend can pass admin's user ID when calling with service_role key.
--
-- Root cause: migration 20260630210000 revoked authenticated EXECUTE grant,
-- making RPC callable only by service_role. But service_role calls get
-- auth.uid() = NULL, causing RPC's "Not authenticated" guard to reject.
-- Adding p_caller_id default NULL lets backend pass the admin's ID.

-- ============================================================
-- 1. Drop old signature (uuid only) to replace with new one
-- ============================================================
drop function if exists public.admin_remove_user_profile(uuid);

-- ============================================================
-- 2. Recreate with optional p_caller_id parameter
-- ============================================================
create or replace function public.admin_remove_user_profile(
  p_target_id uuid,
  p_caller_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_caller public.profiles;
  v_target public.profiles;
  v_admin_count bigint;
begin
  -- Use p_caller_id when provided (service_role call from backend),
  -- fall back to auth.uid() for backward compat
  v_caller_id := coalesce(p_caller_id, auth.uid());

  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Lock and load caller profile
  select * into v_caller
  from public.profiles
  where id = v_caller_id
  for update;

  if not found then
    raise exception 'Caller profile not found';
  end if;

  if not v_caller.is_active then
    raise exception 'Caller is not active';
  end if;

  if upper(v_caller.role) <> 'ADMIN' then
    raise exception 'Only admins can remove users';
  end if;

  -- Lock and load target profile
  select * into v_target
  from public.profiles
  where id = p_target_id
  for update;

  if not found then
    raise exception 'Target user not found';
  end if;

  -- Prevent self-removal
  if v_caller_id = p_target_id then
    raise exception 'Cannot remove yourself';
  end if;

  -- Idempotent: already removed
  if v_target.removed_at is not null then
    return jsonb_build_object(
      'target_id', p_target_id,
      'removed_at', v_target.removed_at,
      'removed_by_id', v_target.removed_by_id,
      'already_removed', true
    );
  end if;

  -- Prevent removal of the final active ADMIN
  if upper(v_target.role) = 'ADMIN' then
    select count(*) into v_admin_count
    from public.profiles
    where role = 'ADMIN'
      and is_active = true
      and id <> p_target_id
      and removed_at is null;

    if v_admin_count = 0 then
      raise exception 'Cannot remove the only active admin';
    end if;
  end if;

  -- Perform removal atomically
  update public.profiles
  set
    is_active = false,
    removed_at = pg_catalog.now(),
    removed_by_id = v_caller_id
  where id = p_target_id
  returning removed_at, removed_by_id into v_target.removed_at, v_target.removed_by_id;

  -- Insert audit event
  insert into public.audit_logs (user_id, action, entity, entity_id, new_data)
  values (
    v_caller_id,
    'USER_REMOVED',
    'profiles',
    p_target_id,
    jsonb_build_object(
      'removed_at', v_target.removed_at,
      'removed_by_id', v_caller_id,
      'profile_name', v_target.name,
      'profile_email', v_target.email,
      'profile_role', v_target.role
    )
  );

  return jsonb_build_object(
    'target_id', p_target_id,
    'removed_at', v_target.removed_at,
    'removed_by_id', v_target.removed_by_id,
    'already_removed', false
  );
end;
$$;

-- ============================================================
-- 3. Grants: service-role-only (same as 20260630210000)
-- ============================================================
revoke execute on function public.admin_remove_user_profile(uuid, uuid) from public, anon;

-- ============================================================
-- 4. Verification hints
-- ============================================================
-- Run after applying:
--   select proname, proargnames, proargtypes::regtype[]
--   from pg_proc
--   where proname = 'admin_remove_user_profile'
--   and pronamespace = 'public'::regnamespace;
--
-- Expected: args = [uuid, uuid] (second uuid has default)
--
-- Test:
--   select public.admin_remove_user_profile(
--     '00000000-0000-0000-0000-000000000000',
--     '00000000-0000-0000-0000-000000000000'
--   );
-- Expected: {"error": "Target user not found", "ok": false}
