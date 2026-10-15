-- User deactivation with historical identity preservation.
-- Goals:
--   1. Profiles: add removed_at and removed_by_id columns
--   2. Atomic RPC: admin_remove_user_profile (profile + audit in one call)
--   3. Active-user enforcement on RPCs that lack it

-- ============================================================
-- Columns: profiles.removed_at, profiles.removed_by_id
-- ============================================================
alter table public.profiles
  add column if not exists removed_at timestamptz;

alter table public.profiles
  add column if not exists removed_by_id uuid;

alter table public.profiles
  drop constraint if exists profiles_removed_by_id_fkey;

alter table public.profiles
  add constraint profiles_removed_by_id_fkey
  foreign key (removed_by_id) references public.profiles(id)
  on delete set null;

create index if not exists idx_profiles_removed
  on public.profiles ((removed_at is not null))
  where removed_at is not null;

create index if not exists idx_profiles_active_and_role
  on public.profiles (is_active, role)
  where is_active = true and removed_at is null;

-- ============================================================
-- Atomic RPC: admin_remove_user_profile
-- Server-only; service-role or trusted backend executes it.
-- ============================================================
create or replace function public.admin_remove_user_profile(p_target_id uuid)
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
  v_caller_id := auth.uid();

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

revoke execute on function public.admin_remove_user_profile(uuid) from public, anon;
grant execute on function public.admin_remove_user_profile(uuid) to authenticated;

-- ============================================================
-- Active-user enforcement on RPCs that lack it
-- ============================================================

-- submit_order: add current_user_is_active() guard
create or replace function public.submit_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
    and requester_id = auth.uid()
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'DRAFT' then
    raise exception 'Only draft orders can be submitted';
  end if;

  update public.orders
  set
    status = 'PENDING_APPROVAL',
    submitted_at = now(),
    rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Submitted for approval'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_SUBMITTED', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

-- approve_order: add current_user_is_active() guard
create or replace function public.approve_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can approve orders';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'PENDING_APPROVAL' then
    raise exception 'Order is not pending approval';
  end if;

  update public.orders
  set
    status = 'APPROVED',
    approved_by_id = auth.uid(),
    approved_at = now(),
    rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Order approved'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_APPROVED', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

-- reject_order: add current_user_is_active() guard
create or replace function public.reject_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_reason text;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can reject orders';
  end if;

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'Rejection reason is required';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'PENDING_APPROVAL' then
    raise exception 'Order is not pending approval';
  end if;

  update public.orders
  set
    status = 'REJECTED',
    approved_by_id = auth.uid(),
    rejected_at = now(),
    rejection_reason = v_reason
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    v_reason
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_REJECTED', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

-- request_order_changes: add current_user_is_active() guard
create or replace function public.request_order_changes(p_order_id uuid, p_comment text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_comment text;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can request changes';
  end if;

  v_comment := nullif(trim(p_comment), '');
  if v_comment is null then
    raise exception 'Comment is required';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'PENDING_APPROVAL' then
    raise exception 'Order is not pending approval';
  end if;

  update public.orders
  set
    status = 'CHANGES_REQUESTED',
    approved_by_id = auth.uid(),
    rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    v_comment
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_CHANGES_REQUESTED', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

-- return_order_to_draft: add current_user_is_active() guard
create or replace function public.return_order_to_draft(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
    and requester_id = auth.uid()
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'CHANGES_REQUESTED' then
    raise exception 'Only orders with requested changes can return to draft';
  end if;

  update public.orders
  set
    status = 'DRAFT',
    rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Returned to draft for edit'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_RETURNED_TO_DRAFT', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

-- cleanup_draft_order: add current_user_is_active() guard
create or replace function public.cleanup_draft_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.requester_id <> auth.uid() then
    raise exception 'Only requester can cleanup the order';
  end if;

  if v_order.status <> 'DRAFT' then
    raise exception 'Only DRAFT orders can be cleaned up';
  end if;

  delete from public.order_images where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
end;
$$;
