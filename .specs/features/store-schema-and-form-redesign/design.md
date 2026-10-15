# Design — Store Schema and Form Redesign

## 0. Modal Redesign Addendum

Current UI target: attached approved image.

### Final Modal Hierarchy

```html
Modal overlay
└── Modal panel
    ├── Header
    │   ├── Store icon
    │   ├── Title
    │   ├── Subtitle
    │   └── Close button
    ├── Hidden ID field
    ├── Scrollable body
    │   ├── Informações da Loja
    │   ├── Identificação
    │   ├── Localização
    │   └── Status (edit only)
    └── Footer
        ├── Cancelar
        └── Criar loja / Salvar alterações
```

### Selector Preservation

Keep existing IDs: `#modal-loja`, `#modal-loja-titulo`, `#modal-loja-btn-save`, `#fl-id`, `#fl-codigo`, `#fl-nome`, `#fl-marca`, `#fl-cidade`, `#fl-estado`, `#fl-ativo-wrapper`, `#fl-ativo`.

Keep direct panel selector: `#modal-loja > div`.

Add only `#modal-loja-subtitle`.

### Responsive Goal

Panel width: `width: min(860px, calc(100vw - 2rem))`.

Body scrolls. Footer stays visible. No horizontal overflow.

### Accessibility Goal

Dialog semantics, linked labels, initial focus on `#fl-nome`, Escape close, focus return to opener, and minimal focus trap only inside modal.

## 1. Nullable Initial Migration

```sql
-- migration: YYYYMMDDHHMMSS_add_cidade_estado_to_lojas.sql

alter table public.lojas
    add column if not exists cidade text,
    add column if not exists estado varchar(2);
```

Both columns nullable → existing rows remain valid. No `DEFAULT`, no `NOT NULL`, no data copy.

### Data-Completion Strategy (Separate Step)

After migration is applied:

1. Run `scripts/admin/sync-store-fields.js` (to be created):
   - Query existing rows where `cidade IS NULL AND estado IS NULL`.
   - Skip — no source of truth exists for endereco/cidade/uf data (it was never persisted).
   - Output report of skipped rows and instructions for manual completion.

2. If future `NOT NULL` constraint is desired:
   - Ensure all rows have values for both columns.
   - Run `alter table public.lojas alter column cidade set not null, alter column estado set not null;`
   - This is a separate decision, not part of this feature.

### Rollback

```sql
alter table public.lojas drop column if exists cidade, drop column if exists estado;
```

## 2. Frontend Field Mapping

| Element ID | Property | DB Column | Type | Notes |
|------------|----------|-----------|------|-------|
| `fl-codigo` | `codigo` | `codigo` | `text` | required |
| `fl-nome` | `nome` | `nome` | `text` | required |
| `fl-marca` | `marca` | `marca` | `text` | required, select O Boticario/QDB |
| `fl-cidade` | `cidade` | `cidade` | `text` | optional |
| `fl-estado` | `estado` | `estado` | `varchar(2)` | optional, uppercase |
| `fl-ativo` | `ativo` | `ativo` | `boolean` | hidden in create, shown in edit |

Element IDs renamed: `fl-uf` → `fl-estado`. All local variables, payload keys, and `getElementById` references updated accordingly.

## 3. Form State and Payload Construction

### State Object

```js
const formState = {
    codigo: elemento('fl-codigo').value.trim(),
    nome: elemento('fl-nome').value.trim(),
    marca: elemento('fl-marca').value,
    cidade: elemento('fl-cidade').value.trim(),
    estado: elemento('fl-estado').value.trim().toUpperCase(),
    ativo: elemento('fl-ativo').value === 'true',
};
```

### Create Payload

```js
const payload = {
    codigo: state.codigo,
    nome: state.nome,
    marca: state.marca,
    ativo: state.ativo,
    cidade: state.cidade || null,
    estado: state.estado || null,
};
```

### Edit Payload

