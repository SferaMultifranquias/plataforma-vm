# Order Details Drawer UI Cleanup

## Goal
Clean up the order-details drawer: remove Referência Externa and Valor Total summary cards, rebalance remaining cards, and improve justification textarea width/height/border/focus states. Drawer-presentation only — no database, API, or backend changes.

## Scope
- Drawer summary: 4 cards → 2 cards (Loja, Data do Pedido)
- Remaining cards fill row via `orders-drawer-summary-grid` (2-column CSS grid, 1fr each)
- Responsive fallback: single column on <=480px
- Justification textarea: full drawer content width, visible border, focus ring, min-height 140px, comfortable padding, vertical resize
- JS assignments to removed IDs removed or null-guarded
- Frontend tests and E2E regression updated

## Out of Scope
- Database schema, API responses, frontend mappings, dashboard calculations, table views
- Referência Externa (`numero_antilhas`) and Valor Total (`valor_total`) fields
- Order creation, multiple-image behavior, approval/rejection rules, delivery lifecycle
- Migrations, RPCs, Storage policies, authentication

## Files Changed
- `public/index.html` — drawer summary markup
- `public/js/pages/orders/orders-module.js` — removed element assignments
- `public/styles/pages/orders.css` — new grid class, strengthened textarea
- `tests/frontend/orders-module.test.js` — removed/present assertions
- `tests/e2e/order-review-branches.spec.js` — drawer UI assertions
- `.specs/codebase/workflows.md` — if drawer structure documented
- `CODEx_CONTEXT.md` — update state

## Acceptance Criteria
- Referência Externa card absent from drawer
- Valor Total card absent from drawer
- Loja card present
- Data do Pedido card present
- Two cards fill row in 2-column grid (responsive to 1-col)
- `#drawer-justificativa` present
- Textarea full drawer content width, visible border, accessible focus, min-height 140px, vertical resize
- No horizontal overflow
- Removed IDs tolerated by renderDrawer
- Pending-ADMIN drawer renders Solicitar Edição, Rejeitar, Aprovar
- Justification text still passed to `decidirPedidoAPI`
- Hard-delete action unaffected
- `npm run check`, `npm test`, `npm run validate`, E2E all pass
