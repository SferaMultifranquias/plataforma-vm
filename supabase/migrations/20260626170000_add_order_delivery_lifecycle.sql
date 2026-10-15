alter table public.orders
  add column if not exists delivery_protocol text,
  add column if not exists delivery_date date,
  add column if not exists placed_by_id uuid,
  add column if not exists placed_at timestamptz,
  add column if not exists received_by_id uuid,
  add column if not exists received_at timestamptz;

alter table public.orders
  drop constraint if exists orders_placed_by_id_fkey;
alter table public.orders
  add constraint orders_placed_by_id_fkey
  foreign key (placed_by_id) references public.profiles(id);

alter table public.orders
  drop constraint if exists orders_received_by_id_fkey;
alter table public.orders
  add constraint orders_received_by_id_fkey
  foreign key (received_by_id) references public.profiles(id);

alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDER_PLACED', 'RECEIVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED'));

create or replace function public.mark_order_placed(
  p_order_id uuid,
  p_delivery_protocol text,
  p_delivery_date date
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_protocol text;
begin
  if not public.current_user_is_active() then
    raise exception 'Current user is inactive';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can mark orders as placed';
  end if;

  v_protocol := nullif(pg_catalog.btrim(p_delivery_protocol), '');
  if v_protocol is null then
    raise exception 'Delivery protocol is required';
  end if;

  if p_delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'APPROVED' then
    raise exception 'Order is not approved';
  end if;

  update public.orders
  set
    delivery_protocol = v_protocol,
    delivery_date = p_delivery_date,
    placed_by_id = auth.uid(),
    placed_at = pg_catalog.now(),
    received_by_id = null,
    received_at = null,
    status = 'ORDER_PLACED'
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Pedido realizado'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_PLACED', 'orders', v_order.id, pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_order));

  return v_order;
end;
$$;

revoke execute on function public.mark_order_placed(uuid, text, date) from public;
revoke execute on function public.mark_order_placed(uuid, text, date) from anon;

create or replace function public.confirm_order_received(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.orders;
  v_order public.orders;
begin
  if not public.current_user_is_active() then
    raise exception 'Current user is inactive';
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

  if v_before.status <> 'ORDER_PLACED' then
    raise exception 'Order is not placed';
  end if;

  if coalesce(pg_catalog.btrim(v_before.delivery_protocol), '') = '' then
    raise exception 'Delivery protocol is required';
  end if;

  if v_before.delivery_date is null then
    raise exception 'Delivery date is required';
  end if;

  update public.orders
  set
    received_by_id = auth.uid(),
    received_at = pg_catalog.now(),
    status = 'RECEIVED'
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Recebimento confirmado'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_RECEIVED', 'orders', v_order.id, pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_order));

  return v_order;
end;
$$;

revoke execute on function public.confirm_order_received(uuid) from public;
revoke execute on function public.confirm_order_received(uuid) from anon;

grant execute on function public.mark_order_placed(uuid, text, date) to authenticated;
grant execute on function public.confirm_order_received(uuid) to authenticated;