Same as create payload. The ID is passed separately for the update call.

## 4. Create/Edit Hydration

### Create

Default state: `codigo='', nome='', marca='O Boticario', cidade='', estado='', ativo=true`.

### Edit (via `editarLoja(id)`)

1. Fetch the store by ID or use cached row from the table.
2. Populate form fields:
   ```js
   elemento('fl-codigo').value = store.codigo;
   elemento('fl-nome').value = store.nome;
   elemento('fl-marca').value = store.marca;
   elemento('fl-cidade').value = store.cidade || '';
   elemento('fl-estado').value = store.estado || '';
   elemento('fl-ativo').value = store.ativo ? 'true' : 'false';
   ```
3. Store the editing ID in `fl-id` hidden input.
4. Lock `codigo` field if desired (UX decision — current code does not lock it).

## 5. Modal Structure

Same inline modal in `index.html`. Restructured form section:

```html
<!-- Title and close -->
<div class="flex items-center justify-between mb-5">
  <h3 id="modal-loja-titulo" class="font-semibold text-slate-900 text-lg">Nova Loja</h3>
  <button onclick="fecharModalLoja()" class="p-1.5 hover:bg-slate-100 rounded-lg">
    <i data-lucide="x" class="w-4 h-4 text-slate-500"></i>
  </button>
</div>
<input type="hidden" id="fl-id">

<!-- Form fields in grid -->
<div class="space-y-3">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div>
      <label class="form-label">Código <span class="text-red-500">*</span></label>
      <input id="fl-codigo" type="text" class="form-input" placeholder="Ex: 0342" maxlength="10">
    </div>
    <div>
      <label class="form-label">Marca <span class="text-red-500">*</span></label>
      <select id="fl-marca" class="form-select">
        <option value="O Boticario">O Boticario</option>
        <option value="QDB">QDB</option>
      </select>
    </div>
    <div class="md:col-span-2">
      <label class="form-label">Nome da Loja <span class="text-red-500">*</span></label>
      <input id="fl-nome" type="text" class="form-input" placeholder="Ex: Shopping Iguatemi" maxlength="100">
    </div>
    <div>
      <label class="form-label">Cidade</label>
      <input id="fl-cidade" type="text" class="form-input" placeholder="São Paulo" maxlength="50">
    </div>
    <div>
      <label class="form-label">Estado</label>
      <input id="fl-estado" type="text" class="form-input" placeholder="SP" maxlength="2"
             style="text-transform:uppercase">
    </div>
  </div>

  <!-- Status (edit only) -->
  <div id="fl-ativo-wrapper" class="hidden">
    <label class="form-label">Status</label>
    <select id="fl-ativo" class="form-select">
      <option value="true">Ativa</option>
      <option value="false">Inativa</option>
    </select>
  </div>
</div>

<!-- Buttons -->
<div class="flex gap-3 mt-6">
  <button onclick="fecharModalLoja()" class="btn-secondary flex-1 justify-center">Cancelar</button>
  <button onclick="salvarLoja()" class="btn-primary flex-1 justify-center">
    <i data-lucide="save" class="w-4 h-4"></i> Salvar
  </button>
</div>
```

## 6. Layout: Desktop Two-Column, Mobile Single-Column

Uses Tailwind grid: `grid grid-cols-1 md:grid-cols-2 gap-3`.

- `codigo` + `marca` share the first row on desktop (two columns), stack on mobile.
- `nome` spans full width (`md:col-span-2`).
- `cidade` + `estado` share a row on desktop.
- `ativo` wrapper is hidden on create, shown on edit (full width).

Horizontal overflow eliminated by:
- Removing the 5 removed fields (endereco, responsavel, telefone, email).
- Using `gap-3` consistently.
- Modal container: `max-w-lg mx-4` ensures margins on small screens.
- `overflow-y-auto` on the modal container.

## 7. Shared CSS Classes to Reuse

