-- Broaden admin detection without reintroducing profiles RLS recursion.
-- auth.users is the source of truth for the persisted auth metadata and
-- lets admin checks work even when the access token is stale or missing the claim.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    upper(auth.jwt() -> 'app_metadata' ->> 'role'),
    upper(auth.jwt() -> 'user_metadata' ->> 'role'),
    upper((
      select u.raw_app_meta_data ->> 'role'
      from auth.users u
      where u.id = auth.uid()
      limit 1
    )),
    upper((
      select u.raw_user_meta_data ->> 'role'
      from auth.users u
      where u.id = auth.uid()
      limit 1
    )),
    ''
  ) = 'ADMIN';
$$;
