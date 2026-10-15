-- Fix generate_order_internal_number to avoid collisions.
-- Old: select count(*) + 1 (breaks with deletes + concurrency)
-- New: max suffix for today + 1, with advisory xact lock

create or replace function public.generate_order_internal_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  today_prefix text;
  max_suffix bigint;
  next_number bigint;
  lock_key bigint;
begin
  today_prefix := 'ORD-' || to_char(current_date, 'YYYYMMDD') || '-';
  lock_key := hashtext('gen_order_internal_' || today_prefix);

  perform pg_advisory_xact_lock(lock_key);

  select max(nullif(regexp_replace(internal_number, '^' || today_prefix, ''), '')::bigint)
    into max_suffix
  from public.orders
  where internal_number like today_prefix || '%';

  next_number := coalesce(max_suffix, 0) + 1;
  return today_prefix || lpad(next_number::text, 4, '0');
end;
$$;
