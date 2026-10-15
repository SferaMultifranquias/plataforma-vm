-- ============================================================
-- Forward migration: replace delete_order — any order status,
-- ADMIN-only, hard delete, persistent audit with full snapshot
-- ============================================================

revoke execute on function public.delete_order(uuid) from public;
revoke execute on function public.delete_order(uuid) from anon;

-- --------------------------------------------------
-- delete_order: ADMIN-only, ANY status, hard delete
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
  v_image_count int;
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

  -- no status restriction: any order may be deleted

  select pg_catalog.count(*) into v_image_count
  from public.order_images
  where order_id = p_order_id;

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
      'created_at', v_order.created_at,
      'deleted_by', v_uid,
      'deleted_at', pg_catalog.now(),
      'image_count', v_image_count
    )
  );

  delete from public.orders where id = p_order_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'order_id', p_order_id
  );
end;
$$;

grant execute on function public.delete_order(uuid) to authenticated;
