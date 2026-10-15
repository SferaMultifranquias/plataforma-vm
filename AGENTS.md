# Sfera VM

## 1. Objetivo do projeto
Plataforma de pedidos da Sfera Multifranquias para usuários de loja e administradores. O sistema cobre autenticação, criação de pedidos, revisão/aprovação, administração de usuários e consulta de lojas.

## 1.1 Documentação de referência
- `AGENTS.md`: arquitetura técnica atual, restrições de desenvolvimento, instruções de agente e comportamento verificado.
- `CODEx_CONTEXT.md`: handoff operacional curto, estado atual do repositório e sem credenciais.
- `README.md`: instalação, configuração, comandos e uso do desenvolvedor.
- `.agents/qa-project-context.md`: contexto QA: stack, frameworks de teste, CI/CD, ambientes, áreas de risco.
- `.specs/features/*/`: specs de features (spec/design/tasks).
- `.specs/codebase/`: mapa do codebase, workflows, infra de testes.
- `docs/`: referência histórica apenas — migração de diretórios, decisões arquiteturais.

Fluxos principais confirmados no código atual:
- login e restauração de sessão;
- navegação por `History API` entre `/dashboard`, `/pedidos`, `/novo-pedido`, `/lojas`, `/usuarios` e `/login`;
- criação de pedido em rascunho, inclusão de itens e imagem, e envio para aprovação;
- revisão administrativa de pedidos;
- listagem e gestão administrativa de usuários;
- acesso a dados do Supabase com `RLS`, `RPCs` e `Storage` privados.

## 2. Stack tecnológica
- Node.js
- Express `^4.19.2` (local dev)
- Cloudflare Pages + Pages Functions (production deploy)
- Wrangler `^4.106.0` (via npx para preview)
- CORS `^2.8.5`
- dotenv `^16.4.5`
- HTML, CSS e JavaScript sem framework de frontend
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- `supabase-js` `^2.107.0` como dependência de desenvolvimento
- `nodemon` `^3.1.4` como dependência de desenvolvimento

## 3. Arquitetura
O projeto segue uma **estratégia de dois runtimes**: Express para desenvolvimento local (código inalterado) e Cloudflare Pages Functions para produção. O frontend HTML/CSS/JS é idêntico em ambos; as rotas `/api/*` têm implementações separadas com testes de contrato para evitar divergência. Service role nunca chega ao browser em nenhum runtime.

Componentes principais:
- `server.js`: entrypoint fino do servidor Express.
- `src/server/app.js`: monta o Express, expõe `/api/config`, `/api/health`, `/api/admin/users`, serve `public/` e faz o fallback das rotas de interface.
- `functions/`: implementação Pages Functions de `/api/*` para Cloudflare (ESM, Web Crypto, env injection).
- `public/index.html`: shell principal do frontend, carrega scripts globais e define a estrutura da interface.
- `public/_redirects`: regras de rewrite SPA para Cloudflare Pages (6 rotas shell -> `/index.html 200`).
- `public/_headers`: cabeçalhos de segurança baseline para Cloudflare Pages.
- `public/vendor/supabase/supabase.js`: bundle UMD do supabase-js v2.108.2 vendado (sem dependência CDN).
- `public/js/core/app-shell.js`: roteador da interface, controle de permissões, carregamento de partials e inicialização de páginas.
- `public/js/core/auth.js`: bootstrap de autenticação, login e restauração de sessão.
- `public/js/shared/app-utils.js`: utilitários compartilhados, incluindo normalização de papéis e permissões.
- `public/js/shared/order-rules.js`: regras puras de validação de pedidos.
- `public/js/pages/dashboard/dashboard-module.js`: dashboard.
- `public/js/pages/orders/orders-module.js` e `public/js/pages/orders/orders-data.js`: página e acesso a dados de pedidos.
- `public/js/pages/order-form/order-form-module.js`: formulário de novo pedido.
- `public/js/pages/stores/stores-module.js`: tela de lojas.
- `public/js/pages/users/users-module.js` e `public/js/pages/users/users-data.js`: tela e acesso a dados da administração de usuários.
- `src/server/routes/users-admin.js`, `src/server/routes/orders-admin.js` e `src/server/routes/inventory-admin.js`: rotas administrativas Express.
- `src/server/services/supabase-admin-service.js`: service role e lógica administrativa no servidor Express.
- `supabase/migrations/`: migrations incrementais do esquema.
- `supabase/verification/`: SQL de verificação somente leitura.
- `tests/frontend/`, `tests/server/` e `tests/e2e/`: testes automatizados.
- `scripts/admin/`, `scripts/maintenance/`, `scripts/smoke/`: scripts operacionais.

