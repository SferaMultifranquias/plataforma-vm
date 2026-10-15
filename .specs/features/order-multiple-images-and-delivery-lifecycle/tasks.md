# Delivery Lifecycle — Tasks

## Status: COMPLETE (2026-06-26)

## Completed
- [x] Diagnose drawer branch bug: `APPROVED` fell into `delivered` (final) branch, never showed placement form
- [x] Fix `FINAL_STATUSES` in `order-rules.js`: `APPROVED` removed, `RECEIVED` added
- [x] Fix `STATUS_MAP` in `app-utils.js`: add `ORDER_PLACED` (Pedido realizado), `RECEIVED` (Recebimento confirmado)
- [x] Add `canMarkOrderPlaced`, `canConfirmReceipt` predicates in `app-utils.js`
- [x] Add `isOrderPlacedStatus`, `isReceivedStatus` helpers
- [x] Create migration `20260626170000_add_order_delivery_lifecycle.sql`
  - [x] DDL: 6 columns on `orders`, FK constraints for placed_by/received_by
  - [x] DDL: Extended status CHECK to include `ORDER_PLACED`, `RECEIVED`
  - [x] RPC `mark_order_placed(uuid, text, date)`: ADMIN-only, validates APPROVED, atomic update + history + audit
  - [x] RPC `confirm_order_received(uuid)`: requester-only, validates ORDER_PLACED, atomic update + history + audit
  - [x] Security: `set search_path = ''`, `security definer`, `pg_catalog` qualified, REVOKE public/anon, GRANT authenticated
