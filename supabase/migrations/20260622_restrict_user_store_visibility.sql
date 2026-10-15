-- Restrict user store visibility at DB layer.
-- Goals:
--   1. Non-admin users see only active stores
--   2. Inactive users cannot read stores or create orders
--   3. create_order RPC enforces active-user + active-store + store-access
--   4. user_can_access_store helper enforces active-user + active-store

-- ============================================================
-- Helper: current_user_is_active
-- Security definer bypasses RLS to read profiles.is_active.
-- Used in RLS policies AND RPCs.
-- ============================================================
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_active from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- Update lojas_select_authenticated: non-admin sees only active
-- Admin still sees all (needed for /lojas management page)
-- ============================================================
drop policy if exists "lojas_select_authenticated" on public.lojas;
create policy "lojas_select_authenticated"
on public.lojas
for select
using (
  auth.uid() is not null
  and public.current_user_is_active()
  and (public.is_admin() or lojas.ativo = true)
);

-- ============================================================
-- Update orders_insert_own: require active user + store access
-- Prevents direct-insert bypass of create_order RPC store auth.
-- Null store_id allowed for backward compat; non-null requires
-- user_can_access_store (admin bypass OR linked active store).
-- ============================================================
drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
on public.orders
for insert
with check (
  requester_id = auth.uid()
  and public.current_user_is_active()
  and (
    orders.store_id is null
    or public.user_can_access_store(orders.store_id)
  )
);

-- ============================================================
-- Update create_order RPC: add active-user + active-store guards
-- ============================================================
create or replace function public.create_order(
  p_brand text,
  p_store text,
  p_cost_center text,
  p_purpose text,
  p_justification text,
  p_priority text,
  p_notes text default null,
  p_store_id bigint default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.lojas%rowtype;
  v_order public.orders;
begin
  if not public.current_user_is_active() then
    raise exception 'User is not active';
  end if;

  if p_store_id is not null then
    select *
      into v_store
    from public.lojas
    where id = p_store_id;
  end if;

  if v_store.id is null and coalesce(trim(p_store), '') <> '' then
    select *
      into v_store
    from public.lojas
    where lower(trim(coalesce(codigo, ''))) = lower(trim(p_store))
       or lower(trim(coalesce(nome, ''))) = lower(trim(p_store))
    order by
      case
        when lower(trim(coalesce(codigo, ''))) = lower(trim(p_store)) then 0
        when lower(trim(coalesce(nome, ''))) = lower(trim(p_store)) then 1
        else 2
      end,
      id
    limit 1;
  end if;

  if v_store.id is null then
    raise exception 'Store not found';
  end if;

  if not v_store.ativo then
    raise exception 'Store is not active';
  end if;

  if not public.is_admin() and not exists (
    select 1
    from public.user_stores us
    where us.user_id = auth.uid()
      and us.store_id = v_store.id
  ) then
    raise exception 'User is not allowed to create orders for this store';
  end if;

  insert into public.orders (
    internal_number,
    requester_id,
    store_id,
    brand,
    store,
    cost_center,
    purpose,
    justification,
    priority,
    notes,
    status
  )
  values (
    public.generate_order_internal_number(),
    auth.uid(),
    v_store.id,
    coalesce(nullif(trim(v_store.marca), ''), nullif(trim(p_brand), '')),
    v_store.nome,
    coalesce(nullif(trim(v_store.codigo), ''), nullif(trim(p_cost_center), '')),
    p_purpose,
    p_justification,
    p_priority,
    p_notes,
    'DRAFT'
  )
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    null,
    v_order.status,
    'Order created'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, new_data)
  values (auth.uid(), 'ORDER_CREATED', 'orders', v_order.id, to_jsonb(v_order));

  return v_order;
end;
$$;

-- ============================================================
-- Update user_can_access_store: require active store + active user
-- ============================================================
create or replace function public.user_can_access_store(p_store_id bigint)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.current_user_is_active()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_stores us
        join public.lojas l on l.id = us.store_id
        where us.user_id = auth.uid()
          and us.store_id = p_store_id
          and l.ativo = true
      )
    );
$$;

-- ============================================================
-- Grants
-- ============================================================
grant execute on function public.current_user_is_active() to authenticated;
