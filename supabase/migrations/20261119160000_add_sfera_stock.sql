-- Estoque Sfera (almoxarifado da Sfera / Suprimentos)
--
-- Traz para o VM o "Controle de Estoque" da Sfera: itens, entradas de nota,
-- saídas de mercadoria, pedidos de compra e cadastros/parâmetros.
-- Acesso: somente ADMIN ativo. Lojas não veem nada destas tabelas.
-- Os ids são texto para preservar os ids do sistema anterior na migração.

create table if not exists public.alm_itens (
  id text primary key default gen_random_uuid()::text,
  nome text not null check (btrim(nome) <> ''),
  categoria text not null default 'Outros',
  und text not null default 'UN',
  custo numeric(14,4) check (custo is null or custo >= 0),
  min_manual numeric(14,3) check (min_manual is null or min_manual >= 0),
  fornecedor text,
  ativo boolean not null default true,
  vinculos jsonb not null default '{}'::jsonb check (jsonb_typeof(vinculos) = 'object'),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists idx_alm_itens_nome on public.alm_itens (lower(btrim(nome)));

create table if not exists public.alm_entradas (
  id text primary key default gen_random_uuid()::text,
  tipo text not null check (tipo in ('compra', 'devolucao', 'ajuste', 'inicial')),
  data date not null,
  nf text not null default '',
  serie text not null default '',
  fornecedor text not null default '',
  cnpj text not null default '',
  chave text not null default '',
  emissao date,
  obs text not null default '',
  origem text not null default 'manual',
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  valor_total numeric(14,2) not null default 0,
  pedido_id text,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_alm_entradas_data on public.alm_entradas (data desc);
-- A mesma NF-e (chave de acesso) não entra duas vezes.
create unique index if not exists idx_alm_entradas_chave on public.alm_entradas (chave) where chave <> '';

create table if not exists public.alm_saidas (
  id text primary key default gen_random_uuid()::text,
  tipo text not null check (tipo in ('requisicao', 'emprestimo', 'perda', 'ajuste')),
  data date not null,
  responsavel text not null default '',
  destino text not null default '',
  obs text not null default '',
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_alm_saidas_data on public.alm_saidas (data desc);

create table if not exists public.alm_pedidos (
  id text primary key default gen_random_uuid()::text,
  numero text not null unique,
  data date not null,
  fornecedor text not null default '',
  status text not null default 'aberto' check (status in ('aberto', 'enviado', 'recebido', 'cancelado')),
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  total numeric(14,2) not null default 0,
  recebido_em date,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now()
);

create table if not exists public.alm_config (
  id text primary key default 'geral' check (id = 'geral'),
  destinos text[] not null default '{}',
  solicitantes text[] not null default '{}',
  fornecedores text[] not null default '{}',
  categorias text[] not null default '{}',
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  atualizado_em timestamptz not null default now()
);
insert into public.alm_config (id) values ('geral') on conflict (id) do nothing;

-- Carimbos: quem lançou (o banco decide, não o navegador) e data de atualização.
create or replace function public.alm_carimbo_criacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Pelo sistema (usuário logado) o banco carimba quem e quando.
  -- Na carga dos dados antigos (SQL Editor, sem usuário) mantém a data original.
  if auth.uid() is not null then
    new.criado_por := auth.uid();
    new.criado_em := now();
  else
    new.criado_em := coalesce(new.criado_em, now());
  end if;
  return new;
end;
$$;

create or replace function public.alm_carimbo_atualizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

revoke execute on function public.alm_carimbo_criacao() from public, anon, authenticated;
revoke execute on function public.alm_carimbo_atualizacao() from public, anon, authenticated;

drop trigger if exists trg_alm_entradas_criacao on public.alm_entradas;
create trigger trg_alm_entradas_criacao before insert on public.alm_entradas
  for each row execute function public.alm_carimbo_criacao();
drop trigger if exists trg_alm_saidas_criacao on public.alm_saidas;
create trigger trg_alm_saidas_criacao before insert on public.alm_saidas
  for each row execute function public.alm_carimbo_criacao();
drop trigger if exists trg_alm_pedidos_criacao on public.alm_pedidos;
create trigger trg_alm_pedidos_criacao before insert on public.alm_pedidos
  for each row execute function public.alm_carimbo_criacao();
drop trigger if exists trg_alm_itens_atualizacao on public.alm_itens;
create trigger trg_alm_itens_atualizacao before update on public.alm_itens
  for each row execute function public.alm_carimbo_atualizacao();
drop trigger if exists trg_alm_config_atualizacao on public.alm_config;
create trigger trg_alm_config_atualizacao before update on public.alm_config
  for each row execute function public.alm_carimbo_atualizacao();

-- RLS: só administrador ativo lê e grava.
alter table public.alm_itens enable row level security;
alter table public.alm_entradas enable row level security;
alter table public.alm_saidas enable row level security;
alter table public.alm_pedidos enable row level security;
alter table public.alm_config enable row level security;

drop policy if exists alm_itens_admin on public.alm_itens;
create policy alm_itens_admin on public.alm_itens for all to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists alm_entradas_admin on public.alm_entradas;
create policy alm_entradas_admin on public.alm_entradas for all to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists alm_saidas_admin on public.alm_saidas;
create policy alm_saidas_admin on public.alm_saidas for all to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists alm_pedidos_admin on public.alm_pedidos;
create policy alm_pedidos_admin on public.alm_pedidos for all to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

drop policy if exists alm_config_admin on public.alm_config;
create policy alm_config_admin on public.alm_config for all to authenticated
  using (public.is_admin() and public.current_user_is_active())
  with check (public.is_admin() and public.current_user_is_active());

revoke all on public.alm_itens, public.alm_entradas, public.alm_saidas, public.alm_pedidos, public.alm_config from anon;
grant select, insert, update, delete on public.alm_itens, public.alm_entradas, public.alm_saidas, public.alm_pedidos to authenticated;
grant select, insert, update on public.alm_config to authenticated;
