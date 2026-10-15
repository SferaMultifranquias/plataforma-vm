-- Admin stock receipt corrections
-- Adds void metadata, update tracking, and correction RPCs
-- Receipts remain append-origin immutable via insert-only policy;
-- admin corrections go through audited SECURITY DEFINER RPCs only.

-- 1) Add columns to store_stock_receipts
alter table public.store_stock_receipts
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles(id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id),
  add column if not exists void_reason text;

-- 2) Recompute balance for a store+SKU from non-voided receipts
create or replace function public.recompute_store_stock_balance(
  p_store_id bigint,
  p_product_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(12,2);
  v_description text;
  v_unit text;
  v_last_received_at timestamptz;
  v_normalized text;
begin
  v_normalized := upper(btrim(p_product_code));

  select
    coalesce(sum(r.received_quantity), 0),
    (select r2.description from public.store_stock_receipts r2
      where r2.store_id = p_store_id
        and upper(btrim(r2.product_code)) = v_normalized
        and r2.voided_at is null
      order by r2.received_at desc limit 1),
    (select r2.unit from public.store_stock_receipts r2
      where r2.store_id = p_store_id
        and upper(btrim(r2.product_code)) = v_normalized
        and r2.voided_at is null
      order by r2.received_at desc limit 1),
    (select max(r2.received_at) from public.store_stock_receipts r2
      where r2.store_id = p_store_id
        and upper(btrim(r2.product_code)) = v_normalized
        and r2.voided_at is null)
  into v_total, v_description, v_unit, v_last_received_at
  from public.store_stock_receipts r
  where r.store_id = p_store_id
    and upper(btrim(r.product_code)) = v_normalized
    and r.voided_at is null;

  if v_total > 0 then
    insert into public.store_stock_balances
      (store_id, product_code, description, received_quantity_total, unit, last_received_at, updated_at)
    values
      (p_store_id, v_normalized, coalesce(v_description, ''), v_total, coalesce(v_unit, 'un'), v_last_received_at, now())
    on conflict (store_id, upper(btrim(product_code)))
    do update set
      received_quantity_total = v_total,
      description = coalesce(v_description, ''),
      unit = coalesce(v_unit, 'un'),
      last_received_at = v_last_received_at,
      updated_at = now();
  else
    delete from public.store_stock_balances
    where store_id = p_store_id
      and upper(btrim(product_code)) = v_normalized;
  end if;
end;
$$;

revoke execute on function public.recompute_store_stock_balance(bigint, text) from public, anon;
grant execute on function public.recompute_store_stock_balance(bigint, text) to authenticated;

-- 3) Admin update stock receipt RPC
create or replace function public.admin_update_stock_receipt(
  p_receipt_id uuid,
  p_product_code text,
  p_description text,
  p_received_quantity numeric,
  p_unit text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.store_stock_receipts;
  v_new public.store_stock_receipts;
  v_old_product_code text;
  v_old_store_id bigint;
begin
  if not public.current_user_is_active() then
    raise exception 'Usuário inativo';
  end if;
  if not public.is_admin() then
    raise exception 'Acesso administrativo obrigatório';
  end if;

  select * into v_old
  from public.store_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Recibo não encontrado';
  end if;

  if v_old.voided_at is not null then
    raise exception 'Recibo já anulado';
  end if;

  v_old_product_code := v_old.product_code;
  v_old_store_id := v_old.store_id;

  update public.store_stock_receipts
  set
    product_code = upper(btrim(p_product_code)),
    description = btrim(p_description),
    received_quantity = p_received_quantity,
    unit = btrim(p_unit),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_receipt_id
  returning * into v_new;

  -- Recompute old balance key
  perform public.recompute_store_stock_balance(v_old_store_id, v_old_product_code);

  -- Recompute new balance key if product code or store changed
  if upper(btrim(v_old_product_code)) <> upper(btrim(v_new.product_code)) or v_old_store_id <> v_new.store_id then
    perform public.recompute_store_stock_balance(v_new.store_id, v_new.product_code);
  end if;

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'STOCK_RECEIPT_UPDATED', 'store_stock_receipts', v_new.id, row_to_json(v_old)::jsonb, row_to_json(v_new)::jsonb);

  return row_to_json(v_new)::jsonb;
end;
$$;

revoke execute on function public.admin_update_stock_receipt(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.admin_update_stock_receipt(uuid, text, text, numeric, text) to authenticated;

-- 4) Admin void stock receipt RPC
create or replace function public.admin_void_stock_receipt(
  p_receipt_id uuid,
  p_void_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.store_stock_receipts;
  v_new public.store_stock_receipts;
begin
  if not public.current_user_is_active() then
    raise exception 'Usuário inativo';
  end if;
  if not public.is_admin() then
    raise exception 'Acesso administrativo obrigatório';
  end if;

  select * into v_old
  from public.store_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Recibo não encontrado';
  end if;

  if v_old.voided_at is not null then
    return row_to_json(v_old)::jsonb;
  end if;

  if coalesce(pg_catalog.btrim(p_void_reason), '') = '' then
    raise exception 'Motivo da anulação é obrigatório';
  end if;

  update public.store_stock_receipts
  set
    voided_at = now(),
    voided_by = auth.uid(),
    void_reason = btrim(p_void_reason),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_receipt_id
  returning * into v_new;

  -- Recompute balance for this store+SKU
  perform public.recompute_store_stock_balance(v_new.store_id, v_new.product_code);

  insert into public.audit_logs (user_id, action, entity, entity_id, previous_data, new_data)
  values (auth.uid(), 'STOCK_RECEIPT_VOIDED', 'store_stock_receipts', v_new.id, row_to_json(v_old)::jsonb, row_to_json(v_new)::jsonb);

  return row_to_json(v_new)::jsonb;
end;
$$;

revoke execute on function public.admin_void_stock_receipt(uuid, text) from public, anon;
grant execute on function public.admin_void_stock_receipt(uuid, text) to authenticated;

-- 5) Update verification grants list
-- verify_ function_execution_grants now includes the 3 new RPCs
