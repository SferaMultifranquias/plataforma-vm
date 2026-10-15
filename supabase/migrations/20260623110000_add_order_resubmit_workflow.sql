create or replace function public.order_editable_by_current_user(p_order_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    join public.profiles p on p.id = auth.uid()
    where o.id = p_order_id
      and o.requester_id = auth.uid()
      and p.is_active = true
      and o.status in ('DRAFT', 'CHANGES_REQUESTED')
  );
$$;

create or replace function public.resubmit_changed_order(
  p_order_id uuid,
  p_items jsonb,
  p_image jsonb default null,
  p_purpose text default null,
  p_justification text default null,
  p_priority text default 'NORMAL',
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.orders;
  v_order public.orders;
  v_profile public.profiles%rowtype;
  v_item jsonb;
  v_seen_codes text[] := array[]::text[];
  v_old_storage_paths text[] := array[]::text[];
  v_product_code text;
  v_description text;
  v_category text;
  v_unit text;
  v_item_notes text;
  v_priority text := upper(trim(coalesce(p_priority, 'NORMAL')));
  v_quantity numeric(12, 2);
  v_image_bucket text;
  v_image_storage_path text;
  v_image_hash text;
  v_image_filename text;
  v_image_mime text;
  v_image_size bigint;
  v_image_uploaded_by uuid;
begin
  select *
    into v_profile
  from public.profiles
  where id = auth.uid()
  for update;

  if not found or not coalesce(v_profile.is_active, false) then
    raise exception 'User is not active';
  end if;

  select *
    into v_before
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_before.requester_id <> auth.uid() then
    raise exception 'Only requester can resubmit the order';
  end if;

  if v_before.status <> 'CHANGES_REQUESTED' then
    raise exception 'Only orders with requested changes can be resubmitted';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  if nullif(trim(coalesce(p_purpose, '')), '') is null then
    raise exception 'Purpose is required';
  end if;

  if nullif(trim(coalesce(p_justification, '')), '') is null then
    raise exception 'Justification is required';
  end if;

  if v_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'Invalid priority';
  end if;

  if coalesce(length(coalesce(p_notes, '')), 0) > 500 then
    raise exception 'Notes too long';
  end if;

  delete from public.order_items
  where order_id = p_order_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items) as value
  loop
    v_product_code := upper(trim(coalesce(v_item->>'product_code', v_item->>'productCode', v_item->>'sku_digitado', v_item->>'customerCode', '')));
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_category := nullif(trim(coalesce(v_item->>'category', '')), '');
    v_unit := coalesce(nullif(trim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_item_notes := nullif(trim(coalesce(v_item->>'notes', '')), '');
    v_quantity := nullif(trim(coalesce(v_item->>'quantity', v_item->>'quantidade', '')), '')::numeric;

    if v_product_code = '' then
      raise exception 'Item product code is required';
    end if;

    if v_product_code = any(v_seen_codes) then
      raise exception 'Duplicate items are not allowed';
    end if;

    if v_description is null then
      v_description := v_product_code;
    end if;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Item quantity must be greater than zero';
    end if;

    if coalesce(length(v_item_notes), 0) > 500 then
      raise exception 'Item notes too long';
    end if;

    v_seen_codes := array_append(v_seen_codes, v_product_code);

    insert into public.order_items (
      order_id,
      product_code,
      description,
      category,
      quantity,
      unit,
      notes
    )
    values (
      p_order_id,
      v_product_code,
      v_description,
      v_category,
      v_quantity,
      v_unit,
      v_item_notes
    );
  end loop;

  if p_image is not null then
    if jsonb_typeof(p_image) <> 'object' then
      raise exception 'Invalid image payload';
    end if;

    v_image_bucket := coalesce(nullif(trim(coalesce(p_image->>'bucket_name', '')), ''), '');
    v_image_storage_path := nullif(trim(coalesce(p_image->>'storage_path', '')), '');
    v_image_hash := nullif(trim(coalesce(p_image->>'file_hash', '')), '');
    v_image_filename := nullif(trim(coalesce(p_image->>'original_filename', '')), '');
    v_image_mime := nullif(trim(coalesce(p_image->>'mime_type', '')), '');
    v_image_size := nullif(trim(coalesce(p_image->>'file_size', '')), '')::bigint;
    v_image_uploaded_by := nullif(trim(coalesce(p_image->>'uploaded_by_id', '')), '')::uuid;

    if v_image_bucket <> 'order-images' then
      raise exception 'Invalid image bucket';
    end if;

    if v_image_storage_path is null then
      raise exception 'Invalid image storage path';
    end if;

    if split_part(v_image_storage_path, '/', 1) <> 'orders'
      or split_part(v_image_storage_path, '/', 2) <> auth.uid()::text
      or split_part(v_image_storage_path, '/', 3) <> p_order_id::text then
      raise exception 'Invalid image storage path';
    end if;

    if v_image_hash is null or v_image_filename is null or v_image_mime is null or v_image_size is null then
      raise exception 'Invalid image payload';
    end if;

    if v_image_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Invalid image mime type';
    end if;

    if v_image_size <= 0 or v_image_size > 5242880 then
      raise exception 'Invalid image size';
    end if;

    if v_image_uploaded_by is distinct from auth.uid() then
      raise exception 'Invalid image owner';
    end if;

    if coalesce(nullif(trim(coalesce(p_image->>'order_item_id', '')), ''), '') <> '' then
      raise exception 'Image cannot be linked to order item';
    end if;

    select coalesce(array_agg(storage_path), array[]::text[])
      into v_old_storage_paths
    from public.order_images
    where order_id = p_order_id;

    if array_length(v_old_storage_paths, 1) is not null then
      delete from storage.objects
      where bucket_id = 'order-images'
        and name = any(v_old_storage_paths);
    end if;

    delete from public.order_images
    where order_id = p_order_id;

    insert into public.order_images (
      order_id,
      order_item_id,
      uploaded_by_id,
      original_filename,
      storage_path,
      bucket_name,
      mime_type,
      file_size,
      file_hash
    )
    values (
      p_order_id,
      null,
      auth.uid(),
      v_image_filename,
      v_image_storage_path,
      v_image_bucket,
      v_image_mime,
      v_image_size,
      v_image_hash
    );
  end if;

  update public.orders
  set
    purpose = p_purpose,
    justification = p_justification,
    priority = v_priority,
    notes = p_notes,
    status = 'PENDING_APPROVAL',
    submitted_at = now(),
    approved_by_id = null,
    approved_at = null,
    rejected_at = null,
    rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  perform public.record_order_status_history(
    v_order.id,
    v_before.status,
    v_order.status,
    'Resubmitted after requested changes'
  );

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'ORDER_RESUBMITTED', 'orders', v_order.id, to_jsonb(v_before), to_jsonb(v_order));

  return v_order;
end;
$$;

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
      and o.status in ('DRAFT', 'CHANGES_REQUESTED')
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
      and o.status in ('DRAFT', 'CHANGES_REQUESTED')
  )
);

grant execute on function public.resubmit_changed_order(uuid, jsonb, jsonb, text, text, text, text) to authenticated;