## 4. Estrutura de diretórios
```text
.
├─ public/
│  ├─ index.html
│  ├─ _redirects
│  ├─ _headers
│  ├─ js/
│  │  ├─ core/
│  │  ├─ legacy/
│  │  ├─ pages/
│  │  └─ shared/
│  ├── vendor/supabase/
│  ├─ pages/
│  └─ styles/
├─ functions/
│  ├─ _shared/
│  │  ├─ admin-core.js
│  │  ├─ admin-service.js
│  │  ├─ env.js
│  │  └─ http.js
│  ├─ api/
│  │  ├─ config.js
│  │  ├─ health.js
│  │  └─ admin/
│  │     ├─ users/
│  │     │  ├─ index.js
│  │     │  └─ [id].js
│  │     ├─ orders/
│  │     │  └─ [id].js
│  │     └─ inventory/
│  │        ├─ index.js
│  │        └─ [id].js
├─ src/
│  └─ server/
│     ├─ app.js
│     ├─ routes/
│     ├─ services/
│     ├─ config/
│     └─ middleware/
├─ scripts/
│  ├─ admin/
│  ├─ maintenance/
│  └─ smoke/
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/
│  └─ verification/
├─ tests/
│  ├─ frontend/
│  └─ server/
├─ server.js
├─ package.json
├─ wrangler.toml
├─ .dev.vars.example
├─ README.md
└─ .env.example
```

## 5. Módulos principais

- `public/js/core/app-shell.js`
  - Responsabilidade: roteamento, renderização de partials, permissões e estados de acesso.
  - Dependências: `DashboardModule`, `OrdersModule`, `UsersModule`, `FormModule`, `StoresModule`, `AppUtils`, `AuthModule`.
  - Consumido por: `index.html` e testes de roteamento.

- `public/js/core/auth.js`
  - Responsabilidade: login, bootstrap de sessão, montagem do estado autenticado.
  - Dependências: Supabase client, `AppShellModule`, `AppUtils`.
  - Consumido por: `index.html` e testes de autenticação.

- `public/js/pages/dashboard/dashboard-module.js`
  - Responsabilidade: render e inicialização do dashboard.
  - Dependências: utilitários do app e funções de pedidos.
  - Consumido por: `AppShellModule`.

- `public/js/pages/orders/orders-module.js`
  - Responsabilidade: lista, filtros, resumo, paginação, drawer e ações da página de pedidos.
  - Dependências: `orders-data.js`, `AppUtils`, Supabase client e dependências passadas pelo shell.
  - Consumido por: `AppShellModule`.

- `public/js/pages/orders/orders-data.js`
  - Responsabilidade: consultas, mutações e fluxo de submissão de pedidos.
  - Dependências: Supabase client, `order-rules`, `AppUtils`, `AuthModule` e dependências do shell.
  - Consumido por: `OrdersModule` e `FormModule`.

- `public/js/pages/order-form/order-form-module.js`
  - Responsabilidade: formulário de novo pedido, validação local, preparo de payload e submissão.
  - Dependências: `orders-data.js`, `order-rules`, `AppUtils`, Supabase client e dependências do shell.
  - Consumido por: `AppShellModule`.

- `public/js/pages/account/account-module.js`
  - Responsabilidade: modal global de Minha Conta (email/senha). Sem rota — aberto via `#account-open-btn` na sidebar. Lê globais (`getCurrentUser`, `sb`, `showToast`) diretamente, sem deps do shell.
  - Dependências: Supabase client, `AppUtils` (via globais).
  - Consumido por: `index.html` (auto-bind no DOMContentLoaded).

- `public/js/pages/stores/stores-module.js`
  - Responsabilidade: listagem e manutenção de lojas na interface.
  - Dependências: Supabase client e utilitários do app.
  - Consumido por: `AppShellModule`.

- `public/js/pages/users/users-module.js`
  - Responsabilidade: interface de administração de usuários.
  - Dependências: `users-data.js`, Supabase client e utilitários do app.
  - Consumido por: `AppShellModule`.

- `public/js/pages/users/users-data.js`
  - Responsabilidade: acesso à API `/api/admin/users`.
  - Dependências: `fetch`, token do usuário atual e endpoint administrativo.
  - Consumido por: `UsersModule`.

- `public/js/shared/app-utils.js`
  - Responsabilidade: permissões, papéis, badges, helpers de UI e normalização.
  - Dependências: nenhuma dependência pesada; é carregado cedo no `index.html`.
  - Consumido por: shell, auth, pedidos, usuários e testes.

- `public/js/shared/order-rules.js`
  - Responsabilidade: regras puras do pedido.
  - Dependências: nenhuma dependência do browser além das funções puras.
  - Consumido por: formulário e testes.

- `src/server/routes/users-admin.js`
  - Responsabilidade: rota protegida `/api/admin/users`.
  - Dependências: `src/server/services/supabase-admin-service.js`.
  - Consumido por: `src/server/app.js`.

