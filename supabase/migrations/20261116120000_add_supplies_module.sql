-- Módulo Suprimentos (materiais de consumo das lojas)
--
-- Reaproveita o login, os perfis (profiles), as lojas (lojas) e os vínculos
-- usuário-loja (user_stores) que o VM já tem. Nada é duplicado.
--
-- 1) lojas.usa_vm: lojas que NÃO usam o VM (Levi's, Hering, Venda Direta)
--    ficam com usa_vm = false. Usuários ligados só a essas lojas veem apenas
--    o módulo Suprimentos.
-- 2) sup_itens: lista de itens de cada loja (estoque ideal, custo, fornecedor).
-- 3) sup_contagens: última contagem de estoque físico de cada loja.
-- 4) sup_solicitacoes: solicitações de compra enviadas pela loja à Sfera.

-- ───────────────────────── 1) lojas ─────────────────────────
alter table public.lojas
  add column if not exists usa_vm boolean not null default true,
  add column if not exists centro_custo text;

comment on column public.lojas.usa_vm is
  'Quando false, usuários desta loja não acessam as telas do VM, apenas o módulo Suprimentos.';

create or replace function public.current_user_uses_vm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_is_active()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_stores us
        join public.lojas l on l.id = us.store_id
        where us.user_id = auth.uid()
          and l.ativo = true
          and l.usa_vm = true
      )
    );
$$;

revoke execute on function public.current_user_uses_vm() from public, anon;
grant execute on function public.current_user_uses_vm() to authenticated;

-- ───────────────────────── 2) sup_itens ─────────────────────────
create table if not exists public.sup_itens (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null references public.lojas(id) on delete cascade,
  nome text not null check (btrim(nome) <> ''),
  categoria text not null default 'Geral',
  unidade text not null default 'UN',
  estoque_ideal numeric(12,2) not null default 0 check (estoque_ideal >= 0),
  custo_unitario numeric(12,2) check (custo_unitario is null or custo_unitario >= 0),
  fornecedor text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists idx_sup_itens_store_nome
  on public.sup_itens (store_id, lower(btrim(nome)));
create index if not exists idx_sup_itens_store on public.sup_itens (store_id);

-- ───────────────────────── 3) sup_contagens ─────────────────────────
create table if not exists public.sup_contagens (
  store_id bigint primary key references public.lojas(id) on delete cascade,
  valores jsonb not null default '{}'::jsonb check (jsonb_typeof(valores) = 'object'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.profiles(id) on delete set null
);

-- ───────────────────────── 4) sup_solicitacoes ─────────────────────────
create sequence if not exists public.sup_solicitacoes_numero_seq;

create table if not exists public.sup_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null references public.lojas(id) on delete cascade,
  numero text not null unique,
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  total numeric(12,2) not null default 0,
  observacao text,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'entregue', 'recusada')),
  resposta text,
  respondido_em timestamptz,
  respondido_por uuid references public.profiles(id) on delete set null,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_sup_solicitacoes_store on public.sup_solicitacoes (store_id, criado_em desc);
create index if not exists idx_sup_solicitacoes_status on public.sup_solicitacoes (status, criado_em desc);

-- ───────────────────────── triggers ─────────────────────────
create or replace function public.sup_itens_carimbo()
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

create or replace function public.sup_contagens_carimbo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

-- A loja só cria solicitações pendentes, com número gerado pelo banco,
-- e não altera depois de enviar. A Sfera (ADMIN) responde.
create or replace function public.sup_solicitacoes_protege()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.numero := 'SUP-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.sup_solicitacoes_numero_seq')::text, 5, '0');
    new.criado_por := auth.uid();
    new.criado_em := now();
    if not public.is_admin() then
      new.status := 'pendente';
      new.resposta := null;
      new.respondido_em := null;
      new.respondido_por := null;
    end if;
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'Somente a Sfera pode alterar uma solicitação enviada.'
      using errcode = '42501';
  end if;

  new.numero := old.numero;
  new.store_id := old.store_id;
  new.criado_por := old.criado_por;
  new.criado_em := old.criado_em;
  if new.status is distinct from old.status or new.resposta is distinct from old.resposta then
    new.respondido_em := now();
    new.respondido_por := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.sup_itens_carimbo() from public, anon, authenticated;
