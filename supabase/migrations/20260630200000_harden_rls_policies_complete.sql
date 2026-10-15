-- Forward migration: harden remaining RLS policies and current_user_is_active().
--
-- Problem: Several RLS policies were missing current_user_is_active() checks.
-- Because Supabase OR's multiple policies per table+command, the old unchecked
-- policies allowed removed/inactive users with stale JWTs to bypass the new
-- hardened policies added in 20260630100000.
--
-- Also: current_user_is_active() only checked is_active but not removed_at,
-- leaving a theoretical gap if a profile somehow had is_active=true with
-- removed_at set.
--
-- Fixes:
-- 1. current_user_is_active(): also require removed_at IS NULL
-- 2. Existing _select_own_or_admin policies: add current_user_is_active()
-- 3. Existing _modify_editable_orders policies: add current_user_is_active()
-- 4. Existing _update_draft_own_or_admin policy: add current_user_is_active()
-- 5. lojas_admin_write: add current_user_is_active()
-- 6. user_stores_admin_write: add current_user_is_active()
-- 7. profiles_update_self_limited: add current_user_is_active() for admin branch

-- ============================================================
-- 1. current_user_is_active(): also check removed_at IS NULL
-- ============================================================
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_active and removed_at is null from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- 2. orders_select_own_or_admin
-- ============================================================
drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_admin"
on public.orders
for select
using (
  public.current_user_is_active()
  and (requester_id = auth.uid() or public.is_admin())
);

-- ============================================================
-- 3. orders_update_draft_own_or_admin
-- ============================================================
drop policy if exists "orders_update_draft_own_or_admin" on public.orders;
create policy "orders_update_draft_own_or_admin"
on public.orders
for update
using (
  public.current_user_is_active()
  and (
    public.is_admin()
    or (requester_id = auth.uid() and status = any (array['DRAFT', 'REJECTED']))
  )
)
with check (
  public.current_user_is_active()
  and (
    public.is_admin()
    or (requester_id = auth.uid() and status = any (array['DRAFT', 'REJECTED']))
  )
);

-- ============================================================
-- 4. order_items_select_own_or_admin
-- ============================================================
drop policy if exists "order_items_select_own_or_admin" on public.order_items;
create policy "order_items_select_own_or_admin"
on public.order_items
for select
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (o.requester_id = auth.uid() or public.is_admin())
  )
);

-- ============================================================
-- 5. order_items_modify_editable_orders
-- ============================================================
drop policy if exists "order_items_modify_editable_orders" on public.order_items;
create policy "order_items_modify_editable_orders"
on public.order_items
for all
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        public.is_admin()
        or (o.requester_id = auth.uid() and o.status = any (array['DRAFT', 'REJECTED']))
      )
  )
)
with check (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        public.is_admin()
        or (o.requester_id = auth.uid() and o.status = any (array['DRAFT', 'REJECTED']))
      )
  )
);

-- ============================================================
-- 6. order_images_select_own_or_admin
-- ============================================================
drop policy if exists "order_images_select_own_or_admin" on public.order_images;
create policy "order_images_select_own_or_admin"
on public.order_images
for select
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and (o.requester_id = auth.uid() or public.is_admin())
  )
);

-- ============================================================
-- 7. order_images_modify_editable_orders
-- ============================================================
drop policy if exists "order_images_modify_editable_orders" on public.order_images;
create policy "order_images_modify_editable_orders"
on public.order_images
for all
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and (
        public.is_admin()
        or (o.requester_id = auth.uid() and o.status = any (array['DRAFT', 'REJECTED']))
      )
  )
)
with check (
  uploaded_by_id = auth.uid()
  and public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and (
        public.is_admin()
        or (o.requester_id = auth.uid() and o.status = any (array['DRAFT', 'REJECTED']))
      )
  )
);

-- ============================================================
-- 8. status_history_select_own_or_admin
-- ============================================================
drop policy if exists "status_history_select_own_or_admin" on public.status_history;
create policy "status_history_select_own_or_admin"
on public.status_history
for select
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = status_history.order_id
      and (o.requester_id = auth.uid() or public.is_admin())
  )
);

-- ============================================================
-- 9. lojas_admin_write
-- ============================================================
drop policy if exists "lojas_admin_write" on public.lojas;
create policy "lojas_admin_write"
on public.lojas
for all
using (public.is_admin() and public.current_user_is_active())
with check (public.is_admin() and public.current_user_is_active());

-- ============================================================
-- 10. user_stores_admin_write
-- ============================================================
drop policy if exists "user_stores_admin_write" on public.user_stores;
create policy "user_stores_admin_write"
on public.user_stores
for all
using (public.is_admin() and public.current_user_is_active())
with check (public.is_admin() and public.current_user_is_active());

-- ============================================================
-- 11. profiles_update_self_limited — admin branch needs active
-- ============================================================
drop policy if exists "profiles_update_self_limited" on public.profiles;
create policy "profiles_update_self_limited"
on public.profiles
for update
using (
  id = auth.uid()
  or (public.is_admin() and public.current_user_is_active())
)
with check (
  public.is_admin() and public.current_user_is_active()
  or (
    id = auth.uid()
    and role = coalesce(
      upper(auth.jwt() -> 'app_metadata' ->> 'role'),
      role
    )
    and is_active = coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'is_active')::boolean,
      is_active
    )
  )
);