- `src/server/routes/inventory-admin.js`
  - Responsabilidade: rotas `/api/admin/inventory` (GET, POST, PATCH, POST adjust).
  - Dependências: `src/server/services/supabase-admin-service.js`.
  - Consumido por: `src/server/app.js`.

- `functions/api/admin/inventory/index.js` e `[id].js`
  - Responsabilidade: Pages Functions para inventory API parity.
  - Dependências: `functions/_shared/admin-service.js`, `http.js`, `env.js`.
  - Consumido por: Cloudflare Pages runtime.

- `src/server/services/supabase-admin-service.js`
  - Responsabilidade: validação do admin, criação/edição/exclusão de usuários, consultas administrativas e uso de `service role`.
  - Dependências: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `fetch`.
  - Consumido por: rota administrativa e testes.

- `functions/_shared/admin-core.js`
  - Responsabilidade: funções puras portáteis (normalizadores, DTOs, validadores, `computeSummary`, `buildMergedUsers`). Zero dependências Node/fetch.
  - Dependências: nenhuma.
  - Consumido por: `functions/_shared/admin-service.js` e testes de contrato.

- `functions/_shared/admin-service.js`
  - Responsabilidade: factory portátil `createPagesAdminService({ env, fetch })` para Cloudflare Pages. Usa Web Crypto, fetch, URL — sem node:crypto, sem filesystem, sem Express.
  - Dependências: `admin-core.js`, `env.js`.
  - Consumido por: `functions/api/admin/users/*.js`.

- `functions/_shared/env.js`
  - Responsabilidade: helpers `getEnvValue`, `requireEnv` para extrair vars de `context.env`.
  - Dependências: nenhuma.
  - Consumido por: `functions/api/*.js`.

- `functions/_shared/http.js`
  - Responsabilidade: `jsonResponse`, `errorResponse`, `methodNotAllowed`, `readBodyJson`, `extractBearerToken` — todos baseados em `Response`.
  - Dependências: nenhuma.
  - Consumido por: `functions/api/*.js`.

## 6. Rotas

### Rotas de interface

- `/login`
  - partial: `/pages/login.html`
  - inicializador: `AuthModule.afterRenderLogin`
  - acesso: público

- `/dashboard`
  - partial: render do módulo de dashboard
  - inicializador: `DashboardModule.afterRenderDashboard`
  - acesso: autenticado

- `/pedidos`
  - partial: `/pages/pedidos.html`
  - inicializador: `OrdersModule.afterRenderPedidos`
  - acesso: autenticado com permissão por papel/recursos

- `/novo-pedido`
  - partial: `/pages/novo-pedido.html`
  - inicializador: `FormModule.afterRenderFormulario`
  - acesso: autenticado com permissão por papel/recursos

- `/lojas`
  - partial: `/pages/lojas.html`
  - inicializador: `StoresModule.afterRenderLojasCadastro`
  - acesso: autenticado com permissão por papel/recursos

- `/usuarios`
  - partial: `/pages/usuarios.html`
  - inicializador: `UsersModule.afterRenderUsuarios`
  - acesso: ADMIN-only

### Minha Conta (modal global, não rota)

Acessado via botão `#account-open-btn` na sidebar, sem navegação. Modal global em `public/index.html` com classes `users-modal` + custom `account-*`. Gerenciado por `account-module.js`, que lê globais diretamente. Fechamento via X, backdrop, Escape ou botão "Fechar" no footer.

### Rotas de API

- `GET /api/config`
  - autorização: pública
  - responsabilidade: expor URL e chave pública do Supabase para o frontend

- `GET /api/health`
  - autorização: pública
  - responsabilidade: healthcheck do servidor

- `GET /api/admin/users`
  - autorização: token de admin ativo
  - responsabilidade: listagem administrativa de usuários

- `POST /api/admin/users`
  - autorização: token de admin ativo
  - responsabilidade: criação administrativa de usuários

- `PATCH /api/admin/users/:id`
  - autorização: token de admin ativo
  - responsabilidade: edição administrativa de usuários

- `DELETE /api/admin/users/:id`
  - autorização: token de admin ativo
  - responsabilidade: exclusão administrativa de usuários

- `DELETE /api/admin/orders/:id`
  - autorização: token de admin ativo + reautenticação de senha
  - responsabilidade: exclusão de pedido com limpeza de storage

- `GET /api/admin/inventory`
  - autorização: token de admin ativo
  - responsabilidade: listagem de itens de inventário

- `POST /api/admin/inventory`
  - autorização: token de admin ativo
  - responsabilidade: criação de item de inventário

- `PATCH /api/admin/inventory/:id`
  - autorização: token de admin ativo
  - responsabilidade: edição de metadados de inventário

- `POST /api/admin/inventory/:id/adjust`
  - autorização: token de admin ativo
  - responsabilidade: ajuste de quantidade com motivo

