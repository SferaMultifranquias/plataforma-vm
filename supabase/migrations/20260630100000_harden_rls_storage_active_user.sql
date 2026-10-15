-- Forward migration: harden RLS and Storage policies with current_user_is_active().
-- Prevents removed/inactive users with stale JWTs from reading or mutating
-- protected application data through direct PostgREST or Storage API calls.

-- ============================================================
-- Helper: profiles_select_self_or_admin
-- Keep self-read available (needed for frontend bootstrap);
-- admin reads require active user.
-- ============================================================
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
using (
  id = auth.uid()
  or (public.is_admin() and public.current_user_is_active())
);

-- ============================================================
-- orders_select_visible_scope
-- ============================================================
drop policy if exists "orders_select_visible_scope" on public.orders;
create policy "orders_select_visible_scope"
on public.orders
for select
using (
  public.current_user_is_active()
  and (
    public.is_admin()
    or requester_id = auth.uid()
    or exists (
      select 1
      from public.user_stores us
      where us.user_id = auth.uid()
        and us.store_id = orders.store_id
    )
  )
);

-- ============================================================
-- orders_requester_edit_draft
-- ============================================================
drop policy if exists "orders_requester_edit_draft" on public.orders;
create policy "orders_requester_edit_draft"
on public.orders
for update
using (
  public.current_user_is_active()
  and requester_id = auth.uid()
  and status = 'DRAFT'
)
with check (
  public.current_user_is_active()
  and requester_id = auth.uid()
  and status = 'DRAFT'
);

-- ============================================================
-- order_items_select_visible_scope
-- ============================================================
drop policy if exists "order_items_select_visible_scope" on public.order_items;
create policy "order_items_select_visible_scope"
on public.order_items
for select
using (
  public.current_user_is_active()
  and exists (
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

-- ============================================================
-- order_items_requester_edit_draft
-- ============================================================
drop policy if exists "order_items_requester_edit_draft" on public.order_items;
create policy "order_items_requester_edit_draft"
on public.order_items
for all
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
)
with check (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

-- ============================================================
-- order_images_select_visible_scope
-- ============================================================
drop policy if exists "order_images_select_visible_scope" on public.order_images;
create policy "order_images_select_visible_scope"
on public.order_images
for select
using (
  public.current_user_is_active()
  and exists (
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

-- ============================================================
-- order_images_requester_edit_draft
-- ============================================================
drop policy if exists "order_images_requester_edit_draft" on public.order_images;
create policy "order_images_requester_edit_draft"
on public.order_images
for all
using (
  public.current_user_is_active()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
)
with check (
  public.current_user_is_active()
  and uploaded_by_id = auth.uid()
  and exists (
    select 1
    from public.orders o
    where o.id = order_images.order_id
      and o.requester_id = auth.uid()
      and o.status = 'DRAFT'
  )
);

-- ============================================================
-- status_history_select_visible_scope
-- ============================================================
drop policy if exists "status_history_select_visible_scope" on public.status_history;
create policy "status_history_select_visible_scope"
on public.status_history
for select
using (
  public.current_user_is_active()
  and exists (
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

-- ============================================================
-- user_stores_select_self_or_admin
-- ============================================================
drop policy if exists "user_stores_select_self_or_admin" on public.user_stores;
create policy "user_stores_select_self_or_admin"
on public.user_stores
for select
using (
  public.current_user_is_active()
  and (user_id = auth.uid() or public.is_admin())
);

-- ============================================================
-- audit_logs_admin_only
-- ============================================================
drop policy if exists "audit_logs_admin_only" on public.audit_logs;
create policy "audit_logs_admin_only"
on public.audit_logs
for select
using (public.is_admin() and public.current_user_is_active());

-- ============================================================
-- Storage: order_images_storage_select
-- ============================================================
drop policy if exists "order_images_storage_select" on storage.objects;
create policy "order_images_storage_select"
on storage.objects
for select
using (
  bucket_id = 'order-images'
  and public.current_user_is_active()
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

-- ============================================================
-- Storage: order_images_storage_insert
-- ============================================================
drop policy if exists "order_images_storage_insert" on storage.objects;
create policy "order_images_storage_insert"
on storage.objects
for insert
with check (
  bucket_id = 'order-images'
  and public.current_user_is_active()
  and split_part(name, '/', 1) = 'orders'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1
    from public.orders o
    where o.id::text = split_part(name, '/', 3)
      and o.requester_id = auth.uid()
      and o.status in ('DRAFT', 'CHANGES_REQUESTED')
  )
);

-- ============================================================
-- Storage: order_images_storage_delete
-- ============================================================
drop policy if exists "order_images_storage_delete" on storage.objects;
create policy "order_images_storage_delete"
on storage.objects
for delete
using (
  bucket_id = 'order-images'
  and public.current_user_is_active()
  and split_part(name, '/', 1) = 'orders'
  and split_part(name, '/', 2) = auth.uid()::text
  and exists (
    select 1
    from public.orders o
    where o.id::text = split_part(name, '/', 3)
      and o.requester_id = auth.uid()
      and o.status in ('DRAFT', 'CHANGES_REQUESTED')
  )
);
