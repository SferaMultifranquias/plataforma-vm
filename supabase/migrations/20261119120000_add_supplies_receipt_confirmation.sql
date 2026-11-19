-- Suprimentos: a loja confirma o recebimento de uma solicitação entregue
--
-- A Sfera marca a solicitação como "entregue"; a loja confirma que recebeu
-- (com observação opcional, por exemplo divergências). O status continua
-- "entregue": a confirmação é registrada em recebido_em / recebido_por.
--
-- A loja não altera a solicitação (trigger sup_solicitacoes_protege). A
-- confirmação passa pela função sup_confirmar_recebimento, que valida o acesso
-- à loja e libera apenas os campos de recebimento.

alter table public.sup_solicitacoes
  add column if not exists recebido_em timestamptz,
  add column if not exists recebido_por uuid references public.profiles(id) on delete set null,
  add column if not exists recebimento_obs text;

create index if not exists idx_sup_solicitacoes_recebimento
  on public.sup_solicitacoes (store_id) where status = 'entregue' and recebido_em is null;

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
    new.recebido_em := null;
    new.recebido_por := null;
    new.recebimento_obs := null;
    if not public.is_admin() then
      new.status := 'pendente';
      new.resposta := null;
      new.respondido_em := null;
      new.respondido_por := null;
    end if;
    return new;
  end if;

  if not public.is_admin() then
    -- Único caminho da loja: a função sup_confirmar_recebimento, que sinaliza a transação.
    if coalesce(current_setting('app.sup_recebimento', true), '') = '1' then
      new.numero := old.numero;
      new.store_id := old.store_id;
      new.itens := old.itens;
      new.total := old.total;
      new.observacao := old.observacao;
      new.status := old.status;
      new.resposta := old.resposta;
      new.respondido_em := old.respondido_em;
      new.respondido_por := old.respondido_por;
      new.criado_por := old.criado_por;
      new.criado_em := old.criado_em;
      return new;
    end if;
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

create or replace function public.sup_confirmar_recebimento(p_id uuid, p_obs text default null)
returns public.sup_solicitacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sup_solicitacoes;
begin
  if not public.current_user_is_active() then
    raise exception 'Usuário inativo.' using errcode = '42501';
  end if;

  select * into v from public.sup_solicitacoes where id = p_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.' using errcode = 'P0002';
  end if;
  if not public.user_can_access_store(v.store_id) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;
  if v.status <> 'entregue' then
    raise exception 'Só é possível confirmar o recebimento de uma solicitação entregue.' using errcode = '22023';
  end if;
  if v.recebido_em is not null then
    return v; -- já confirmada: repetir não muda nada
  end if;

  perform set_config('app.sup_recebimento', '1', true);
  update public.sup_solicitacoes
  set recebido_em = now(),
      recebido_por = auth.uid(),
      recebimento_obs = nullif(left(btrim(coalesce(p_obs, '')), 500), '')
  where id = p_id
  returning * into v;
  return v;
end;
$$;

revoke execute on function public.sup_confirmar_recebimento(uuid, text) from public, anon;
grant execute on function public.sup_confirmar_recebimento(uuid, text) to authenticated;
revoke execute on function public.sup_solicitacoes_protege() from public, anon, authenticated;