## 7. Autenticação e autorização
O frontend restaura a sessão do Supabase e mantém um único cliente Supabase em runtime. O papel persistido no banco é `USER` ou `ADMIN`; o frontend normaliza isso para `loja` e `admin` para exibição e permissões.

Regras confirmadas:
- `is_active=false` bloqueia o acesso do usuário.
- `ADMIN` acessa as rotas e APIs administrativas.
- `service_role` fica somente no servidor (Express: `process.env`; Pages Functions: `context.env`).
- O browser não deve receber `SUPABASE_SERVICE_ROLE_KEY`.
- A autorização de pedidos depende do perfil e das lojas vinculadas ao usuário no banco.
- O browser não deve ser a fonte de verdade de autorização.

## 8. Fluxo de pedidos
Fluxo confirmado no código atual:
- o formulário coleta loja, tipo de produto, itens, motivo, foto e campos auxiliares;
- a foto do produto é obrigatória antes do envio; formatos aceitos: JPEG, PNG e WebP; limite de 5 MB;
- `create_order` cria o pedido em `DRAFT`;
- `order_items` registra os itens;
- a imagem é enviada ao bucket `order-images`;
- `order_images` vincula o arquivo ao pedido;
- `submit_order` muda `DRAFT -> PENDING_APPROVAL`;
- `status_history` registra a evolução do status.

Confirmado no frontend atual:
- não existe fallback direto de `orders.insert(...)` no fluxo de criação;
- `create_order` é o único caminho de criação no browser;
- retry usa somente `draft_order_id` com `submit_order`.

Comportamento de retry confirmado:
- quando o envio falha após criação do rascunho, o formulário mantém `draft_order_id`;
- o retry de `submit_order` reutiliza o pedido já criado;
- o retry não deve recriar `create_order`, `order_items`, upload nem `order_images`.

Fluxo de edição e reenvio após `CHANGES_REQUESTED`:
- admin chama `request_order_changes` -> status `CHANGES_REQUESTED`;
- solicitante abre `/novo-pedido?orderId=<id>` -> formulário carrega em modo edição com banner;
- solicitante altera itens/observações, foto opcional;
- `resubmit_changed_order` RPC atômico: valida solicitante ativo + dono + status `CHANGES_REQUESTED`; substitui `order_items` (delete-all + insert); preserva imagem existente ou substitui (deleta storage antigo ANTES de inserir novo metadata); atualiza status para `PENDING_APPROVAL`; appende `status_history` + `audit_logs`;
- mesmo `order_id` preservado; sem duplicação de itens/imagens/histórico;
- retry idempotente: após sucesso status é `PENDING_APPROVAL` -> nova chamada falha sem duplicar dados.

## 9. Administração de usuários
O projeto já possui página `/usuarios` e backend seguro em `/api/admin/users`.

O que está confirmado no código e testes:
- controle ADMIN-only;
- listagem com paginação e filtros;
- criação de usuário com senha temporária;
- edição de usuário;
- exclusão de usuário;
- vínculo de lojas via `user_stores`;
- uso de `service role` apenas no backend;
- DTO de resposta sem expor segredos.

## 10. Decisões já tomadas
- não usar framework frontend nesta base;
- manter HTML/CSS/JS puro com partials HTML;
- usar `History API` para navegação;
- manter rotas públicas em português;
- não expor código privado pelo Express;
- usar `service_role` somente no backend;
- não confiar no papel enviado pelo browser;
- não modificar migrations já aplicadas;
- usar migrations incrementais;
- usar um único dono para `submit_order`;
- retry de `submit_order` não pode criar pedido duplicado;
- `REJECTED` é estado final e `CHANGES_REQUESTED` é o estado de correção;
- o caminho preferido de criação é `create_order`;
- existe fallback de insert direto na camada de dados do frontend; ele é compatibilidade temporária e área de risco;
- remover esse fallback depende de validação live do RPC remoto `create_order`;
- o fluxo de pedidos por loja usa restrição por vínculo de lojas;
- a verificação live do `submit_order` foi concluída nesta sessão e limpeza foi executada.
- inventário Phase 1: alertas e gestão manual de estoque; sem dedução automática, sem reserva;
- SKU de inventário = `order_items.product_code` (sem catálogo de produtos separado);
- `inventory_item_id` em `order_items` é nullable; backfill apenas quando determinístico;
- `inventory_movements` são INSERT-only imutáveis para admins; sem UPDATE/DELETE;
- `product_code` normalizado via `upper(btrim(product_code))` para índice único e matching;
- mutações de admin via API Express/Pages; leitura de user normal via RLS Supabase;

## 11. Funcionalidades concluídas

### Autenticação
- login funcionando com restauração de sessão;
- bloqueio de usuários inativos;
- normalização de papel persistido e papel de interface.

### Roteamento
- shell com `History API`;
- rotas `/login`, `/dashboard`, `/pedidos`, `/novo-pedido`, `/lojas`, `/usuarios`;
- fallback de rota inexistente sem tela branca;
- carregamento de partials em `public/pages/`.

