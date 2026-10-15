-- ============================================================
-- Corrective forward migration: harden delete_order and delete_store
-- Authorizes caller via auth.uid() + is_admin() check.
-- delete_order: DB-only (storage handled by Express service role).
-- delete_store: relies on confirmed FK ON DELETE CASCADE for user_stores.
-- ============================================================

-- remove old grants first (signatures differ from previous applied versions)
revoke execute on function public.delete_order(uuid) from public;
revoke execute on function public.delete_order(uuid) from anon;
revoke execute on function public.delete_store(bigint) from public;
revoke execute on function public.delete_store(bigint) from anon;

-- --------------------------------------------------
-- delete_order: ADMIN-only, DRAFT-only, DB records only
-- --------------------------------------------------
create or replace function public.delete_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_uid uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can delete orders';
  end if;

  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'DRAFT' then
    raise exception 'INVALID_STATUS: Only draft orders can be deleted';
  end if;

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data)
  values (
    v_uid,
    'ORDER_DELETED',
    'orders',
    p_order_id,
    pg_catalog.jsonb_build_object(
      'internal_number', v_order.internal_number,
      'requester_id', v_order.requester_id,
      'store', v_order.store,
      'status', v_order.status,
      'created_at', v_order.created_at
    )
  );

  delete from public.orders where id = p_order_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'order_id', p_order_id
  );
end;
$$;

-- --------------------------------------------------
-- delete_store: ADMIN-only, inactive-only, no-orders check
-- user_stores removed via FK ON DELETE CASCADE only
-- --------------------------------------------------
create or replace function public.delete_store(p_store_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.lojas;
  v_order_count bigint;
  v_uid uuid;
begin
  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can delete stores';
  end if;

  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  select * into v_store
  from public.lojas
  where id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store not found';
  end if;

  if v_store.ativo then
    raise exception 'STORE_ACTIVE: Store is active. Deactivate it first before deleting.';
  end if;

  select count(*) into v_order_count
  from public.orders
  where store_id = p_store_id;

  if v_order_count > 0 then
    raise exception 'STORE_HAS_ORDERS: Store has orders and cannot be deleted. Deactivate instead.';
  end if;

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data)
  values (
    v_uid,
    'STORE_DELETED',
    'lojas',
    null,
    pg_catalog.jsonb_build_object(
      'store_id', v_store.id,
      'codigo', v_store.codigo,
      'nome', v_store.nome,
      'marca', v_store.marca,
      'ativo', v_store.ativo,
      'created_at', v_store.created_at
    )
  );

  -- ponytail: user_stores FK has confirmed ON DELETE CASCADE,
  -- explicit delete removed to avoid double-delete risk.
  delete from public.lojas where id = p_store_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'store_id', p_store_id
  );
end;
$$;

-- grant only authenticated (revoked from public/anon above)
grant execute on function public.delete_order(uuid) to authenticated;
grant execute on function public.delete_store(bigint) to authenticated;