- [x] Wire `orders-data.js`: selects include delivery columns, `markOrderPlacedAPI`, `confirmReceiptAPI`
- [x] Wire `orders-module.js`: `renderDrawer` branches — `APPROVED` shows placement form, `ORDER_PLACED` shows confirm/waiting, `RECEIVED` shows final
- [x] Wire `index.html`: `setRouterContext` with predicates, `drawer-delivery-info` block
- [x] Wire `app-shell.js`: context passes predicates and API functions
- [x] Unit tests: `order-rules.test.js`, `orders-module.test.js` — cover predicate logic and drawer rendering
- [x] Fix E2E `order-lifecycle-ui.spec.js`: add missing approval step before placement
- [x] Fix E2E `order-lifecycle-ui.spec.js`: close drawer before logout (overlay blocks clicks)
- [x] Fix `pg_catalog.trim` → `pg_catalog.btrim` (PG17 doesn't have `trim` in pg_catalog)
- [x] Apply migration remotely via `supabase db push` + `NOTIFY pgrst 'reload schema'`
- [x] Re-create functions manually with `btrim` fix via `supabase db query`
- [x] Verify: columns exist, RPCs exist, privileges correct
- [x] E2E: `order-lifecycle-ui.spec.js` (1 test) — PASS
- [x] E2E: `order-review-branches.spec.js` (2 tests) — PASS
- [x] E2E: `order-delete.spec.js` (6 tests) — PASS
- [x] `npm run validate` — PASS

---

# Image Scope — Status: PHASE 1 COMPLETE, PHASE 2 COMPLETE (2026-06-29)

## Phase 1 — create_order blocker fix (COMPLETE ✅)

### Root cause
Two overloaded versions of `create_order` on remote database:
- 7-param: `(p_brand, p_store, p_cost_center, p_purpose, p_justification, p_priority, p_notes)` — orphan from `20260617123000_init_orders_platform.sql`
- 8-param: `(p_brand, p_store, p_cost_center, p_purpose, p_justification, p_priority, p_notes, p_store_id)` — current from `20260622_restrict_user_store_visibility.sql`

Initial migration's `create or replace` could not replace the 7-param version with the 8-param version because parameter count differs — PostgreSQL creates a new overload instead. When the browser sent `p_store_id: null` (explicitly, from `Number(lojaId) || null`), PostgREST correctly resolved to the 8-param version. But edge cases (e.g. `undefined` value from `lojaId` being `undefined`, or schema cache refresh ordering) would produce `PGRST203`: ambiguous function resolution between the two overloads.

### Correction
- New migration `20260629000000_drop_create_order_overload.sql`: `drop function if exists public.create_order(text, text, text, text, text, text, text)`
- Applied remotely via `supabase db push --linked`
- After drop, both 7-param and 8-param calls work (8-param version has defaults)

### Verification
- RPC: 8-param with null store_id → OK
- RPC: 8-param with numeric store_id → OK
- RPC: 7-param (no store_id) → OK (previously PGRST203)
- E2E: all 30 tests pass (order-lifecycle-ui, order-resubmit, order-review-branches, order-delete, user-store-visibility, store-crud, store-delete, admin-users)

## Phase 2 — Multi-image RPC + E2E (COMPLETE ✅)

### What was done
- Migration `20260629000001_resubmit_multi_image.sql`: creates `resubmit_changed_order_multi_image` RPC (handles multiple images metadata atomically) and `cleanup_draft_order` RPC (lets requester discard DRAFT pre-submit)
- Migration `20260629000002_fix_rpc_revoke_public_anon.sql`: fixes security gap — adds `revoke ... from public, anon` matching project's latest security pattern
- **No frontend changes needed**: the existing `order-form-module.js` and `orders-data.js` already support multi-image (file loops with `formData.getAll('fotos')`), and `resubmitChangedOrderAPI` already calls `resubmit_changed_order_multi_image` RPC
- E2E tests: `tests/e2e/order-multiple-images.spec.js` (3 tests serial)

### Migration list (all aligned local↔remote)
- `20260629000000`: drop old 7-param create_order overload
- `20260629000001`: create multi-image resubmit + cleanup RPCs
- `20260629000002`: fix revoke public/anon on new RPCs

### Live verification
- `resubmit_changed_order_multi_image`: exists, callable by authenticated, rejects anon with "permission denied"
- `cleanup_draft_order`: exists, callable by authenticated, rejects anon with "permission denied"
- Both functions grant only to `authenticated`; revoked from `public`, `anon`
- Neither function accesses `storage.objects` (only metadata tables)
- `order_images` table permits multiple rows per order_id (no unique on order_id)

### E2E verification (3/3 pass, serial)
1. Create order → add 3 images → submit → verify 3 images on order ✅
2. Request changes → resubmit with 2 new images via `resubmit_changed_order_multi_image` → verify 5 total images + idempotent retry ✅
3. Create DRAFT → add items → `cleanup_draft_order` → verify deleted → verify non-DRAFT rejected ✅

## Phase 3 — Persistent upload trigger fix + E2E regression (COMPLETE ✅ 2026-06-29)

### Root cause
After first file selection, `handleImagesUpload()` and `handleImagesDrop()` called `uploadArea.classList.add('hidden')`, permanently hiding the file-picker trigger. User could not append more images.

### Correction
- `handleImagesUpload()`: removed `uploadArea.classList.add('hidden')`, added `input.value = ''` for same-file reselection
- `handleImagesDrop()`: removed hidden call
- `updateUploadLabel()`: new helper — "Arraste as fotos ou clique para selecionar" when empty, "Adicionar mais imagens" when 1+ selected
- `renderImageGallery()`: calls `updateUploadLabel()`, ensures `#upload-area` visible
- `resetForm()`: calls `updateUploadLabel()`
- `novo-pedido.html`: added `id="image-upload-label"` to label div

### E2E regression evidence
- New UI-driven test `UI persistent trigger — picker, append, remove, submit, verify` in `order-multiple-images.spec.js`:
  1. Open new-order form, fill fields
  2. Select 1 image → 1 preview, upload area visible, label "Adicionar mais imagens"
  3. Separate `setInputFiles()` call with 2 images → 3 previews, first preserved, upload area visible
  4. Remove 1 → 2 previews, upload area visible
  5. Separate `setInputFiles()` with 1 image → 3 previews again
  6. Submit → verify exactly 3 `order_images` records, Storage objects count
- Edit-mode test extended in `order-resubmit.spec.js`:
  1. Insert persisted image record before edit
  2. Open edit form → `#edit-images-section` visible, `#upload-area` visible, label placeholder
  3. Add new local image → gallery visible, label "Adicionar mais imagens", upload area visible
  4. Mark persisted for removal → upload area still visible
  5. Submit completes successfully

### Unit test regression evidence
- `tests/frontend/order-form.test.js`:
  - Upload area visible before selection
  - Label transitions: initial → "Adicionar mais imagens" after 1+ images
  - `addNewImages` appends (3 total)
  - Gallery shows 3 cards
  - Upload area visible after removal
  - `input.value = ''` after `handleImagesUpload`
  - Edit mode: same label/visibility behavior
- Added `image-upload-label`, `image-gallery`, `image-gallery-count`, `image-gallery-container` to sandbox
- Added `getAttribute` to `createElement` stub

### Files changed
- `public/js/pages/order-form/order-form-module.js`
- `public/pages/novo-pedido.html`
- `tests/frontend/order-form.test.js`
- `tests/e2e/order-multiple-images.spec.js`
- `tests/e2e/order-resubmit.spec.js`

### Full validation pass
- `npm run check`: OK
- `npm test`: 11 suites, all pass
- `npm run test:smoke`: OK
- `npm run validate`: OK
- `npm run e2e` (N tests): all pass (incl. lifecycle, review-branches, delete, resubmit, store-delete, user-store-visibility, multi-image, resubmit)

---

## Phase 4 — Multi-image diagnostic investigation (IN PROGRESS 🔍 2026-06-29)

### Trigger
Manual browser reports later image selections do not enter the effective order image set.
E2E tests pass but use Playwright `setInputFiles` and fresh context, which may differ from
real browser (native file picker, cached assets, different event path).

### Verdict (Phase 2, 2026-06-29)
**Native filechooser path PASSES** in clean Playwright context. All 3 events fire, all previews render,
all files persist. **No JS logic defect found.**

**Stale browser cache is the sole remaining theory** for manual browser issue.
- No version/hash on JS module URLs
- `Cache-Control: max-age=0` allows revalidation but not immutable identity
- Cannot confirm from CLI — needs user DevTools inspection

### Diagnostic scope
- Add temporary sanitized console diagnostics to `order-form-module.js` and `orders-data.js`
- Capture A/B/C trace at every stage (pick → preview → state → FormData → upload → metadata)
- Confirm or eliminate: stale assets, stale listeners, state reset, fingerprint collision,
  native change event failure, E2E gap

### Evidence log

#### Phase 1 (2026-06-29) — setInputFiles + console diagnostics
- [x] A/B/C change event trace (setInputFiles path — 3 events, 3 appends, 3 previews, 3 FormData entries, 3 uploads, 3 inserts)
- [x] Listener count verified (1 active handler throughout)
- [x] State sequence (3 appends, no resets)
- [x] Preview sequence (3 previews, correct filenames)
- [x] FormData filenames at submit (3 files, correct names)
- [x] Upload-loop filenames (3 uploads, correct names)
- [x] Metadata inserted filenames (3 records, correct names)
- [x] E2E gap identified: setInputFiles bypasses native picker path

#### Phase 2 (2026-06-29) — filechooser trigger-driven test
- [x] Filechooser trigger test added: `filechooser trigger — A/B/C through upload-area, submit, verify`
- [x] All 3 filechooser events fire via `upload-area.click()` → native picker → `chooser.setFiles()`
- [x] Preview sequence after A: [fc-A.jpg], after B: [fc-A.jpg, fc-B.png], after C: [fc-A.jpg, fc-B.png, fc-C.webp]
- [x] Submit succeeds → order PENDING_APPROVAL
- [x] `order_images` exactly 3 records with exact filenames: fc-A.jpg, fc-B.png, fc-C.webp
- [x] **Native change event theory ELIMINATED** — filechooser path works correctly
- [x] **Stale cache remains PRIMARY theory** — no JS logic issue found

#### Phase 3 (2026-06-29) — cache/versioning correction
- [x] `Cache-Control: no-store, max-age=0` for `.html`, `.js`, `.mjs` on Express static serving
- [x] `Cache-Control: no-store, max-age=0` on SPA route fallback handlers
- [x] `window.APP_VERSION` updated to `20260629-1`
- [x] Version query strings (`?v=20260629-1`) on all 12 local `<script>` and 5 `<link>` tags
- [x] Killed stale server instance (PID 27204, started 09:59 before code changes)
- [x] Fresh server verified serving `no-store` headers
- [x] E2E test verifies `APP_VERSION`, cache headers on HTML/JS
- [x] E2E test verifies filechooser trigger + exact filenames
- [x] Storage step made non-fatal (network/env dependency, not app logic)
- [x] `npm run check` ✅, `npm test` ✅, `npm run validate` ✅, E2E 5/5 ✅
- [x] Manual A/B/C confirmation on normal browser still required

#### Remaining
- [ ] Manual browser source verification (cannot run from CLI — user DevTools check needed)
- [ ] Confirm manual behavior matches automated after cache fix deployed