### Pedidos
- listagem;
- filtros;
- resumo;
- paginação;
- drawer de visualização;
- validação de formulário;
- upload de imagem;
- submissão para aprovação;
- retry seguro usando `draft_order_id`.

### Novo pedido
- formulário em partial próprio;
- validação de arquivo real;
- foto obrigatória antes do envio;
- limite de tamanho e tipos de imagem (JPEG, PNG, WebP, até 5 MB);
- proteção contra submit duplicado;
- diagnóstico por estágio no envio.

### Edição e reenvio após `CHANGES_REQUESTED`
- formulário de edição em `/novo-pedido?orderId=<id>` com banner de edição;
- botão "Editar Pedido" no drawer para solicitante ativo em `DRAFT`/`CHANGES_REQUESTED`;
- RPC `resubmit_changed_order` atômico: substitui itens, preserva/substitui imagem, histórico + auditoria;
- mesmo `order_id` preservado; sem duplicação de itens/imagens/histórico;
- retry idempotente: rejeitado após sucesso (status `PENDING_APPROVAL`).

### Lojas
- página em partial dedicada `/pages/lojas.html`;
- carregamento e manutenção da listagem de lojas;
- eventos da página ligados por `StoresModule`.

### Minha Conta (modal global)
- modal global em `public/index.html`, sem rota;
- aberto via `#account-open-btn` na sidebar;
- email e senha em seções separadas com reautenticação antes de salvar;
- fechamento via X, backdrop, Escape ou botão "Fechar" no footer;
- módulo lê globais (`getCurrentUser`, `sb`, `showToast`) diretamente, sem dep do shell;
- `public/pages/minha-conta.html` deletado (substituído por modal).

### Usuários
- página administrativa;
- endpoint seguro;
- criação, edição, exclusão e listagem;
- filtros e paginação.

### Remoção de usuário (soft-remove com identidade histórica)
- remoção via soft delete: `is_active=false`, `removed_at`, `removed_by_id`;
- RPC atômico `admin_remove_user_profile` com lock FOR UPDATE, proteção de ADMIN final e idempotência;
- desativação de Auth via `ban_duration: '876000h'` + `app_metadata.is_active=false`;
- exibição histórica com `formatHistoricalActorName()`: nome original + `— usuário removido`;
- filtro `Removidos` na listagem de usuários;
- badges CSS com cor slate para status `Removido`;
- verificação `current_user_is_active()` adicionada a TODOS os RPCs de mutação;
- dados de pedidos, imagens e auditoria preservados (FKs mantidas);
- profile e Auth user preservados (sem deleção física);
- teste de servidor completo (remoção, idempotência, self-removal, ADMIN final);
- cleanup destrutivo para testes E2E via `purgeDisposableUser()` com service-role key;
- **21 migrations** aplicadas e sincronizadas local↔remote;
- `current_user_is_active()` agora verifica `is_active AND removed_at IS NULL`.
- RLS hardening completo: TODAS as políticas (11 atualizadas) incluem `current_user_is_active()`.

### Backend
- servidor Express mínimo;
- `/api/config`;
- `/api/health`;
- `/api/admin/users`.
- `/api/admin/inventory`.

### Inventário (Phase 2 — frontend page + admin API)
- admin-only API: list, create, update, adjust quantity com motivo;
- Express route em `src/server/routes/inventory-admin.js` + Pages Functions parity;
- migration `20260703000000_add_store_inventory.sql`: `inventory_items`, `inventory_movements`, FK opcional em `order_items`, RLS, índices;
- movimentos imutáveis (INSERT-only);
- RLS: admin full access; user normal SELECT para lojas vinculadas;
- frontend `/estoque`: página parcial, toolbar com busca/filtros, tabela, modal de criar/editar/ajuste, modal de histórico de movimentos;
- `inventory-data.js`: leitura via RLS (Supabase queries) para usuários normais; chamadas admin API para admin;
- `inventory-module.js`: lógica de página com filtros, render, modais, event delegation (`data-inv-action`);
- rota protegida por recurso `inventory-read`; controles admin por `inventory-admin` + `isAdmin`;
- testes de servidor: auth gates, CRUD, adjust, validação, prototype pollution;
- testes de contrato Cloudflare Pages para arquivos de inventory;
- testes de frontend: inventário com 25 grupos de verificação (inclui indicadores de dashboard);

### Segurança
- `service_role` fora do frontend;
- `RLS` e `Storage` privados no fluxo de pedidos;
- migrations incrementais;
- verification SQL separado.

