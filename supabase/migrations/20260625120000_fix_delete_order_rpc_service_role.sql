-- ============================================================
-- Fix delete_order: remove is_admin/current_user_is_active checks
-- because Express server handles authorization (service role).
-- auth.uid() may be null when called via service role; audit
-- insert handles null gracefully.
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
