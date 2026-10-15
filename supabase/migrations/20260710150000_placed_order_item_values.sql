-- Move item values to placed order.
-- Stores unit values in order_items at ORDER_PLACED time (not RECEIVED).
-- Receipt reads from order_items, keeping p_item_values as legacy fallback.

-- 1) Add placed_unit_value / placed_total_value to order_items
alter table public.order_items
  add column if not exists placed_unit_value numeric(12,2),
  add column if not exists placed_total_value numeric(12,2);

-- 2) Drop old 3-param overload, create new 4-param mark_order_placed
drop function if exists public.mark_order_placed(uuid, text, date);

create or replace function public.mark_order_placed(
  p_order_id uuid,
  p_delivery_protocol text,
  p_delivery_date date,
  p_item_values jsonb default null
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
  v_item record;
  v_unit_value numeric(12,2);
  v_total_value numeric(12,2);
  v_count int;
  v_msg text;
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

  select * into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'APPROVED' then
    raise exception 'Order is not approved';
  end if;

  -- Validate p_item_values: array with entries for all items
  if p_item_values is null or not jsonb_typeof(p_item_values) = 'array' then
    raise exception 'Item values are required';
  end if;

  if jsonb_array_length(p_item_values) = 0 then
    raise exception 'Item values are required';
  end if;

  select count(*) into v_count
  from public.order_items oi
  where oi.order_id = p_order_id
    and not exists (
      select 1 from jsonb_array_elements(p_item_values) elem
      where elem->>'order_item_id' = oi.id::text
        and (elem->>'unit_value')::numeric(12,2) > 0
    );

  if v_count > 0 then
    v_msg := 'All items must have a valid unit value';
    raise exception '%', v_msg;
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
    v_order.id, v_before.status, v_order.status, 'Pedido realizado');

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_PLACED', 'orders', v_order.id,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_order));

  -- Save unit values in order_items
  for v_item in
    select oi.id as order_item_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    v_unit_value := null;
    v_total_value := null;
    select (elem->>'unit_value')::numeric(12,2) into v_unit_value
    from jsonb_array_elements(p_item_values) elem
    where elem->>'order_item_id' = v_item.order_item_id::text;

    if v_unit_value is not null then
      v_total_value := v_item.quantity * v_unit_value;
      update public.order_items
      set placed_unit_value = v_unit_value,
          placed_total_value = v_total_value
      where id = v_item.order_item_id;
    end if;
  end loop;

  return v_order;
end;
$$;

revoke execute on function public.mark_order_placed(uuid, text, date, jsonb) from public, anon;
grant execute on function public.mark_order_placed(uuid, text, date, jsonb) to authenticated;

-- 3) Drop old overloads, rewrite confirm_order_received to read values from order_items first
drop function if exists public.confirm_order_received(uuid);
create or replace function public.confirm_order_received(
  p_order_id uuid,
  p_invoice_number text default null,
  p_item_values jsonb default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_item record;
  v_invoice_number text;
  v_receipt_id uuid;
  v_unit_value numeric(12,2);
  v_total_value numeric(12,2);
begin
  if not public.current_user_is_active() then
    raise exception 'Current user is inactive';
  end if;

  select * into v_before
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

  v_invoice_number := nullif(pg_catalog.btrim(p_invoice_number), '');
  if v_invoice_number is null then
    raise exception 'Invoice number is required';
  end if;

  insert into public.order_receipts (order_id, invoice_number, confirmed_by)
  values (p_order_id, v_invoice_number, auth.uid())
  returning id into v_receipt_id;

  update public.orders
  set received_by_id = auth.uid(),
      received_at = pg_catalog.now(),
      status = 'RECEIVED'
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id, v_before.status, v_order.status, 'Recebimento confirmado');

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_RECEIVED', 'orders', v_order.id,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_order));

  for v_item in
    select oi.id as order_item_id, oi.product_code, oi.description, oi.quantity, oi.unit,
           oi.placed_unit_value, oi.placed_total_value, v_order.store_id
    from public.order_items oi
    where oi.order_id = p_order_id
    order by oi.created_at
  loop
    v_unit_value := null;
    v_total_value := null;

    if v_item.placed_unit_value is not null then
      v_unit_value := v_item.placed_unit_value;
      v_total_value := v_item.placed_total_value;
    elsif p_item_values is not null then
      select (elem->>'unit_value')::numeric(12,2) into v_unit_value
      from jsonb_array_elements(p_item_values) elem
      where elem->>'order_item_id' = v_item.order_item_id::text;

      if v_unit_value is not null then
        v_total_value := v_item.quantity * v_unit_value;
      end if;
    end if;

    if v_unit_value is null then
      raise exception 'Unit value missing for item %', v_item.order_item_id;
    end if;

    insert into public.store_stock_receipts
      (order_id, order_item_id, order_receipt_id, store_id, product_code, description,
       received_quantity, unit, received_unit_value, received_total_value, received_by)
    values
      (p_order_id, v_item.order_item_id, v_receipt_id, v_item.store_id,
       v_item.product_code, v_item.description, v_item.quantity, v_item.unit,
       v_unit_value, v_total_value, auth.uid());

    insert into public.store_stock_balances
      (store_id, product_code, description, received_quantity_total, unit, last_received_at)
    values
      (v_item.store_id, v_item.product_code, v_item.description,
       v_item.quantity, v_item.unit, pg_catalog.now())
    on conflict (store_id, upper(btrim(product_code)))
    do update set
      received_quantity_total = public.store_stock_balances.received_quantity_total + v_item.quantity,
      description = case when v_item.description <> '' then v_item.description else public.store_stock_balances.description end,
      unit = v_item.unit,
      last_received_at = pg_catalog.now(),
      updated_at = pg_catalog.now();
  end loop;

  return v_order;
end;
$$;

revoke execute on function public.confirm_order_received(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_order_received(uuid, text, jsonb) to authenticated;