### Receipt Invoice and Values
- `confirm_order_received` RPC now accepts `p_invoice_number` + `p_item_values` (order-level NF + per-item unit value).
- `order_receipts` table stores order-level invoice metadata.
- `store_stock_receipts` has `order_receipt_id`, `received_unit_value`, `received_total_value`.
- Frontend drawer: one-click "Confirmar Recebimento" replaced by modal with NF input + unit value per item.
- `/estoque` page: NF, valor unit., valor total columns in received table + CSV/XLSX export.
- Legacy `RECEIVED` rows keep nullable invoice/value.
- Admin receipt edit modal includes unit value field.
- Migration `20260710000000_receipt_invoice_and_values.sql`.

### Dashboard Value Cards and Charts
- Dashboard shows "Valor Total Recebido" + "Total de NFs" KPI cards in third KPI grid row.
- "Valor por Loja" horizontal bar chart in new chart grid row (top 5 stores by received total value).
- "Valor por Dia" line chart in same grid row (daily received total value).
- New helpers: `formatCurrency`, `calcReceiptValueKpi`, `groupReceiptValueByStore`, `groupReceiptValueByDay`, `renderValueBarChart`, `renderValueLineChart`.
- `npm run check` (71 files), `npm test` (20 suites), `npm run test:smoke`: all PASS.

### Testes
- testes de frontend;
- testes do backend administrativo;
- smoke tests;
- validação geral via scripts npm.

## 12. Problemas conhecidos
No estado atual, não há um problema de execução comprovado que deva ser registrado como ativo sem nova confirmação. Pontos que já apareceram na sessão e foram corrigidos ou limpos não devem ser tratados como pendência ativa.

Documentation drift between `AGENTS.md`, `CODEx_CONTEXT.md`, and current code is a known meta-problem. Run `npm run check` and `npm test` after documentation changes to catch stale references.

## 13. Tarefas pendentes

### Média prioridade
- revisar wrappers globais restantes apenas quando houver dor de manutenção ativa.

### Baixa prioridade
- E2E `admin-user-removal.spec.js` **CONCLUÍDO** — 14/14 testes passam.
  - RPC fix: `p_caller_id` adicionado ao `admin_remove_user_profile` para service_role.
  - Frontend fix: botões Editar/Remover ocultos para usuários removidos.
  - Cleanup fix: `deleteStorageObject` usa fetch direto sem Content-Type.
  - Playwright fix: command = `node server.js` (não `npm start`) + `stdout/stderr: 'pipe'`.
  - Auth REST denial test (06b): confirma que login via Supabase Auth REST retorna HTTP 400 `user_banned`.
  - Stale-session mutation test (08b): verifica que INSERT/UPDATE/DELETE via PostgREST são bloqueados por RLS (verificação de integridade com service role).
  - 26 stale E2E fixtures purgados via `scripts/maintenance/purge-stale-e2e-users.js`; zero leftovers.
  - 21/21 migrations sincronizadas local↔remote.

## 14. Comandos do projeto
- `npm install`: instala dependências.
- `npm start`: inicia o servidor Express.
- `npm run dev`: inicia o servidor com `nodemon`.
- `npm run check`: validações estáticas do projeto.
- `npm test`: suíte de testes automatizados.
- `npm run e2e`: Playwright E2E tests headless (49 tests, requires env vars; `--workers=1` for writes).
- `npm run e2e -- tests/e2e/admin-user-removal.spec.js --workers=1`: E2E user removal (14 tests, requires `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` env vars).
- `npm run test:smoke`: smoke tests via PowerShell.
- `npm run validate`: executa `check`, `test` e `test:smoke`.
- `npm run preview:pages`: preview local das Pages Functions via `npx wrangler pages dev` (requer `.dev.vars` com chaves reais).

## 15. Variáveis de ambiente

### Browser-safe
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Server-only
- `PORT`
- `SUPABASE_SERVICE_ROLE_KEY`

### Server-only (Cloudflare Pages Functions — in `context.env` via `.dev.vars`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 16. Testes e validação
Os testes atuais ficam em:
- `tests/frontend/order-rules.test.js`
- `tests/frontend/orders-module.test.js`
- `tests/frontend/order-form.test.js`
- `tests/frontend/router.test.js`
- `tests/frontend/auth.test.js`
- `tests/frontend/stores.test.js`
- `tests/frontend/users.test.js`
- `tests/frontend/xss-escape.test.js`
- `tests/frontend/no-inline-events.test.js`
- `tests/frontend/account.test.js`
- `tests/server/order-resubmit-contract.test.js`
- `tests/server/startup.test.js`
- `tests/server/users.test.js`
- `tests/server/orders-admin.test.js`
- `tests/server/cloudflare-pages-contract.test.js`
- `tests/server/e2e-runtime-safety.test.js`
- `tests/server/supabase-verification-assets.test.js`
- `tests/server/security-hardening.test.js`
- `tests/server/inventory-admin.test.js`
- `tests/e2e/csp-smoke.spec.js` (optional; requires `E2E_REQUIRE_CSP=true` and Pages preview)
- `tests/e2e/`

