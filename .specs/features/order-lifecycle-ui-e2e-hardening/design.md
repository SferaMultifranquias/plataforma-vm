# Design

## Approach
One serial Playwright spec validates full order lifecycle through UI for create, review, edit, and resubmit.

## Flow
1. Create disposable USER linked to active store.
2. USER logs in, creates order in `/novo-pedido`, uploads image, submits.
3. Read back created order id/internal number for UI lookup only.
4. ADMIN logs in, opens `/pedidos`, opens drawer, requests changes.
5. USER logs in, opens same order, enters edit mode, updates item data, resubmits.
6. Verify same order returns to `PENDING_APPROVAL`, items/images/history remain sane.
7. Verify retry/edit gate no longer allows immediate resubmit after success.
8. Cleanup disposable user and all order artifacts.

## UI Selectors
- Form: `#form-pedido`, `#f-loja`, `#f-tipo`, `#f-motivo`, `#items-container`, `#foto-input`, `#btn-submit-form`.
- Items: `#items-container [data-order-item="true"] [data-field="customerCode|description|quantity|notes"]`.
- Orders page: `#orders-search`, `#orders-table-body tr`, `button[aria-label="Visualizar pedido"]`, `#drawer-footer`, `#drawer-justificativa`.
- Edit mode: `#order-edit-banner`, `#btn-submit-label`.

## Verification
- Read-only Supabase queries only for order lookup, final status, item/image/history counts.
- Cleanup via service-role reads/writes in Node test process only.

## Risks
- UI selectors can drift.
- Live Supabase timing can be flaky.
- Browser bootstrap/session restore can fail if env or auth state is stale.
