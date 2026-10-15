-- Fix recursive RLS evaluation caused by public.is_admin() reading public.profiles.
-- The previous implementation queried public.profiles, but several public.profiles
-- policies also call public.is_admin(), which can recurse into stack depth errors.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'ADMIN';
$$;

-- Keep profile updates aligned with app metadata to avoid self-referential reads.
drop policy if exists "profiles_update_self_limited" on public.profiles;
create policy "profiles_update_self_limited"
on public.profiles
for update
using (id = auth.uid() or public.is_admin())
with check (
  public.is_admin()
  or (
    id = auth.uid()
    and role = coalesce(auth.jwt() -> 'app_metadata' ->> 'role', role)
    and is_active = coalesce((auth.jwt() -> 'app_metadata' ->> 'is_active')::boolean, is_active)
  )
);
