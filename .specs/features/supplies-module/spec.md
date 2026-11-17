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
- Dashboard de acompanhamento: tela própria `/dashboard-suprimentos` (partial `public/pages/dashboard-suprimentos.html`, menu "Dashboard Suprimentos"), separada do Dashboard do VM e das abas de `/suprimentos`, para admin e lojas, no mesmo padrão visual do Dashboard do VM. Clicar numa solicitação da tabela leva à tela de Suprimentos. Módulo `public/js/pages/supplies/supplies-dashboard.js` (filtros, KPIs, gráficos e tabela; regras puras testadas). Filtros: período, lojas e status. Admin vê todas as lojas; usuário de loja vê só as suas (RLS). Só lê `sup_solicitacoes`, sem migration nova.- Permissão: `AppUtils.buildPermissions(role, resources, { usaVm })`; recurso `suprimentos` (todos) e `suprimentos-admin` (ADMIN).
- PDF: jsPDF + autotable carregados sob demanda do jsDelivr com SRI.
- Cadastro de lojas: marcas Levi's e Hering, campo "Usuários desta loja acessam" (`usa_vm`) e centro de custo.

## Testes
`tests/frontend/supplies.test.js` (permissões, cálculo de compra, agrupamento do catálogo, separação por fornecedor, colagem do Excel, rota/partial, RLS na migration).

## Carga inicial
Feita fora do repositório (contém senhas iniciais): conferir os códigos das lojas no banco do VM antes de aplicar.