| Class | Source | Used For |
|-------|--------|----------|
| `.form-label` | `index.html:52` | All field labels |
| `.form-input` | `index.html:53` | Text inputs |
| `.form-select` | `index.html:54` | Select dropdowns |
| `.btn-primary` | `index.html:50` | Save button |
| `.btn-secondary` | `index.html:51` | Cancel button |
| `.modal-overlay` | `index.html:67` | Modal backdrop |

No new CSS classes needed for the form. The stores page already has `stores.css` — remove any obsolete styles for removed fields.

## 8. Table-Column Changes

**Before (current):**
`<th>Código</th> <th>Loja</th> <th>Marca</th> <th>Responsável</th> <th>Status</th> <th>Ações</th>`

**After:**
`<th>Código</th> <th>Loja</th> <th>Marca</th> <th>Cidade</th> <th>Status</th> <th>Ações</th>`

`Responsável` replaced by `Cidade`. The `cidade` cell renders `row.cidade || '-'`.

Mobile responsive rendering (`renderMobileRow`) updated to show cidade instead of responsavel.

Empty-state `colspan` adjusted from 6 to 6 (same count — one column removed, one added). Wait — current colspan should be verified. If current is 6 (codigo, loja, marca, responsavel, status, acoes) and new is also 6 (codigo, loja, marca, cidade, status, acoes), colspan stays 6.

## 9. Validation and Error Presentation

Client-side validation runs before submit:

```js
const errors = [];
if (!state.codigo) errors.push('Código é obrigatório.');
if (!state.nome) errors.push('Nome da loja é obrigatório.');
if (!['O Boticario', 'QDB'].includes(state.marca)) errors.push('Selecione uma marca.');
if (state.estado && !/^[A-Z]{2}$/.test(state.estado)) errors.push('Estado deve ter 2 letras maiúsculas.');

if (errors.length) {
    showToast(errors.join(' '), 'error');
    return;
}
```

On Supabase error: `showToast(error.message, 'error')`.

On success: `showToast('Loja salva com sucesso.', 'success')`.

## 10. Tests

### Frontend Tests (`tests/frontend/stores.test.js` — NEW)

| Test | Description |
|------|-------------|
| Renders create modal with correct fields | Verify all 5 form fields exist, endereco/responsavel/telefone/email absent |
| Renders edit modal with hydrated data | Verify cidade and estado populate, ativo wrapper shown |
| Submits correct payload | Stub Supabase, verify payload has only 6 contract fields |
| Validates required fields | Empty codigo/nome shows error toast |
| Validates estado format | Invalid estado (123, abc, A) shows error toast |
| Table renders cidade column | Verify Cidade header, row data, mobile rendering |
| Empty-state colspan correct | Verify colspan matches column count |

### Live E2E (Playwright, manual step)

| Scenario | Description |
|----------|-------------|
| Create store | Fill form, submit, verify row appears with correct data |
| Edit store | Click edit, verify hydration, change cidade/estado, save, verify update |
| Deactivate store | Edit, set status inactive, save, verify badge/text changes |
| Responsive layout | Resize viewport, verify single-column on mobile, two-column on desktop |
| Cleanup | Delete created test stores via admin or direct DB |

## 11. Migration Rollback

```sql
alter table public.lojas drop column if exists cidade, drop column if exists estado;
```

Rollback is safe if no application code references these columns. Confirm no queries, triggers, or views depend on them before rollback.

## 12. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RLS policies reference removed fields | Low | High | Audit before migration |
| Frontend stale cache stores old field list | Low | Medium | Invalidate `_lojasCache` on save |
| `loadStores()` query omits new columns | Medium | High | Update select to include `cidade,estado` |
| Backend route references old fields | Low | Low | Audit `users-admin.js` references |
| Users module references old fields | Low | Low | Audit `users-module.js` / `users-data.js` |
| Missing campo endereco confuses users who need it | Medium | Low | Document as intentional simplification in release notes |
