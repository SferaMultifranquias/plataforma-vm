# Tasks — Store Schema and Form Redesign

## Modal Redesign Iteration

### Work Items
1. Restructure `#modal-loja` internals in `public/index.html` to match approved card layout.
2. Add modal-scoped CSS in `public/styles/pages/stores.css` for header, cards, grids, footer, and responsive breakpoints.
3. Add minimal modal open/close/focus handling in `public/js/pages/stores/stores-module.js` without changing payload or validation.
4. Update `tests/frontend/stores.test.js` for section order, dialog semantics, selector preservation, and modal classes.
5. Validate locally with `node tests/frontend/stores.test.js`, `git diff --check`, `npm run check`, `npm test`, `npm run validate`.
6. Leave E2E pending explicit approval because store CRUD E2E performs live writes.

### Acceptance
- Section order: Informações da Loja, Identificação, Localização, Status.
- `#modal-loja > div` remains panel selector.
- Current payload, validation, brand mapping, and save flow unchanged.
- Create/edit titles and save labels continue to switch correctly.

## Phase 1: Confirm Current CRUD and Shared Visual Patterns

**Goal:** Validate investigation findings against live code before planning implementation.

**Depends on:** Nothing.

**Actions:**
1. Re-read `stores-module.js` — confirm `renderRow`, `renderMobileRow`, `salvarLoja`, `editarLoja`, `abrirModalLoja`, `loadStores`, empty-state.
2. Re-read `index.html` — confirm inline modal HTML, global `onclick` bindings, shared CSS classes.
3. Re-read `stores.css` — note any styles for removed fields.
4. Re-read `tests/frontend/` — check existing store tests.
5. Grep for `responsavel`, `endereco`, `telefone`, `email_contato` across all `public/` and `src/` to confirm no backend dependency.
6. Confirm `_lojasCache` invalidation points.

**Risks:** None.

**Completion criteria:**
- Investigation notes confirm all findings.
- No backend/RLS references to removed fields found.
- List of CSS rules to remove is complete.

**Validation:**
- `npm run check`
- `npm test`
- Manual grep results reviewed.

---

## Phase 2: Create Nullable Database Migration

**Goal:** Add `cidade` and `estado` columns to `public.lojas` without breaking existing data.

**Depends on:** Phase 1 (safety confirmation).

**Actions:**
1. Generate timestamped migration file in `supabase/migrations/`.
2. Write SQL:
   ```sql
   alter table public.lojas
       add column if not exists cidade text,
       add column if not exists estado varchar(2);
   ```
3. Create verification SQL in `supabase/verification/` to confirm columns exist and are nullable.
4. (Remote apply deferred to Phase 10.)

**Risks:**
- Migration number collision if someone else creates a migration simultaneously.

**Completion criteria:**
- Migration file created and reviewed.
- Verification SQL created.
- `npm run check` passes (no lint errors on SQL files).

**Validation:**
- `npm run check`
- Review SQL syntax manually.

---

## Phase 3: Simplify Store Domain and Payload Contract

**Goal:** Define the canonical list of 6 fields in the frontend domain layer as the single source of truth.

**Depends on:** Phase 1 (contract confirmed).

**Actions:**
1. Update `stores-module.js` — define `STORES_CONTRACT` constant:
   ```js
   const STORES_CONTRACT = ['codigo', 'nome', 'marca', 'ativo', 'cidade', 'estado'];
   ```
2. Update `loadStores()` select to: `.select('id,codigo,nome,marca,ativo,cidade,estado')`.
3. Update all payload construction to only include these 6 fields.
4. Remove any stale field-whitelist or field-building helpers.

**Risks:**
- Other modules (`carregarLojas()`, order form store dropdown) don't need the new columns — they work fine since they only reference `codigo` and `nome`.

**Completion criteria:**
- `loadStores()` select includes `cidade,estado`.
- Payload in `salvarLoja()` contains exactly 6 contract fields.
- `_lojasCache` invalidation unchanged.

**Validation:**
- `npm run check`
- `npm test`
- Manual review of `stores-module.js` payload paths.

---

## Phase 4: Remove Unsupported Fields and the Responsible Table Column

**Goal:** Delete all frontend references to `endereco`, `responsavel`, `telefone`, `email`, `email_contato`.

**Depends on:** Phase 3 (contract defined).

**Actions:**
1. `stores-module.js`:
   - Remove `renderRow` column for Responsável (header and data cell).
   - Remove `renderMobileRow` responsável field.
   - Update empty-state `colspan` to 6.
   - Remove any references from `salvarLoja` state collection.
2. `index.html`:
   - Remove form fields: `fl-endereco`, `fl-responsavel`, `fl-telefone`, `fl-email`.
   - Rename `fl-uf` → `fl-estado`.
