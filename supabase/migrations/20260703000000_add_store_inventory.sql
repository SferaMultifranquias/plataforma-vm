-- Add store inventory system

-- 1) inventory_items
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null references public.lojas(id) on delete cascade,
  product_code text not null,
  description text not null default '',
  current_quantity numeric(12,2) not null default 0,
  minimum_quantity numeric(12,2) not null default 0,
  unit text not null default 'un',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- unique per store + normalized product_code
create unique index if not exists idx_inventory_items_store_product
  on public.inventory_items (store_id, upper(btrim(product_code)));

create index if not exists idx_inventory_items_store
  on public.inventory_items (store_id);

create index if not exists idx_inventory_items_product_code
  on public.inventory_items (upper(btrim(product_code)));

-- 2) inventory_movements
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  store_id bigint not null references public.lojas(id) on delete cascade,
  product_code text not null,
  movement_type text not null check (movement_type in ('INITIAL_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')),
  quantity_delta numeric(12,2) not null,
  quantity_before numeric(12,2) not null,
  quantity_after numeric(12,2) not null,
  order_id uuid references public.orders(id) on delete set null,
  reason text not null default '',
  created_by_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_movements_item
  on public.inventory_movements (inventory_item_id);

create index if not exists idx_inventory_movements_store
  on public.inventory_movements (store_id);

create index if not exists idx_inventory_movements_created
  on public.inventory_movements (created_at desc);

-- 3) order_items FK
alter table public.order_items
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

create index if not exists idx_order_items_inventory_item
  on public.order_items (inventory_item_id);

-- 4) Enable RLS
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

-- 5) RLS policies

-- inventory_items: SELECT — active users, admin sees all, loja sees linked stores
create policy inventory_items_select
  on public.inventory_items for select
  using (
    current_user_is_active()
    and (
      is_admin()
      or user_can_access_store(store_id)
    )
  );

-- inventory_items: INSERT — admin only
create policy inventory_items_admin_insert
  on public.inventory_items for insert
  with check (
    is_admin()
    and current_user_is_active()
  );

-- inventory_items: UPDATE — admin only
create policy inventory_items_admin_update
  on public.inventory_items for update
  using (
    is_admin()
    and current_user_is_active()
  )
  with check (
    is_admin()
    and current_user_is_active()
  );

-- inventory_items: DELETE — admin only
create policy inventory_items_admin_delete
  on public.inventory_items for delete
  using (
    is_admin()
    and current_user_is_active()
  );

-- inventory_movements: SELECT — active users, admin sees all, loja sees linked stores
create policy inventory_movements_select
  on public.inventory_movements for select
  using (
    current_user_is_active()
    and (
      is_admin()
      or user_can_access_store(store_id)
    )
  );

-- inventory_movements: INSERT — admin only
create policy inventory_movements_admin_insert
  on public.inventory_movements for insert
  with check (
    is_admin()
    and current_user_is_active()
  );

-- 6) Grants
-- anon receives SELECT only on both tables
grant select on public.inventory_items to anon, authenticated;
grant select on public.inventory_movements to anon, authenticated;

-- INSERT/UPDATE/DELETE restricted to admin via RLS — no direct grant needed
-- (RLS policies enforce admin; default deny for authenticated applies)
-- Required: grant INSERT/UPDATE/DELETE so service_role can bypass RLS
grant insert, update, delete on public.inventory_items to authenticated;
grant insert on public.inventory_movements to authenticated;