revoke execute on function public.sup_contagens_carimbo() from public, anon, authenticated;
revoke execute on function public.sup_solicitacoes_protege() from public, anon, authenticated;

drop trigger if exists trg_sup_itens_carimbo on public.sup_itens;
create trigger trg_sup_itens_carimbo
  before insert or update on public.sup_itens
  for each row execute function public.sup_itens_carimbo();

drop trigger if exists trg_sup_contagens_carimbo on public.sup_contagens;
create trigger trg_sup_contagens_carimbo
  before insert or update on public.sup_contagens
  for each row execute function public.sup_contagens_carimbo();

drop trigger if exists trg_sup_solicitacoes_protege on public.sup_solicitacoes;
create trigger trg_sup_solicitacoes_protege
  before insert or update on public.sup_solicitacoes
  for each row execute function public.sup_solicitacoes_protege();

-- ───────────────────────── RLS ─────────────────────────
alter table public.sup_itens enable row level security;
alter table public.sup_contagens enable row level security;
alter table public.sup_solicitacoes enable row level security;

-- sup_itens: loja lê os itens das suas lojas; só a Sfera cadastra/altera.
drop policy if exists sup_itens_select on public.sup_itens;
create policy sup_itens_select on public.sup_itens
  for select to authenticated
  using (public.user_can_access_store(store_id));

drop policy if exists sup_itens_admin_insert on public.sup_itens;
create policy sup_itens_admin_insert on public.sup_itens
  for insert to authenticated
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_itens_admin_update on public.sup_itens;
create policy sup_itens_admin_update on public.sup_itens
  for update to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_itens_admin_delete on public.sup_itens;
create policy sup_itens_admin_delete on public.sup_itens
  for delete to authenticated
  using (public.is_admin() and public.current_user_is_active());

-- sup_contagens: a loja lê e grava a contagem das suas lojas.
drop policy if exists sup_contagens_select on public.sup_contagens;
create policy sup_contagens_select on public.sup_contagens
  for select to authenticated
  using (public.user_can_access_store(store_id));

drop policy if exists sup_contagens_insert on public.sup_contagens;
create policy sup_contagens_insert on public.sup_contagens
  for insert to authenticated
  with check (public.user_can_access_store(store_id));

drop policy if exists sup_contagens_update on public.sup_contagens;
create policy sup_contagens_update on public.sup_contagens
  for update to authenticated
  using (public.user_can_access_store(store_id))
  with check (public.user_can_access_store(store_id));

-- sup_solicitacoes: a loja vê e envia as das suas lojas; só a Sfera responde ou exclui.
drop policy if exists sup_solicitacoes_select on public.sup_solicitacoes;
create policy sup_solicitacoes_select on public.sup_solicitacoes
  for select to authenticated
  using (public.user_can_access_store(store_id));

drop policy if exists sup_solicitacoes_insert on public.sup_solicitacoes;
create policy sup_solicitacoes_insert on public.sup_solicitacoes
  for insert to authenticated
  with check (public.user_can_access_store(store_id));

drop policy if exists sup_solicitacoes_admin_update on public.sup_solicitacoes;
create policy sup_solicitacoes_admin_update on public.sup_solicitacoes
  for update to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists sup_solicitacoes_admin_delete on public.sup_solicitacoes;
create policy sup_solicitacoes_admin_delete on public.sup_solicitacoes
  for delete to authenticated
  using (public.is_admin() and public.current_user_is_active());

-- ───────────────────────── grants ─────────────────────────
revoke all on public.sup_itens, public.sup_contagens, public.sup_solicitacoes from anon;
grant select, insert, update, delete on public.sup_itens to authenticated;
grant select, insert, update on public.sup_contagens to authenticated;
grant select, insert, update, delete on public.sup_solicitacoes to authenticated;
grant usage on sequence public.sup_solicitacoes_numero_seq to authenticated;
