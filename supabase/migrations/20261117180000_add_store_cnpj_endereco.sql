-- Lojas: CNPJ, endereço e CEP
--
-- Colunas opcionais (nulas) usadas na lista de lojas de Suprimentos.
-- A carga dos valores é feita fora do repositório, a partir da planilha
-- "Informações das Lojas" (aba MATRIZ).

alter table public.lojas
  add column if not exists cnpj text,
  add column if not exists endereco text,
  add column if not exists cep text;

comment on column public.lojas.cnpj is 'CNPJ da loja (formato 00.000.000/0000-00).';
comment on column public.lojas.endereco is 'Endereço completo da loja: logradouro, número, complemento - cidade/UF.';
comment on column public.lojas.cep is 'CEP da loja (formato 00000-000).';