Validação obrigatória do projeto:
- `npm run check`
- `npm test`
- `npm run test:smoke`
- `npm run validate`

Para alterações que dependem de Supabase real, registrar validação manual explícita além dos testes automatizados.

## 17. Regras que não devem ser violadas
- não expor `SUPABASE_SERVICE_ROLE_KEY` ao frontend;
- não registrar tokens, refresh tokens, senhas ou headers de autorização;
- não colocar segredos no Git;
- não confiar em autorização enviada pelo browser;
- não alterar migrations já aplicadas;
- não usar `db reset` no projeto remoto;
- não enfraquecer `RLS` ou `Storage` para fazer teste passar;
- não conceder acesso anon a RPCs administrativas;
- não criar novos papéis persistidos sem migration e decisão explícita;
- não duplicar o dono do submit;
- não recriar pedido durante retry de `submit_order`;
- não remover histórico de status;
- não tratar fallback de insert direto como arquitetura aprovada de longo prazo;
- `getStoreById()` deve usar `cachedStores` (filtro por `user_stores`) como fonte autoritativa para usuários não-admin; `StoresModule.findStoreById()` é fallback apenas para admin.
- não adicionar dependências Node-only (node:crypto, filesystem, Express) no código em `functions/` — usar Web Crypto, `fetch`, `URL`, Response/Request nativos.
- não modificar implementação Express de `/api/*` já validada; criar implementação Pages Functions separada em `functions/api/` com testes de contrato em `cloudflare-pages-contract.test.js`.

## 18. Procedimento para alterações
1. Inspecionar o código atual.
2. Produzir um plano limitado.
3. Alterar poucos arquivos por lote.
4. Executar testes.
5. Fazer validação manual quando houver Supabase real envolvido.
6. Registrar resultado.
7. Parar antes de tarefas não aprovadas.

### 18.1 Procedimento de verificação de segurança

| Passo | Ação | Ferramenta | Requer aprovação |
|-------|------|------------|-----------------|
| 1 | Escanear migrations por SQL dinâmico | `tests/server/security-hardening.test.js` sec 6 | Não |
| 2 | Validar normalização de filtros (UUID, store ID, role, status) | `tests/server/security-hardening.test.js` sec 7 | Não |
| 3 | Verificar codificação de URLs PostgREST | `tests/server/security-hardening.test.js` sec 8 | Não |
| 4 | Testar rejeição de injeção SQL em rotas Express | `tests/server/security-hardening.test.js` sec 9 | Não |
| 5 | Validar CORS (apenas loopback) | `tests/server/security-hardening.test.js` sec 10, 11 | Não |
| 6 | Verificar XSS: escapeHtml, allowlists, sem eventos inline | `tests/frontend/xss-escape.test.js`, `no-inline-events.test.js` | Não |
| 7 | Verificar guards de runtime E2E (rejeição de produção) | `tests/server/e2e-runtime-safety.test.js` | Não |
| 8 | Verificar SQL de verificação (SELECT-only) | `tests/server/supabase-verification-assets.test.js` | Não |
| 9 | Validar RLS ativo, sessão stale, Storage policies | Supabase local ou E2E hosted | Sim |
| 10 | Validar IDOR, admin route denial, Storage acesso real | E2E non-production hosted | Sim |
| 11 | Testes destrutivos (remoção de usuário, deleção de pedido, restore drill) | E2E + scripts | Sim (explícita separada) |

**Proibido sem aprovação explícita:**
- Escritas em produção
- Mutação remota de DB
- `supabase db reset` remoto
- Enfraquecimento de RLS/Storage
- Scripts de purge em dados não-teste
- Impressão de secrets, tokens, service-role key

## 19. Próximos passos recomendados
1. Revisar wrappers globais restantes apenas quando houver dor de manutenção ativa.
   - área provável: `public/index.html`, `public/js/core/app-shell.js`
   - risco: baixo, porque é dívida estrutural, não incidente funcional
   - critério de conclusão: remover apenas quando houver ganho concreto de manutenção
   - status: accepted technical debt
2. Cloudflare Pages deployment: quando autorizado, configurar projeto no Cloudflare Dashboard, configurar Supabase Dashboard com Site URL + redirect URLs para produção/preview, e fazer deploy da branch de produção.
3. Pages preview local: instalar Wrangler localmente, criar `.dev.vars` com chaves reais, rodar `npm run preview:pages`.
4. CSP baseline para publicação em produção.
5. CSP browser validation: rodar Pages preview e `E2E_REQUIRE_CSP=true npm run e2e -- tests/e2e/csp-smoke.spec.js --workers=1` para capturar violações reais de CSP/SRI.
6. Validação de segurança hosted: após deploy não-produção, validar RLS, IDOR, stale session, Storage policies e admin route denial com E2E real.
7. CI security scanning: workflow criado em `.github/workflows/security-scan.yml`; configurar branch protection/gating quando disponível.

