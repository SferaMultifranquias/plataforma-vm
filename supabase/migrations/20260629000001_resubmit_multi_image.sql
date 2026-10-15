-- Multi-image support for order resubmit + draft cleanup.
-- resubmit_changed_order_multi_image handles metadata atomically without
-- touching storage.objects (Express service-role or RLS handles Storage).
-- cleanup_draft_order lets requester discard a stuck DRAFT pre-submit.

create or replace function public.resubmit_changed_order_multi_image(
  p_order_id uuid,
  p_items jsonb,
  p_images_metadata jsonb default '[]'::jsonb,
  p_remove_image_ids uuid[] default array[]::uuid[],
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
  v_product_code text;
  v_description text;
  v_category text;
  v_unit text;
  v_item_notes text;
  v_priority text := upper(trim(coalesce(p_priority, 'NORMAL')));
  v_quantity numeric(12, 2);
  v_img jsonb;
  v_img_bucket text;
  v_img_storage_path text;
  v_img_hash text;
  v_img_filename text;
  v_img_mime text;
  v_img_size bigint;
  v_remove_id uuid;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid()
  for update;

  if not found or not coalesce(v_profile.is_active, false) then
    raise exception 'User is not active';
  end if;

  select * into v_before
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

  if p_images_metadata is not null and jsonb_typeof(p_images_metadata) = 'array' then
    for v_img in select value from jsonb_array_elements(p_images_metadata) loop
      v_img_bucket := coalesce(nullif(trim(coalesce(v_img->>'bucket_name', '')), ''), '');
      v_img_storage_path := nullif(trim(coalesce(v_img->>'storage_path', '')), '');
      v_img_hash := nullif(trim(coalesce(v_img->>'file_hash', '')), '');
      v_img_filename := nullif(trim(coalesce(v_img->>'original_filename', '')), '');
      v_img_mime := nullif(trim(coalesce(v_img->>'mime_type', '')), '');
      v_img_size := nullif(trim(coalesce(v_img->>'file_size', '')), '')::bigint;

      if v_img_bucket <> 'order-images' then
        raise exception 'Invalid image bucket';
      end if;

      if v_img_storage_path is null then
        raise exception 'Invalid image storage path';
      end if;

      if split_part(v_img_storage_path, '/', 1) <> 'orders'
        or split_part(v_img_storage_path, '/', 2) <> auth.uid()::text
        or split_part(v_img_storage_path, '/', 3) <> p_order_id::text then
        raise exception 'Invalid image storage path';
      end if;

      if v_img_hash is null or v_img_filename is null or v_img_mime is null or v_img_size is null then
        raise exception 'Invalid image payload';
      end if;

      if v_img_mime not in ('image/jpeg', 'image/png', 'image/webp') then
        raise exception 'Invalid image mime type';
      end if;

      if v_img_size <= 0 or v_img_size > 5242880 then
        raise exception 'Invalid image size';
      end if;
    end loop;
  end if;

  if p_remove_image_ids is not null and array_length(p_remove_image_ids, 1) > 0 then
    foreach v_remove_id in array p_remove_image_ids loop
      perform 1 from public.order_images
      where id = v_remove_id and order_id = p_order_id;
      if not found then
        raise exception 'Image not found for removal';
      end if;
    end loop;
  end if;

  delete from public.order_items where order_id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_code := upper(trim(coalesce(v_item->>'product_code', v_item->>'productCode', v_item->>'sku_digitado', v_item->>'customerCode', '')));
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_category := nullif(trim(coalesce(v_item->>'category', '')), '');
    v_unit := coalesce(nullif(trim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_item_notes := nullif(trim(coalesce(v_item->>'notes', '')), '');
    v_quantity := nullif(trim(coalesce(v_item->>'quantity', v_item->>'quantidade', '')), '')::numeric;

    if v_product_code = '' then raise exception 'Item product code is required'; end if;
    if v_product_code = any(v_seen_codes) then raise exception 'Duplicate items are not allowed'; end if;
    if v_description is null then v_description := v_product_code; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Item quantity must be greater than zero'; end if;
    if coalesce(length(v_item_notes), 0) > 500 then raise exception 'Item notes too long'; end if;

    v_seen_codes := array_append(v_seen_codes, v_product_code);

    insert into public.order_items (order_id, product_code, description, category, quantity, unit, notes)
    values (p_order_id, v_product_code, v_description, v_category, v_quantity, v_unit, v_item_notes);
  end loop;

  if p_remove_image_ids is not null and array_length(p_remove_image_ids, 1) > 0 then
    delete from public.order_images
    where id = any(p_remove_image_ids) and order_id = p_order_id;
  end if;

  if p_images_metadata is not null and jsonb_typeof(p_images_metadata) = 'array' then
    for v_img in select value from jsonb_array_elements(p_images_metadata) loop
      v_img_bucket := coalesce(nullif(trim(coalesce(v_img->>'bucket_name', '')), ''), 'order-images');
      v_img_storage_path := nullif(trim(coalesce(v_img->>'storage_path', '')), '');
      v_img_hash := nullif(trim(coalesce(v_img->>'file_hash', '')), '');
      v_img_filename := nullif(trim(coalesce(v_img->>'original_filename', '')), '');
      v_img_mime := nullif(trim(coalesce(v_img->>'mime_type', '')), '');
      v_img_size := nullif(trim(coalesce(v_img->>'file_size', '')), '')::bigint;

      insert into public.order_images (
        order_id, order_item_id, uploaded_by_id,
        original_filename, storage_path, bucket_name,
        mime_type, file_size, file_hash
      ) values (
        p_order_id, null, auth.uid(),
        v_img_filename, v_img_storage_path, v_img_bucket,
        v_img_mime, v_img_size, v_img_hash
      );
    end loop;
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

create or replace function public.cleanup_draft_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.requester_id <> auth.uid() then
    raise exception 'Only requester can cleanup the order';
  end if;

  if v_order.status <> 'DRAFT' then
    raise exception 'Only DRAFT orders can be cleaned up';
  end if;

  delete from public.order_images where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id;
end;
$$;

revoke execute on function public.resubmit_changed_order_multi_image(uuid, jsonb, jsonb, uuid[], text, text, text, text) from public, anon;
grant execute on function public.resubmit_changed_order_multi_image(uuid, jsonb, jsonb, uuid[], text, text, text, text) to authenticated;
revoke execute on function public.cleanup_draft_order(uuid) from public, anon;
grant execute on function public.cleanup_draft_order(uuid) to authenticated;
