# Resubmit False Toast Fix

## Problem
After successful order resubmit (CHANGES_REQUESTED → PENDING_APPROVAL), toast "Não foi possível abrir pedido para edição." appears incorrectly. In earlier attempts, submit was also blocked by a validation error ("Informe a justificativa.").

## Root Cause (Dual)

### Primary Blocker — Missing `#f-justification` element
`public/pages/novo-pedido.html` did not contain an element with `id="f-justification"`.
`populateFormFromOrder()` in `public/js/pages/order-form/order-form-module.js` called
`setElementValue('f-justification', justification)` — a silent no-op against a non-existent element.

`setSelectValue('f-motivo', justification)` set the `<select>` to a free-text value not present
in its predefined options (`Falta de estoque`, `Produto danificado`, `Reposição operacional`, `Outro`).
Chromium set `selectedIndex = -1`; `selectedOptions` returned empty.
`syncGeneralStateFromDom()` resolved justification as `''`.
`validateGeneralData` failed with `'Informe a justificativa.'`. Submit never executed.

### Secondary — Stale `orderId` URL Parameter
After a successful resubmit, `resetForm()` cleared form state but left the `orderId` query
parameter in the browser URL. Re-init via `afterRenderForm` → `handleRouteChange({ force: true })`
read the stale `orderId` from the URL, loaded the now-`PENDING_APPROVAL` order, and
`canEditOrder` returned false. The catch block emitted the false error toast.

### Sequence (Combined)
1. User opens `/novo-pedido?orderId=X` (CHANGES_REQUESTED)
2. `afterRenderFormulario` loads order, `canEditOrder` passes, `populateFormFromOrder` runs
3. `populateFormFromOrder` writes justification to `f-motivo` (select) and `f-justification` (non-existent — silent no-op)
4. `f-motivo` value does not match an option; Chromium sets `selectedIndex = -1`
5. User edits items and clicks submit
6. `syncGeneralStateFromDom` reads `f-motivo` → empty → no `f-justification` fallback → justification = `''`
7. Validation fails: "Corrija os campos destacados." / "Informe a justificativa."
8. User cannot submit — primary blocker prevents any resubmission attempt

### Post-Fix Flow
8. `#f-justification` exists in the partial. `setElementValue('f-justification', ...)` persists the value.
9. User edits items and clicks submit
10. `resubmit_changed_order` RPC succeeds → `PENDING_APPROVAL`, same `order_id`
11. `showToast` emits success "Pedido enviado! Protocolo ..."
12. `resetForm()` clears form state
13. `history.replaceState` strips `orderId` from URL before re-init
14. `afterRenderForm` → `handleRouteChange` → no `params.orderId` → loads CREATE mode
15. No false error toast emitted
16. Reopening the same `orderId` while `PENDING_APPROVAL` correctly blocked by `canEditOrder`

## Requirements
- RFT-001 Hidden `#f-justification` element must exist in `novo-pedido.html` to preserve
  free-text justification values that do not match predefined `f-motivo` options
- RFT-002 After successful submit/resubmit, URL must not contain stale `orderId` param
- RFT-003 Only `orderId` param cleared — unrelated params, hash, history state preserved
- RFT-004 No edit-load attempt during post-submit re-init when orderId absent
- RFT-005 Success toast displayed, false error toast not displayed
- RFT-006 Order status, history, audit unchanged — same order_id preserved
- RFT-007 canEditOrder, isEditableOrderStatus, RLS unchanged
- RFT-008 Legitimate edit-load errors still produce error notification
- RFT-009 Reopening PENDING_APPROVAL order for editing still blocked

## Scope Notes
- Frontend-only fix: `novo-pedido.html` and `order-form-module.js`
- No backend changes, no migration, no RPC changes
- Hidden-field lifecycle:
  - `novo-pedido.html`: `<textarea id="f-justification" class="hidden" aria-hidden="true">` (no `name`, not submitted with form)
  - `populateFormFromOrder()` hydrates: `setElementValue('f-justification', ...)`
  - `resetForm()` clears: `setElementValue('f-justification', '')`
  - `syncGeneralStateFromDom()` reads as final fallback: `getElement('f-justification')?.value?.trim() || ''`
- URL cleanup via `history.replaceState` before re-init in `submitForm()` success path