3. `stores.css`:
   - Remove any CSS rules targeting removed field elements.
4. Tests:
   - Remove any test expectations for removed fields.
5. `stores-module.js`:
   - Change Responsável header to Cidade.
   - Show `row.cidade || '-'` in cidade cell.

**Risks:**
- Global scope `fl-endereco` references in `salvarLoja` gate — must match renamed ID.
- Forgetting to update `renderMobileRow`.

**Completion criteria:**
- Grep for `endereco`, `responsavel`, `telefone`, `email_contato` in `public/` returns zero matches.
- Grep for `fl-uf` returns zero matches.
- Grep for `fl-estado` returns at least one match.
- `Responsável` header no longer exists.

**Validation:**
- `npm run check`
- `npm test`
- Manual grep of `public/`.

---

## Phase 5: Redesign Modal Markup and Responsive Layout

**Goal:** Restructure the inline modal form for two-column desktop and single-column mobile.

**Depends on:** Phase 4 (removed old fields first).

**Actions:**
1. `index.html` — rewrite modal form section:
   - Grid layout: `grid grid-cols-1 md:grid-cols-2 gap-3`.
   - `codigo` + `marca` in one row (col-1 and col-2).
   - `nome` full width (`md:col-span-2`).
   - `cidade` + `estado` in one row.
   - `fl-ativo-wrapper` shown only in edit mode (full width).
2. Restructure button row: `Cancelar | Salvar` using `.btn-secondary` and `.btn-primary`.
3. Change button text from `Fechar` to `Cancelar` (create mode) / `Fechar` (edit mode — consistent with users modal).

**Risks:**
- Two-column layout might be too tight for `max-w-lg` on tablet. Test at 768px-1024px.

**Completion criteria:**
- Desktop: two-column grid, no horizontal overflow.
- Mobile: single-column stack, no horizontal overflow.
- All 5 form fields visible and functional.
- `fl-ativo-wrapper` hidden on create, shown on edit.

**Validation:**
- Manual viewport testing (Chrome DevTools responsive mode).
- `npm run check`

---

## Phase 6: Align CSS with Shared Platform Styles

**Goal:** Use `.form-input`, `.form-select`, `.form-label`, `.btn-primary`, `.btn-secondary` — remove any custom form styles.

**Depends on:** Phase 5 (modal markup structure final).

**Actions:**
1. `stores.css` — remove any custom input/button/label styles that duplicate shared classes.
2. Remove unused CSS from `stores.css`.
3. Verify no inline styles (except `text-transform:uppercase` on estado input).

**Risks:**
- Removing a custom style that the shared class doesn't cover (e.g., specific modal padding).

**Completion criteria:**
- Modal uses only shared form classes.
- No CSS duplication between `stores.css` and `index.html` style block.
- Visual appearance unchanged from platform patterns.

**Validation:**
- Visual diff review.
- `npm run check`

---

## Phase 7: Update Create and Edit Behavior

**Goal:** Ensure `salvarLoja()` and `editarLoja()` work correctly with the new contract.

**Depends on:** Phases 3, 4, 5 (contract, fields, modal).

**Actions:**
1. `salvarLoja()`:
   - Collect state from the 5 visible fields + ativo hidden field.
   - Client-side validation (required fields, estado format).
   - Build payload with only contract fields.
   - Supabase insert/update call.
2. `editarLoja(id)`:
   - Hydrate all 5 visible fields from store object.
   - Show `fl-ativo-wrapper`.
   - Set `fl-id` for update routing.
3. `fecharModalLoja()`:
   - Reset form to defaults.
   - Hide `fl-ativo-wrapper`.
4. Rename `fl-uf` to `fl-estado` in all `getElementById` calls.

**Risks:**
- Forgetting to convert `estado` to uppercase before submit.
- Forgetting to pass `null` for empty optional fields (Supabase rejects empty string on nullable columns? No, empty string is valid text. But better to send null for true "not provided" semantics.)

**Completion criteria:**
- Create: fills form, submits, row appears.
- Edit: opens with hydrated data, saves, row updates.
- Cancel: resets form correctly.
- `fl-estado` uppercase on type and on submit.

**Validation:**
- `npm run check`
- `npm test`

---

## Phase 8: Add Frontend Tests

**Goal:** Cover new contract, validation, rendering, and payload.

**Depends on:** Phases 4-7 (implementation done).

**Actions:**
1. Create `tests/frontend/stores.test.js`:
   - Modal renders correct fields.
   - Edit mode hydrates correctly.
   - Submit builds correct payload (stub Supabase).
   - Validation blocks empty required fields.
   - Validation blocks bad estado format.
   - No references to removed fields.
   - Table renders Cidade column with `row.cidade || '-'`.

**Risks:**
- Test env may not have `showToast` or Supabase stub — check existing test patterns.

