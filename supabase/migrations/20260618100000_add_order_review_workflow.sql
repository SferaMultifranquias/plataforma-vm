create extension if not exists "pgcrypto";

create table if not exists public.user_stores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id bigint not null references public.lojas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

alter table public.orders
  add column if not exists store_id bigint,
  add column if not exists cancelled_by_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.orders
  drop constraint if exists orders_store_id_fkey;
alter table public.orders
  add constraint orders_store_id_fkey
  foreign key (store_id) references public.lojas(id);

alter table public.orders
  drop constraint if exists orders_cancelled_by_id_fkey;
alter table public.orders
  add constraint orders_cancelled_by_id_fkey
  foreign key (cancelled_by_id) references public.profiles(id);

alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED'));

create index if not exists idx_orders_store_id on public.orders(store_id);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at desc);
create index if not exists idx_user_stores_user_store on public.user_stores(user_id, store_id);
create index if not exists idx_status_history_order_created_at on public.status_history(order_id, created_at desc);
create index if not exists idx_order_images_order_id on public.order_images(order_id);

update public.orders o
set store_id = matched.store_id
from (
  select distinct on (o2.id)
    o2.id as order_id,
    l.id as store_id
  from public.orders o2
  join public.lojas l
    on lower(trim(coalesce(l.codigo, ''))) = lower(trim(coalesce(o2.cost_center, '')))
    or lower(trim(coalesce(l.nome, ''))) = lower(trim(coalesce(o2.store, '')))
  order by o2.id,
    case
      when lower(trim(coalesce(l.codigo, ''))) = lower(trim(coalesce(o2.cost_center, ''))) then 0
      when lower(trim(coalesce(l.nome, ''))) = lower(trim(coalesce(o2.store, ''))) then 1
      else 2
    end,
    l.id
) matched
where o.id = matched.order_id
  and o.store_id is null;

create or replace function public.user_can_access_store(p_store_id bigint)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.user_stores us
      where us.user_id = auth.uid()
        and us.store_id = p_store_id
    );
$$;

create or replace function public.order_visible_to_current_user(p_order_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        public.is_admin()
        or o.requester_id = auth.uid()
        or exists (
          select 1
          from public.user_stores us
          where us.user_id = auth.uid()
            and us.store_id = o.store_id
        )
      )
  );
$$;

create or replace function public.order_editable_by_current_user(p_order_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  );
$$;

create or replace function public.record_order_status_history(
  p_order_id uuid,
  p_previous_status text,
  p_new_status text,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed_by uuid;
begin
  select coalesce(auth.uid(), requester_id)
    into v_changed_by
  from public.orders
  where id = p_order_id;

  insert into public.status_history (
    order_id,
    previous_status,
    new_status,
    changed_by_id,
    comment
  )
  values (
    p_order_id,
    p_previous_status,
    p_new_status,
    coalesce(v_changed_by, auth.uid()),
    nullif(trim(p_comment), '')
  );
end;
$$;

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

drop trigger if exists trg_orders_status_history on public.orders;
drop function if exists public.log_order_status_change();

alter table public.user_stores enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_images enable row level security;
alter table public.status_history enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "user_stores_select_self_or_admin" on public.user_stores;
create policy "user_stores_select_self_or_admin"
on public.user_stores
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_stores_admin_write" on public.user_stores;
create policy "user_stores_admin_write"
on public.user_stores
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "orders_select_visible_scope" on public.orders;
create policy "orders_select_visible_scope"
on public.orders
for select
using (
  public.is_admin()
  or requester_id = auth.uid()
  or exists (
    select 1
    from public.user_stores us
    where us.user_id = auth.uid()
      and us.store_id = orders.store_id
  )
);

drop policy if exists "orders_requester_edit_draft" on public.orders;
create policy "orders_requester_edit_draft"
on public.orders
for update
using (
  requester_id = auth.uid()
  and status = 'DRAFT'
)
with check (
  requester_id = auth.uid()
  and status = 'DRAFT'
);

drop policy if exists "order_items_select_visible_scope" on public.order_items;
create policy "order_items_select_visible_scope"
on public.order_items
for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        public.is_admin()
        or o.requester_id = auth.uid()
        or exists (
          select 1
          from public.user_stores us
          where us.user_id = auth.uid()
            and us.store_id = o.store_id
        )
      )
  )
);

drop policy if exists "order_items_requester_edit_draft" on public.order_items;
create policy "order_items_requester_edit_draft"
on public.order_items
for all
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

drop policy if exists "order_images_select_visible_scope" on public.order_images;
create policy "order_images_select_visible_scope"
on public.order_images
for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and (
        public.is_admin()
        or o.requester_id = auth.uid()
        or exists (
          select 1
          from public.user_stores us
          where us.user_id = auth.uid()
            and us.store_id = o.store_id
        )
      )
  )
);

drop policy if exists "order_images_requester_edit_draft" on public.order_images;
create policy "order_images_requester_edit_draft"
on public.order_images
for all
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
)
with check (
  uploaded_by_id = auth.uid()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

drop policy if exists "status_history_select_visible_scope" on public.status_history;
create policy "status_history_select_visible_scope"
on public.status_history
for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = status_history.order_id
      and (
        public.is_admin()
        or o.requester_id = auth.uid()
        or exists (
          select 1
          from public.user_stores us
          where us.user_id = auth.uid()
            and us.store_id = o.store_id
        )
      )
  )
);

drop policy if exists "audit_logs_admin_only" on public.audit_logs;
create policy "audit_logs_admin_only"
on public.audit_logs
for select
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-images',
  'order-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "order_images_storage_select" on storage.objects;
create policy "order_images_storage_select"
on storage.objects
for select
using (
  bucket_id = 'order-images'
  and exists (
    select 1
    from public.order_images oi
    join public.orders o on o.id = oi.order_id
    where oi.storage_path = name
      and (
        public.is_admin()
        or o.requester_id = auth.uid()
        or exists (
          select 1
          from public.user_stores us
          where us.user_id = auth.uid()
            and us.store_id = o.store_id
        )
      )
  )
);

drop policy if exists "order_images_storage_insert" on storage.objects;
create policy "order_images_storage_insert"
on storage.objects
for insert
with check (
  bucket_id = 'order-images'
  and split_part(name, '/', 1) = 'orders'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1
    from public.orders o
    where o.id::text = split_part(name, '/', 3)
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

drop policy if exists "order_images_storage_delete" on storage.objects;
create policy "order_images_storage_delete"
on storage.objects
for delete
using (
  bucket_id = 'order-images'
  and split_part(name, '/', 1) = 'orders'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1
    from public.orders o
    where o.id::text = split_part(name, '/', 3)
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

grant select, insert, update, delete on public.user_stores to authenticated;
grant execute on function public.user_can_access_store(bigint) to authenticated;
grant execute on function public.order_visible_to_current_user(uuid) to authenticated;
grant execute on function public.order_editable_by_current_user(uuid) to authenticated;
grant execute on function public.create_order(text, text, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.submit_order(uuid) to authenticated;
grant execute on function public.return_order_to_draft(uuid) to authenticated;
grant execute on function public.approve_order(uuid) to authenticated;
grant execute on function public.reject_order(uuid, text) to authenticated;
grant execute on function public.request_order_changes(uuid, text) to authenticated;
