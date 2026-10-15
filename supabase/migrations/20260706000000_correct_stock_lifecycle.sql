-- Correct stock lifecycle.
-- Phase 1: full-order receipt, no partial receipt, no auto-deduction.
-- Supersedes 20260703000000 (wrong inventory_items/inventory_movements model).
-- Supersedes 20260704000000_add_inventory_auto_deduction (removed, never applied).

-- 1) Drop wrong inventory model tables (local-only, never applied remotely)
drop table if exists public.inventory_movements cascade;
drop table if exists public.inventory_items cascade;

-- 2) Drop wrong FK from order_items
alter table public.order_items
  drop column if exists inventory_item_id;

-- 3) Revert mark_order_placed to original version (no auto-deduction)
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

grant execute on function public.mark_order_placed(uuid, text, date) to authenticated;

-- 4) Rewrite confirm_order_received to insert receipt stock rows
create or replace function public.confirm_order_received(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_item record;
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

  -- Create receipt stock rows for each order item
  for v_item in
    select oi.id as order_item_id, oi.product_code, oi.description, oi.quantity, oi.unit, v_order.store_id
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    insert into public.store_stock_receipts
      (order_id, order_item_id, store_id, product_code, description, received_quantity, unit, received_by)
    values
      (p_order_id, v_item.order_item_id, v_item.store_id, v_item.product_code, v_item.description, v_item.quantity, v_item.unit, auth.uid());

    -- upsert estimated balance
    insert into public.store_stock_balances
      (store_id, product_code, description, received_quantity_total, unit, last_received_at)
    values
      (v_item.store_id, v_item.product_code, v_item.description, v_item.quantity, v_item.unit, pg_catalog.now())
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

grant execute on function public.confirm_order_received(uuid) to authenticated;

-- 5) Create corrected tables

-- order_item_stock_checks: purchasing/admin analysis of requested items
create table if not exists public.order_item_stock_checks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  store_id bigint not null references public.lojas(id) on delete cascade,
  product_code text not null,
  description text not null default '',
  requested_quantity numeric(12,2) not null,
  stock_status text not null default 'pending_check'
    check (stock_status in ('pending_check', 'in_stock', 'partial_stock', 'out_of_stock', 'needs_purchase')),
  available_quantity numeric(12,2),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_order_item_stock_checks_item
  on public.order_item_stock_checks (order_item_id);

create index if not exists idx_order_item_stock_checks_order
  on public.order_item_stock_checks (order_id);

create index if not exists idx_order_item_stock_checks_store
  on public.order_item_stock_checks (store_id);

-- store_stock_receipts: immutable received stock history
create table if not exists public.store_stock_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  store_id bigint not null references public.lojas(id) on delete cascade,
  product_code text not null,
  description text not null default '',
  received_quantity numeric(12,2) not null,
  unit text not null default 'un',
  received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_store_stock_receipts_item
  on public.store_stock_receipts (order_item_id);

create index if not exists idx_store_stock_receipts_order
  on public.store_stock_receipts (order_id);

create index if not exists idx_store_stock_receipts_store
  on public.store_stock_receipts (store_id);

create index if not exists idx_store_stock_receipts_product
  on public.store_stock_receipts (store_id, upper(btrim(product_code)));

-- store_stock_balances: estimated balance from received purchases only
-- Not guaranteed physical stock because consumption tracking does not exist yet.
create table if not exists public.store_stock_balances (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null references public.lojas(id) on delete cascade,
  product_code text not null,
  description text not null default '',
  received_quantity_total numeric(12,2) not null default 0,
  unit text not null default 'un',
  last_received_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_store_stock_balances_store_product
  on public.store_stock_balances (store_id, upper(btrim(product_code)));

create index if not exists idx_store_stock_balances_store
  on public.store_stock_balances (store_id);

create index if not exists idx_store_stock_balances_product
  on public.store_stock_balances (upper(btrim(product_code)));

-- 6) Enable RLS
alter table public.order_item_stock_checks enable row level security;
alter table public.store_stock_receipts enable row level security;
alter table public.store_stock_balances enable row level security;

-- 7) RLS policies

-- order_item_stock_checks

create policy order_item_stock_checks_select
  on public.order_item_stock_checks for select
  using (
    public.current_user_is_active()
    and (
      public.is_admin()
      or public.user_can_access_store(store_id)
    )
  );

create policy order_item_stock_checks_admin_insert
  on public.order_item_stock_checks for insert
  with check (
    public.is_admin()
    and public.current_user_is_active()
  );

create policy order_item_stock_checks_admin_update
  on public.order_item_stock_checks for update
  using (
    public.is_admin()
    and public.current_user_is_active()
  )
  with check (
    public.is_admin()
    and public.current_user_is_active()
  );

create policy order_item_stock_checks_admin_delete
  on public.order_item_stock_checks for delete
  using (
    public.is_admin()
    and public.current_user_is_active()
  );

-- store_stock_receipts (insert only via confirm_order_received RPC)
create policy store_stock_receipts_select
  on public.store_stock_receipts for select
  using (
    public.current_user_is_active()
    and (
      public.is_admin()
      or public.user_can_access_store(store_id)
    )
  );

-- store_stock_balances
create policy store_stock_balances_select
  on public.store_stock_balances for select
  using (
    public.current_user_is_active()
    and (
      public.is_admin()
      or public.user_can_access_store(store_id)
    )
  );

-- 8) Grants
grant select on public.order_item_stock_checks to anon, authenticated;
grant insert, update, delete on public.order_item_stock_checks to authenticated;
grant select on public.store_stock_receipts to anon, authenticated;
grant select on public.store_stock_balances to anon, authenticated;
