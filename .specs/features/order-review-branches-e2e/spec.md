# Order Review Branches E2E — Specification

## Objective

Add live Playwright coverage for the two remaining ADMIN order-review branches:
1. **Approve branch**: ADMIN approves a `PENDING_APPROVAL` order → `APPROVED` (final state)
2. **Reject branch**: ADMIN rejects a `PENDING_APPROVAL` order with required reason → `REJECTED` (final state)

Both branches must verify:
- Status transition is recorded in `status_history`
- Audit log entry is created (`ORDER_APPROVED` / `ORDER_REJECTED`)
- Final-state immutability: no edit, resubmit, approve, reject, or change-request actions are available
- USER sees the final status badge and (for rejection) the rejection reason in the drawer history

## Scope

### In Scope
- Two isolated serial tests in a new spec file: `tests/e2e/order-review-branches.spec.js`
- Reuse existing fixtures, helpers, and cleanup patterns
- Correlation markers for test isolation
- Disposable USER + ADMIN sessions
- Cleanup with post-cleanup verification

### Out of Scope
- Modifying existing `order-lifecycle-ui.spec.js` or `order-resubmit.spec.js`
- Adding new RPCs or backend changes
- Testing `confirmar` (delivery confirmation) branch
- Testing bulk approve/reject

## Acceptance Criteria

### Approve Branch
1. USER creates and submits an order → `PENDING_APPROVAL`
2. ADMIN opens order drawer, clicks "Aprovar" (no reason required)
3. Toast shows "Pedido aprovado.", drawer closes
4. `status_history` has entry: `PENDING_APPROVAL` → `APPROVED` (at least this one transition exists)
5. `audit_logs` has `ORDER_APPROVED` entry for `entity='orders'` and `entity_id=orderId`
6. USER sees status badge "Aprovado" in orders list
7. Drawer for approved order shows no action buttons:
   - ADMIN sees no "Aprovar", "Rejeitar", or "Solicitar Edição"
   - USER sees no "Editar e reenviar"
8. `rejection_reason` is null

### Reject Branch
1. USER creates and submits another order → `PENDING_APPROVAL`
2. ADMIN opens order drawer, fills rejection reason, clicks "Rejeitar"
3. Toast shows "Pedido rejeitado.", drawer closes
4. `status_history` has entry: `PENDING_APPROVAL` → `REJECTED` with comment matching reason
5. `audit_logs` has `ORDER_REJECTED` entry for `entity='orders'` and `entity_id=orderId`
6. USER sees status badge "Rejeitado" in orders list
7. USER sees rejection reason in drawer history section (as part of status_history comment)
8. Drawer for rejected order shows no action buttons:
   - ADMIN sees no "Aprovar", "Rejeitar", or "Solicitar Edição"
   - USER sees no "Editar e reenviar"
9. `rejection_reason` field in orders table matches provided reason

## Test Structure

### File: `tests/e2e/order-review-branches.spec.js`

```javascript
test.describe.serial('order review branches', () => {
  // Shared state for both tests
  const state = { marker, admin, store, user, approveOrder, rejectOrder };

  test.beforeAll(async ({ browser }) => {
    // Setup: admin login, fetch first active store, create disposable USER
  });

  test.afterAll(async ({ browser }) => {
    // Cleanup: delete orders by marker, delete user, verify nothing remains
  });

  test('ADMIN approves order → APPROVED (immutable)', async ({ page }) => {
    // USER creates + submits
    // ADMIN approves via drawer
    // Verify status, history, audit, UI immutability (USER + ADMIN)
  });

  test('ADMIN rejects order with reason → REJECTED (immutable)', async ({ page }) => {
    // USER creates + submits another order
    // ADMIN rejects via drawer with reason
    // Verify status, history, audit, UI immutability (USER + ADMIN), reason visible
  });
});
```

## Reusable Helpers

From existing helpers:
- `loginAsAdmin`, `loginAsDisposableUser`, `logout` (auth.js)
- `createDisposableUser`, `fetchActiveStores`, `deleteOrderArtifactsByOrderId`, `cleanupMarkerOrders`, `findOrdersByMarker`, `supabaseRest` (disposable-user-fixtures.js)
- `readAdminAccessToken`, `deleteUserViaAdminApi` (users-admin.js)
- `openOrdersPage`, `openOrderDrawerByNumber`, `selectAndFillOrderForm` (local to spec)

### New Helpers Needed (local to spec)
- `approveOrderViaDrawer(page, orderId)` — clicks "Aprovar", waits for drawer close + toast
- `rejectOrderViaDrawer(page, orderId, reason)` — fills reason, clicks "Rejeitar", waits for drawer close + toast
- `assertOrderImmutable(page, orderId)` — opens drawer, verifies no action buttons for ADMIN and USER roles
- `loadOrder(orderId)` — fetches order + status_history + audit_logs via supabaseRest

## Cleanup Design

- Correlation marker: `orb-${timestamp}-${random}`
- Each test creates its own order (different marker suffix)
- `beforeAll`: creates 1 disposable USER
- `afterAll`:
  1. Delete all orders matching marker via `cleanupMarkerOrders(baseMarker)`
  2. Delete USER via `deleteUserViaAdminApi`
  3. Verify `findOrdersByMarker(marker)` returns empty
  4. Verify USER no longer exists via admin list API
- Each test step wrapped in `test.step()`
- Console/network diagnostics attached on failure

## Risks

| Risk | Mitigation |
|------|------------|
| Flaky drawer interactions | Use explicit waits for drawer overlay/buttons |
| Rejection reason validation | Ensure reason is filled before click (UI + RPC enforce) |
| State leakage between tests | Unique marker per order; separate order IDs |
| Cleanup failure leaves data | `finally` blocks; marker-based cleanup; post-cleanup verification |
| ADMIN session expiry | Re-login in `afterAll` if needed |

## Dependencies

- Existing E2E infrastructure (Playwright, helpers, env vars)
- Live Supabase with `approve_order` and `reject_order` RPCs deployed
- At least one active store available (first from `fetchActiveStores()`)
- ADMIN credentials in env

## Test Execution

```bash
npm run test:e2e -- tests/e2e/order-review-branches.spec.js
```

## Implementation Phases

1. **Verify selectors, RPCs, and audit names** — confirm UI elements and backend exist
2. **Prepare helper strategy** — define local helper functions
3. **Implement APPROVED branch** — full test with UI + backend verification
4. **Implement REJECTED branch** — full test with UI + backend verification
5. **Add history, audit, reason, and immutability assertions** — strengthen assertions
6. **Validate cleanup** — verify afterAll removes all disposable data
7. **Run targeted E2E and full validation** — `npm run check`, `npm test`, `npm run test:e2e`
8. **Update backlog documentation** — after success

## Approval Gate

Implementation proceeds only after:
- This spec is reviewed and approved
- No new business decisions required (RPCs and UI already exist)
