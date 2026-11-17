-- Suprimentos: cadastro de fornecedores e itens por fornecedor
--
-- 1) sup_fornecedores: cadastro central de fornecedores (só a Sfera/ADMIN acessa).
-- 2) sup_itens.fornecedor_id: liga cada item a um fornecedor cadastrado.
--    O texto sup_itens.fornecedor continua existindo (PDF e solicitações já usam)
--    e é mantido em sincronia por trigger: segue o nome do fornecedor ligado.
-- 3) Carga inicial: cada nome de fornecedor já digitado nos itens vira um
--    fornecedor cadastrado e os itens são ligados a ele.

-- ───────────────────────── 1) sup_fornecedores ─────────────────────────
create table if not exists public.sup_fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (btrim(nome) <> ''),
  cnpj text,
  contato text,
  telefone text,
  email text,
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists idx_sup_fornecedores_nome
  on public.sup_fornecedores (lower(btrim(nome)));

-- ───────────────────────── 2) sup_itens.fornecedor_id ─────────────────────────
alter table public.sup_itens
  add column if not exists fornecedor_id uuid references public.sup_fornecedores(id) on delete set null;

create index if not exists idx_sup_itens_fornecedor on public.sup_itens (fornecedor_id);

-- ───────────────────────── triggers ─────────────────────────
create or replace function public.sup_fornecedores_carimbo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Item ligado a fornecedor: o texto acompanha o nome do cadastro.
-- Item só com texto (ex.: lista colada do Excel): liga ao fornecedor de mesmo nome, se existir.
create or replace function public.sup_itens_fornecedor_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text;
begin
  if new.fornecedor_id is not null then
    select f.nome into v_nome from public.sup_fornecedores f where f.id = new.fornecedor_id;
    new.fornecedor := v_nome;
    return new;
  end if;

  -- Desligado do fornecedor (fornecedor_id virou nulo e o texto antigo ficou): limpa o texto.
  if tg_op = 'UPDATE' and old.fornecedor_id is not null
     and new.fornecedor is not distinct from old.fornecedor then
    new.fornecedor := null;
    return new;
  end if;

  if nullif(btrim(coalesce(new.fornecedor, '')), '') is null then
    new.fornecedor := null;
    return new;
  end if;

  select f.id, f.nome into v_id, v_nome
  from public.sup_fornecedores f
  where lower(btrim(f.nome)) = lower(btrim(new.fornecedor))
  limit 1;

  if v_id is not null then
    new.fornecedor_id := v_id;
    new.fornecedor := v_nome;
  end if;
  return new;
end;
$$;

-- Renomear o fornecedor atualiza o texto nos itens ligados a ele.
create or replace function public.sup_fornecedores_propaga_nome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sup_itens set fornecedor = new.nome where fornecedor_id = new.id;
  return null;
end;
$$;

revoke execute on function public.sup_fornecedores_carimbo() from public, anon, authenticated;
revoke execute on function public.sup_itens_fornecedor_sync() from public, anon, authenticated;
revoke execute on function public.sup_fornecedores_propaga_nome() from public, anon, authenticated;

drop trigger if exists trg_sup_fornecedores_carimbo on public.sup_fornecedores;
create trigger trg_sup_fornecedores_carimbo
  before insert or update on public.sup_fornecedores
  for each row execute function public.sup_fornecedores_carimbo();

drop trigger if exists trg_sup_itens_fornecedor_sync on public.sup_itens;
create trigger trg_sup_itens_fornecedor_sync
  before insert or update on public.sup_itens
  for each row execute function public.sup_itens_fornecedor_sync();

drop trigger if exists trg_sup_fornecedores_propaga_nome on public.sup_fornecedores;
create trigger trg_sup_fornecedores_propaga_nome
  after update of nome on public.sup_fornecedores
  for each row
  when (old.nome is distinct from new.nome)
  execute function public.sup_fornecedores_propaga_nome();

-- ───────────────────────── carga inicial ─────────────────────────
insert into public.sup_fornecedores (nome)
select distinct on (lower(btrim(i.fornecedor))) btrim(i.fornecedor)
from public.sup_itens i
where nullif(btrim(coalesce(i.fornecedor, '')), '') is not null
order by lower(btrim(i.fornecedor)), btrim(i.fornecedor)
on conflict do nothing;

update public.sup_itens i
set fornecedor_id = f.id
from public.sup_fornecedores f
where i.fornecedor_id is null
  and nullif(btrim(coalesce(i.fornecedor, '')), '') is not null
  and lower(btrim(i.fornecedor)) = lower(btrim(f.nome));

-- ───────────────────────── RLS ─────────────────────────
alter table public.sup_fornecedores enable row level security;

drop policy if exists sup_fornecedores_admin_select on public.sup_fornecedores;
create policy sup_fornecedores_admin_select on public.sup_fornecedores
  for select to authenticated
  using (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_fornecedores_admin_insert on public.sup_fornecedores;
create policy sup_fornecedores_admin_insert on public.sup_fornecedores
  for insert to authenticated
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_fornecedores_admin_update on public.sup_fornecedores;
create policy sup_fornecedores_admin_update on public.sup_fornecedores
  for update to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_fornecedores_admin_delete on public.sup_fornecedores;
create policy sup_fornecedores_admin_delete on public.sup_fornecedores
  for delete to authenticated
  using (public.is_admin() and public.current_user_is_active());

-- ───────────────────────── grants ─────────────────────────
revoke all on public.sup_fornecedores from anon;
grant select, insert, update, delete on public.sup_fornecedores to authenticated;
