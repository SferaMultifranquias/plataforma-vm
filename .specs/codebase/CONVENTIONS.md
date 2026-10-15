# Code Conventions

## Naming Conventions

**Files:** kebab-case for browser modules and pages.  
Examples: `app-shell.js`, `order-rules.js`, `orders-data.js`, `order-form-module.js`, `users-admin.js`.

**Functions/Methods:** camelCase in JavaScript; Portuguese names remain where existing domain/UI code uses them.  
Examples: `normalizeOrderRecord`, `createUsersAdminRouter`, `carregarUsuarioAtual`, `enviarPedidoAPI`.

**Variables:** camelCase for JavaScript locals; global legacy state may use uppercase or prefixed names.  
Examples: `currentUser`, `renderGeneration`, `_lojasCache`, `SUPA_URL`.

**Constants:** uppercase for true constants and Set names when local convention uses it.  
Examples: `CURRENT_USER_STORAGE_KEY`, `DECISIONABLE_STATUSES`, `ALLOWED_IMAGE_MIME_TYPES`.

## Code Organization

**Import/Dependency Declaration:**

- Server modules use CommonJS `require()` at top.
- Browser modules use IIFE globals and receive dependencies through `deps` objects.
- Tests use `require()`, `fs`, `path`, `vm`, and hand-written sandboxes.

**File Structure:**

- Browser modules wrap implementation in `(function initXModule(global) { ... })(window)`.
- Public API is assigned at bottom, for example `global.AppUtils = { ... }`.
- Server services keep helper functions near top and return method collections from factory functions.

## Type Safety/Documentation

**Approach:** No TypeScript. Runtime validation and normalization functions carry safety.  
Examples: `normalizeStoreIds()` validates integer store IDs; `validateOrderForm()` returns `{ valid, errors }`.

## Error Handling

**Pattern:** Throw `Error`/`AdminError` with user-safe messages, catch at route/page boundary, map to UI or JSON.  
Examples:

- `src/server/routes/users-admin.js` maps `AdminError` to `{ code, error }` JSON.
- `orders-data.js` uses staged errors (`createStageError`) for order submission diagnostics.
- `auth.js` blocks inactive users by signing out and throwing a user-facing error.

## Comments/Documentation

**Style:** Sparse comments. Existing comments mostly mark large sections in `public/index.html` and operational docs in Markdown. Code relies on descriptive function names and tests.

## HTML/CSS Conventions

- Main app shell lives in `public/index.html`.
- New pages use partials in `public/pages/` without `doctype`, `html`, `head`, `body`, `script`, or inline event attributes.
- Page CSS lives in `public/styles/pages/`.
- Router tests enforce partial constraints.

## Security Conventions

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend or `/api/config`.
- Persisted roles are `USER` and `ADMIN`; UI roles are `loja` and `admin`.
- Browser permission checks are UX only; Supabase RLS/RPCs and server admin validation are authority.
