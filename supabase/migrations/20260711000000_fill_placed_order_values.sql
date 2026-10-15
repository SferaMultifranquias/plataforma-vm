-- Allow admin to fill missing placed_unit_value for ORDER_PLACED items.
-- No status change, no history/audit duplication.
-- Used when order was placed before values were collected.

create or replace function public.fill_placed_order_values(
  p_order_id uuid,
  p_item_values jsonb
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
  v_unit_value numeric(12,2);
  v_total_value numeric(12,2);
  v_count int;
  v_msg text;
begin
  if not public.current_user_is_active() then
    raise exception 'Current user is inactive';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can fill placed order values';
  end if;

  if p_item_values is null or not jsonb_typeof(p_item_values) = 'array' then
    raise exception 'Item values are required';
  end if;

  if jsonb_array_length(p_item_values) = 0 then
    raise exception 'Item values are required';
  end if;

  select * into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.status <> 'ORDER_PLACED' then
    raise exception 'Order status must be ORDER_PLACED';
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

  select * into v_order
  from public.orders
  where id = p_order_id;

  return v_order;
end;
$$;

revoke execute on function public.fill_placed_order_values(uuid, jsonb) from public, anon;
grant execute on function public.fill_placed_order_values(uuid, jsonb) to authenticated;