**Completion criteria:**
- All new tests pass.
- Existing tests unaffected.
- Codecov does not decrease (if measured).

**Validation:**
- `npm test`

---

## Phase 9: Add Live E2E for Create, Edit, Deactivate, Layout, and Cleanup

**Goal:** Validate against real Supabase instance.

**Depends on:** Phase 10 (migration applied first).

**Actions:**
1. Expand or create Playwright script for stores:
   - Create store with all fields → verify row.
   - Edit store (change cidade, estado) → verify update.
   - Toggle ativo → verify badge.
   - Test responsive layout at 375px and 1024px.
   - Delete test stores after run.
2. Test timeout? Consider `npm run test:e2e` hook.

**Risks:**
- Test data cleanup may fail. Use UUID suffix in store codigo for easy deletion.
- Remote DB may not have migration applied yet — block until Phase 10.

**Completion criteria:**
- All E2E scenarios pass.
- Test stores deleted post-run.
- No data leaks.

**Validation:**
- `npm run test:smoke` (or custom e2e command).

---

## Phase 10: Apply and Verify the Migration

**Goal:** Run migration on remote Supabase, verify with verification SQL.

**Depends on:** Phase 2 (migration file ready).

**Actions:**
1. Apply migration via `supabase db push` or Supabase Studio SQL editor.
2. Run verification SQL:
   ```sql
   select column_name, data_type, is_nullable
   from information_schema.columns
   where table_schema = 'public' and table_name = 'lojas'
   order by ordinal_position;
   ```
3. Confirm `cidade` (text, YES) and `estado` (varchar(2), YES) appear.
4. Run `select id, codigo, cidade, estado from lojas limit 5;` to confirm existing rows intact.

**Risks:**
- Remote migration state may be ahead of local — use `if not exists`.
- Cannot rollback if application code has already deployed and depends on new columns (but they're additive, so safe).

**Completion criteria:**
- Verification SQL returns expected columns.
- Existing rows unchanged.
- No errors in Supabase migration log.

**Validation:**
- SQL verification results captured.
- Manual sanity check via Supabase Studio.

---

## Phase 11: Run Full Validation and Update Documentation

**Goal:** Confirm all quality gates pass and update AGENTS.md.

**Depends on:** Phases 1-10 complete.

**Actions:**
1. Run `npm run validate` (check + test + smoke).
2. Update `AGENTS.md`:
   - Add migration filename to migration list.
   - Mark feature as completed in "Funcionalidades concluídas".
   - Remove from "Tarefas pendentes" if listed.
3. Update `docs/architectural-decisions.md` if any decision changed.

**Risks:**
- AGENTS.md has known documentation drift — review against current code.

**Completion criteria:**
- `npm run validate` passes.
- AGENTS.md updated.
- No stale references to removed fields in documentation.

**Validation:**
- `npm run validate`
- Manual review of AGENTS.md diff.

---

## Task Dependencies Graph

```
Phase 1 (investigation)
  ├──> Phase 2 (migration SQL) ──> Phase 10 (apply migration)
  ├──> Phase 3 (domain contract) ──> Phase 4 (remove fields) ──> Phase 5 (modal redesign) ──> Phase 6 (CSS cleanup)
  └──> Phase 7 (save/edit logic) ──> Phase 8 (frontend tests)
                                            │
                                            └──> Phase 9 (E2E) ──> Phase 11 (validate + docs)
```

## Validation Command Reference

| Command | Purpose |
|---------|---------|
| `npm run check` | Static validation |
| `npm test` | Unit tests |
| `npm run test:smoke` | Smoke/E2E tests |
| `npm run validate` | All of the above |

## Key Files to Change

| File | Change Type |
|------|-------------|
| `supabase/migrations/<timestamp>_add_cidade_estado_to_lojas.sql` | CREATE |
| `public/js/pages/stores/stores-module.js` | MODIFY |
| `public/index.html` | MODIFY (modal form + global bindings) |
| `public/styles/pages/stores.css` | MODIFY (cleanup) |
| `tests/frontend/stores.test.js` | CREATE |
| `supabase/verification/verify_lojas_columns.sql` | CREATE |
| `AGENTS.md` | MODIFY |

### Cleanup Guarantees

- Every `codigo` created by spec tracked in `disposableStoreCodigos[]` (pushed after `uniqueCodigo()` before any Supabase mutation).
- `test.afterAll()` deletes each tracked store via `supabaseRest` (service_role, bypasses RLS, throws on non-2xx).
- After deletion, `afterAll` re-queries each codigo and throws clear error if any record remains.
- No global `E2ESTORE_` pattern deletion — only exact codigo matches from this spec run.
- Unique `runId` embedded in store names for traceability.
- `afterAll` runs even if a test fails (Playwright guarantee).
