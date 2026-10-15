-- ============================================================
-- delete_order: ADMIN-only DRAFT deletion (DB records only)
-- Storage cleanup handled by Express server before calling this RPC.
-- ============================================================
create or replace function public.delete_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
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
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'DRAFT' then
    raise exception 'Only draft orders can be deleted';
  end if;

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data)
  values (
    auth.uid(),
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

revoke execute on function public.delete_order(uuid) from public;
revoke execute on function public.delete_order(uuid) from anon;
grant execute on function public.delete_order(uuid) to authenticated;

-- ============================================================
-- delete_store: ADMIN-only physical deletion.
-- Requires store to be inactive (ativo = false) AND have zero orders.
-- ============================================================
create or replace function public.delete_store(p_store_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.lojas;
  v_order_count bigint;
begin
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
    raise exception 'Store is active. Deactivate it first before deleting.';
  end if;

  select count(*) into v_order_count
  from public.orders
  where store_id = p_store_id;

  if v_order_count > 0 then
    raise exception 'Store has orders and cannot be deleted. Deactivate instead.';
  end if;

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data)
  values (
    auth.uid(),
    'STORE_DELETED',
    'lojas',
    null,
    pg_catalog.jsonb_build_object(
      'store_id', v_store.id,
      'codigo', v_store.codigo,
      'nome', v_store.nome,
      'marca', v_store.marca
    )
  );

  delete from public.user_stores where store_id = p_store_id;
  delete from public.lojas where id = p_store_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'store_id', p_store_id
  );
end;
$$;

revoke execute on function public.delete_store(bigint) from public;
revoke execute on function public.delete_store(bigint) from anon;
grant execute on function public.delete_store(bigint) to authenticated;
