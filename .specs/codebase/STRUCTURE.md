# Project Structure

**Root:** `C:\Users\vinicius.costa\Downloads\plataforma`

## Directory Tree

```text
.
├─ public/
│  ├─ index.html
│  ├─ js/
│  │  ├─ core/
│  │  ├─ legacy/
│  │  ├─ pages/
│  │  └─ shared/
│  ├─ pages/
│  └─ styles/pages/
├─ src/server/
│  ├─ app.js
│  ├─ routes/
│  └─ services/
├─ scripts/
│  ├─ admin/
│  ├─ maintenance/
│  └─ smoke/
├─ supabase/
│  ├─ migrations/
│  └─ verification/
├─ tests/
│  ├─ frontend/
│  └─ server/
└─ .specs/codebase/
```

## Module Organization

### Frontend Shell

**Purpose:** App layout, route mounting, global script loading.  
**Location:** `public/index.html`, `public/js/core/`  
**Key files:** `index.html`, `app-shell.js`, `auth.js`

### Frontend Pages

**Purpose:** UI and behavior for dashboard, orders, new order, stores, users.  
**Location:** `public/pages/`, `public/js/pages/`, `public/styles/pages/`  
**Key files:** `pedidos.html`, `novo-pedido.html`, `usuarios.html`, page modules and CSS.

### Shared Frontend Logic

**Purpose:** Pure validation, mapping, status, permission helpers.  
**Location:** `public/js/shared/`  
**Key files:** `app-utils.js`, `order-rules.js`

### Server

**Purpose:** Express app, safe config, healthcheck, admin user API, admin inventory API.  
**Location:** `src/server/`  
**Key files:** `app.js`, `routes/users-admin.js`, `routes/inventory-admin.js`, `routes/orders-admin.js`, `services/supabase-admin-service.js`

### Supabase

**Purpose:** Database schema, RLS, RPCs, storage policy, verification SQL.  
**Location:** `supabase/`  
**Key files:** migration SQL files, verification SQL files, `config.toml`

### Tests And Scripts

**Purpose:** Node checks, unit/integration-like tests, smoke and admin operations.  
**Location:** `tests/`, `scripts/`  
**Key files:** `check-project.js`, `smoke-test.ps1`, `create-admin.js`, test files.

## Where Things Live

**Authentication:**

- UI/Interface: `public/pages/login.html`
- Business Logic: `public/js/core/auth.js`
- Data Access: Supabase Auth through browser client
- Configuration: `/api/config`, `.env.example`

**Orders:**

- UI/Interface: `public/pages/pedidos.html`, `public/pages/novo-pedido.html`
- Business Logic: `public/js/pages/orders/`, `public/js/pages/order-form/`, `public/js/shared/order-rules.js`
- Data Access: `public/js/pages/orders/orders-data.js`, Supabase RPCs/tables/storage
- Configuration: Supabase migrations and storage bucket policies

**Users:**

- UI/Interface: `public/pages/usuarios.html`
- Business Logic: `public/js/pages/users/`, `src/server/services/supabase-admin-service.js`
- Data Access: `/api/admin/users`, Supabase Auth Admin, REST tables
- Configuration: server env keys in `.env.example`

**Inventory (Phase 2 — frontend page + admin API):**

- UI/Interface: `public/pages/estoque.html`
- Business Logic: `public/js/pages/inventory/inventory-module.js`, `public/js/pages/inventory/inventory-data.js`, `public/styles/pages/inventory.css`
- Server API: `src/server/routes/inventory-admin.js`, `src/server/services/supabase-admin-service.js` (Express); `functions/api/admin/inventory/index.js`, `functions/api/admin/inventory/[id].js`, `functions/_shared/admin-service.js` (Pages)
- Data Access: Supabase `inventory_items`, `inventory_movements`, service role (admin), RLS (normal users)
- Configuration: `supabase/migrations/20260703000000_add_store_inventory.sql`

**Stores:**

- UI/Interface: `public/pages/lojas.html`
- Business Logic: `public/js/pages/stores/stores-module.js`
- Data Access: Supabase `lojas` and `user_stores`
- Configuration: Supabase migrations/RLS

## Special Directories

**`.specs/codebase/`:** Brownfield docs for current repository mapping.

**`supabase/verification/`:** Read-only SQL checks; not schema-changing migrations.


