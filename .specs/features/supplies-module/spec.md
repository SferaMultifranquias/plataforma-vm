# Módulo Suprimentos (materiais de consumo)

## Objetivo
Trazer para dentro do VM o controle de materiais de consumo das lojas (limpeza, escritório, higiene, copa), reaproveitando login, perfis, lojas e vínculos usuário-loja já existentes.

## Regras
- Lojas com `lojas.usa_vm = false` (Levi's, Hering, Venda Direta) acessam **somente** `/suprimentos`. Qualquer outra rota redireciona para `/suprimentos`.
- Usuário de loja: conta o estoque físico (salvo automaticamente em `sup_contagens`), vê a compra necessária (estoque ideal − físico) e envia a solicitação (`sup_solicitacoes`). Não vê o estoque ideal.
- Sfera (ADMIN): responde solicitações (pendente/aprovada/entregue/recusada), gera PDF do pedido por fornecedor, mantém o cadastro central de itens (`sup_itens`) e a lista de cada loja.
- Número da solicitação gerado no banco: `SUP-AAAA-NNNNN`. A loja não altera a solicitação depois de enviar (trigger `sup_solicitacoes_protege`).

## Banco
Migration `supabase/migrations/20261116120000_add_supplies_module.sql`:
- `lojas.usa_vm`, `lojas.centro_custo`, função `current_user_uses_vm()`.
- `sup_itens`, `sup_contagens`, `sup_solicitacoes` com RLS baseada em `user_can_access_store()` e `is_admin()`.

## Frontend
- Rota `/suprimentos` (`public/pages/suprimentos.html`), módulos `public/js/pages/supplies/supplies-data.js` (regras puras + dados) e `supplies-module.js` (telas), estilos `public/styles/pages/supplies.css`.
- Dashboard de acompanhamento: tela própria `/dashboard-suprimentos` (partial `public/pages/dashboard-suprimentos.html`, menu "Dashboard Suprimentos"), separada do Dashboard do VM e das abas de `/suprimentos`, para admin e lojas, no mesmo padrão visual do Dashboard do VM. Clicar numa solicitação da tabela leva à tela de Suprimentos. Módulo `public/js/pages/supplies/supplies-dashboard.js` (filtros, KPIs, gráficos e tabela; regras puras testadas). Filtros: período, lojas e status. Admin vê todas as lojas; usuário de loja vê só as suas (RLS). Só lê `sup_solicitacoes`, sem migration nova.- Fornecedores (só admin): abas `fornecedores` (cadastro: nome, CNPJ/CPF, contato, telefone, e-mail, observação, ativo) e `itens-fornecedor` (escolhe o fornecedor, vê os itens dele, adiciona/remove). No cadastro do item, "Fornecedor" vira uma lista. Migration `20261117150000_add_supplies_suppliers.sql`: tabela `sup_fornecedores` (RLS só ADMIN), `sup_itens.fornecedor_id`, trigger que mantém o texto `sup_itens.fornecedor` igual ao nome do fornecedor ligado (PDF e solicitações continuam usando o texto) e carga dos nomes já digitados. Sem a migration aplicada, a tela segue como antes (campo de texto) e as abas avisam.
- Dados da loja: CNPJ, endereço, CEP, cidade e UF (`lojas.cnpj/endereco/cep`, migration `20261117180000`) aparecem na lista de lojas e em "Entregar em" do pedido ao fornecedor (PDF e Excel). Admin edita em Lojas > loja > "Dados da loja". O pedido também leva CNPJ e contato do fornecedor cadastrado.
- Confirmação de recebimento: a Sfera marca `entregue`; a loja confirma em "Meus pedidos" (observação opcional). Migration `20261119120000`: `recebido_em/recebido_por/recebimento_obs` e função `sup_confirmar_recebimento` (security definer, valida acesso à loja, idempotente). A loja continua sem poder alterar a solicitação (trigger libera só os campos de recebimento quando chamada pela função).
- Avisos dentro do sistema: selo com contador no menu (`supplies-notices.js`). Sfera: solicitações pendentes. Loja: entregas para confirmar + respostas novas desde a última visita (guardada no navegador). Faixa de aviso em "Meus pedidos". E-mail: NÃO implementado (não há envio de e-mail pronto no projeto; deixar para quando houver conta de envio).
- Dashboard Suprimentos: cartões de recebimento (aguardando/confirmados), prazo médio de entrega e valor médio; gráficos de custo por categoria e lojas que mais solicitam.
- Permissão: `AppUtils.buildPermissions(role, resources, { usaVm })`; recurso `suprimentos` (todos) e `suprimentos-admin` (ADMIN).
- PDF: jsPDF + autotable carregados sob demanda do jsDelivr com SRI.
- Cadastro de lojas: marcas Levi's e Hering, campo "Usuários desta loja acessam" (`usa_vm`) e centro de custo.

## Testes
`tests/frontend/supplies.test.js` (permissões, cálculo de compra, agrupamento do catálogo, separação por fornecedor, colagem do Excel, rota/partial, RLS na migration).

## Carga inicial
Feita fora do repositório (contém senhas iniciais): conferir os códigos das lojas no banco do VM antes de aplicar.
