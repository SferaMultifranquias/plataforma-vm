-- Restore admin detection to JWT claims only.
-- Querying auth.users from an exposed helper can trigger permission errors for authenticated users.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(upper(auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'ADMIN';
$$;