## 20. Estado da última validação
Último resultado informado na sessão:
- `npm run check`: passou (66 files)
- `npm test`: passou (20 suites)
- `npm run test:smoke`: passou
- `user-store-visibility`: concluído; migration aplicada remotamente; frontend e Playwright E2E live passaram
- `lojas` partial migration: concluída; legacy renderer removido
- `changes-requested-edit-and-resubmit`: migration aplicada remotamente; verification SQL passou; Playwright E2E live passou
- verificação live do `submit_order`: concluída com sucesso e limpeza executada
- `/usuarios` ADMIN CRUD live E2E: validado
- `store-visibility-fix`, `orphan-auth-cleanup`, `getStoreById-fix`, `resubmit-false-toast-fix`: concluídos
- `user-deactivation-and-historical-identity`: 21/21 migrations sync. E2E 14/14 PASS. `npm run check` (53 files), `npm test` (11 suites): PASS.
- **Cloudflare Pages deployment**: `.specs/features/cloudflare-pages-deployment/` spec+design+tasks criados; `public/_redirects`, `public/_headers`, `public/vendor/supabase/supabase.js` (v2.108.2 UMD); `functions/_shared/` (admin-core, admin-service, env, http); `functions/api/` (config, health, admin/users, admin/orders); `wrangler.toml`, `.dev.vars.example`; `tests/server/cloudflare-pages-contract.test.js` com testes de arquivo estático, core unit, HTTP, env, contrato. `npm run check` (55 files), `npm test` (12 suites), `npm run test:smoke`: all PASS. Express codebase untouched. Tasks.md status: **locally validated**.
- **Minha Conta modal**: página `/minha-conta` deletada; substituída por modal global em `index.html`. Modal usa `users-modal` base + `account-*` custom classes. `account-module.js` lê globais diretamente (sem deps do shell). CSS scoped em `users.css`. Footer close button removido (fecha via X, backdrop, Escape). `npm run check` (63 files), `npm test` (18 suites): PASS.
- **Security hardening**: 11 test sections added to `tests/server/security-hardening.test.js` covering http.js helpers, admin-core.js sanitization, Express route hardening (UUID validation, content-type enforcement, field allowlists, prototype pollution, auth-before-validation, error detail concealment), Express app.js middleware safety, error message leakage analysis, migration SQL static analysis, filter normalization safety, PostgREST URL encoding safety, Express route SQLi rejection, integration CORS tests, and `isLocalOrigin` pure function tests. `npm run check` (63 files), `npm test` (18 suites): PASS.
- **CSP/SRI + CI security scanning**: CSP baseline in `public/_headers` with Supabase API/storage allowances; CDN scripts pinned + SRI + `crossorigin="anonymous"`; `.github/workflows/security-scan.yml` adds npm audit/OSV, Semgrep and TruffleHog with read-only permissions; `cloudflare-pages-contract.test.js` guards CSP/SRI/workflow; optional `tests/e2e/csp-smoke.spec.js` requires Pages preview + `E2E_REQUIRE_CSP=true`. Browser validation still pending.
- **Store Inventory Phase 1 (corrected)**: Wrong model (`inventory_items`, `inventory_movements`) replaced by receipt-based stock lifecycle. Migration `20260706000000_correct_stock_lifecycle.sql` drops wrong tables, creates `order_item_stock_checks` (stock analysis), `store_stock_receipts` (immutable receipt history), `store_stock_balances` (estimated balance). Rewrites `confirm_order_received` to insert receipt rows per `order_items`. Reverts `mark_order_placed` to original (no deduction). Express route `stock-checks.js` mounted at `/api/admin/stock-checks` and `/api/admin/received-stock`. Pages Functions parity at `stock-checks/index.js`, `stock-checks/[orderItemId].js`, `received-stock/index.js`. Tests: `tests/server/inventory-admin.test.js` (13 groups), `tests/frontend/inventory.test.js` (18 groups). `npm run check` (70 files), `npm test` (20 suites), `npm run test:smoke`: all PASS.
- **Store Inventory Phase 2 (frontend)**: `/estoque` page shows only received items table. Checks data loaded silently for CSV/XLSX export. Export button in toolbar with dropdown (CSV / XLSX). CSV uses `;` separator, UTF-8 BOM, injection guard. XLSX uses existing `XLSX` global library with two sheets (Solicitados, Recebidos). Export respects active search and loja filters. `inventory-data.js` selects `lojas(id,codigo,nome)` embed. `inventory-module.js` exposes `exportCsv`, `exportXlsx`, `escapeCsv`. CSS uses `stock-*` classes (stores.css card/table pattern) plus export button/menu styles. Route `/estoque` resource `stock-checks-read`. 30 frontend test groups.
- **Store Inventory Phase 3 (deferred)**: Dashboard inventory indicators removed (no-op). Auto-deduction removed. Consumption tracking deferred.
