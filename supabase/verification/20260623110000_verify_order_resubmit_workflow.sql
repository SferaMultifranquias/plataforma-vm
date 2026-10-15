-- Read-only validation for CHANGES_REQUESTED resubmit workflow.

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'order_editable_by_current_user',
    'resubmit_changed_order'
  )
order by p.proname;

select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'orders'
  and policyname = 'orders_requester_edit_draft';

select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'order_images'
  and policyname in (
    'order_images_requester_edit_draft',
    'order_images_select_visible_scope'
  )
order by policyname;

select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'order_images_storage_insert',
    'order_images_storage_delete'
  )
order by policyname;

select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'order-images';

with orphan_storage_objects as (
  select so.name
  from storage.objects so
  where so.bucket_id = 'order-images'
    and not exists (
      select 1
      from public.order_images oi
      where oi.storage_path = so.name
    )
)
select count(*) as orphan_storage_objects
from orphan_storage_objects;
