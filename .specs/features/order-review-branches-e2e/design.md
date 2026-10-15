# Order Review Branches E2E — Design

## Test Architecture

### File Structure
```
tests/e2e/order-review-branches.spec.js
```

### Test Organization
- Single `test.describe.serial` block with two tests
- Shared `beforeAll` / `afterAll` for fixture lifecycle
- Each test uses unique correlation marker suffix
- One disposable USER created in `beforeAll`, reused for both orders
- ADMIN session established per test step as needed

### Session Flow

```
beforeAll:
  1. ADMIN login -> read token
  2. Fetch first active store (no hard-coded name)
  3. Create disposable USER (role=USER, store=first active store)
  4. Store USER credentials + ADMIN credentials + storeId in state

Test 1 (Approve):
  1. USER login -> /novo-pedido -> fill form -> submit
  2. Wait for order status = PENDING_APPROVAL
  3. ADMIN login -> /pedidos -> search order -> open drawer
  4. Click "Aprovar" (no reason required)
  5. Verify drawer closes, toast shows "Pedido aprovado."
  6. Backend: status = APPROVED, approval_reason = null
  7. Verify status_history has PENDING_APPROVAL -> APPROVED entry
  8. Verify audit_logs has ORDER_APPROVED entry
  9. USER login -> /pedidos -> verify status badge "Aprovado"
  10. USER open drawer -> verify no "Editar e reenviar" button
  11. ADMIN open drawer -> verify no "Aprovar", "Rejeitar", "Solicitar Edição"

Test 2 (Reject):
  1. USER login -> /novo-pedido -> fill form -> submit (different marker)
  2. Wait for order status = PENDING_APPROVAL
  3. ADMIN login -> /pedidos -> search order -> open drawer
  4. Fill rejection reason -> click "Rejeitar"
  5. Verify drawer closes, toast shows "Pedido rejeitado."
  6. Backend: status = REJECTED, rejection_reason = provided reason
  7. Verify status_history has PENDING_APPROVAL -> REJECTED entry with comment = reason
  8. Verify audit_logs has ORDER_REJECTED entry
  9. USER login -> /pedidos -> verify status badge "Rejeitado"
  10. USER open drawer -> verify rejection reason visible in history section
  11. USER open drawer -> verify no "Editar e reenviar" button
  12. ADMIN open drawer -> verify no "Aprovar", "Rejeitar", "Solicitar Edição"

afterAll:
  1. ADMIN login (fresh context)
  2. cleanupMarkerOrders(baseMarker) -> delete all marker orders
  3. deleteUserViaAdminApi -> delete disposable USER
  4. Verify findOrdersByMarker(baseMarker) returns empty
  5. Verify USER no longer exists via admin list API
```

## Fixture Lifecycle

| Fixture | Created | Cleaned Up | Scope |
|---------|---------|------------|-------|
| Disposable USER | `beforeAll` | `afterAll` | Shared |
| Approve order | Test 1 step | `afterAll` (marker-based) | Test 1 |
| Reject order | Test 2 step | `afterAll` (marker-based) | Test 2 |

### Correlation Markers
- Base marker: `orb-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
- Approve order marker: `${baseMarker}-approve`
- Reject order marker: `${baseMarker}-reject`
- Used in: order `notes`, `justification`, `purpose` fields for traceability

## Approve Flow

### UI Selectors
| Element | Selector |
|---------|----------|
| Orders page shell | `#orders-page-shell` |
| Search input | `#orders-search` |
| Order row | `#orders-table-body tr` |
| View button | `button[aria-label="Visualizar pedido"]` |
| Drawer overlay | `#drawer-overlay` |
| Drawer | `#drawer` |
| Approve button | `#drawer-footer button:has-text("Aprovar")` |
| Justification textarea | `#drawer-justificativa` |
| Status badge in list | `.status-badge` |
| Toast message | `#toast-msg` |

### Backend Verification (via `supabaseRest`)
```javascript
// Status
const order = await supabaseRest(
  `/rest/v1/orders?select=id,status,rejection_reason,approved_at,rejected_at&id=eq.${orderId}`
)

// History — look for specific transition, not total count
const history = await supabaseRest(
  `/rest/v1/status_history?select=id,previous_status,new_status,comment&order_id=eq.${orderId}&order=created_at.asc`
)

// Audit — exact entity filter
const audit = await supabaseRest(
  `/rest/v1/audit_logs?select=id,action,entity_id,created_at&entity=eq.orders&entity_id=eq.${orderId}&action=eq.ORDER_APPROVED`
)
```

### Expected Results
- `order.status === 'APPROVED'`
- `order.approved_at` not null
- `order.rejection_reason === null`
- `history` contains at least one entry with `previous_status: 'PENDING_APPROVAL'` and `new_status: 'APPROVED'`
- Exactly one such transition entry exists
- `audit` has exactly 1 entry with `action: 'ORDER_APPROVED'`

## Reject Flow

### Additional UI Selectors
| Element | Selector |
|---------|----------|
| Reject button | `#drawer-footer button:has-text("Rejeitar")` |
| Justification textarea | `#drawer-justificativa` (required for reject) |

### Backend Verification
```javascript
// Status
const order = await supabaseRest(
  `/rest/v1/orders?select=id,status,rejection_reason,approved_at,rejected_at&id=eq.${orderId}`
)

// History
const history = await supabaseRest(
  `/rest/v1/status_history?select=id,previous_status,new_status,comment&order_id=eq.${orderId}&order=created_at.asc`
)

// Audit — exact entity + action filter
const audit = await supabaseRest(
  `/rest/v1/audit_logs?select=id,action,entity_id,created_at&entity=eq.orders&entity_id=eq.${orderId}&action=eq.ORDER_REJECTED`
)
```

### Expected Results
- `order.status === 'REJECTED'`
- `order.rejected_at` not null
- `order.rejection_reason === providedReason`
- `history` contains at least one entry with `previous_status: 'PENDING_APPROVAL'` and `new_status: 'REJECTED'` and `comment === providedReason`
- Exactly one such transition entry exists
- `audit` has exactly 1 entry with `action: 'ORDER_REJECTED'`

## Immutability Assertions

### For ADMIN
1. Open drawer for final-state order (APPROVED or REJECTED)
2. Verify `#drawer-footer` contains no `<button>` elements
3. Verify `#drawer-justificativa-bloco` has class `hidden`
4. Verify status badge shows final state label ("Aprovado" / "Rejeitado")

### For USER
1. Open drawer for final-state order
2. Verify `#drawer-footer` contains no button with text "Editar e reenviar"
3. Verify status badge shows final state label

## Cleanup and Failure Recovery

### Cleanup Strategy
- `afterAll` uses fresh browser context
- Re-login as ADMIN if session expired
- Delete orders by marker prefix: `cleanupMarkerOrders(baseMarker)`
- Delete USER via `deleteUserViaAdminApi`
- Post-cleanup verification:
  - `findOrdersByMarker(baseMarker)` returns empty array
  - USER no longer exists in admin list API response

### Failure Recovery
- Each test step wrapped in `test.step()`
- Console errors + network failures captured via page listeners
- On failure: attach `e2e-debug.txt` with diagnostics
- `finally` block in `afterAll` ensures cleanup attempt even on test failure

## Diagnostics and Trace Strategy

### Page Event Listeners
```javascript
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('requestfailed', req => { networkFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'failed'}`) })
```

### Attachments on Failure
- `e2e-debug.txt`: console errors + network failures + target host

### Trace
- Playwright trace enabled via config (not in test code)
- Screenshots on failure via `testInfo.attach`

## Likely Affected Files

### New Files
- `tests/e2e/order-review-branches.spec.js` — main spec

### Reused Helpers (no changes)
- `tests/e2e/helpers/auth.js` — login/logout
- `tests/e2e/helpers/disposable-user-fixtures.js` — user/order CRUD
- `tests/e2e/helpers/users-admin.js` — admin API
- `tests/e2e/helpers/runtime.js` — env gates

### Helper Functions (local to spec)
- `approveOrderViaDrawer(page, orderId)` — local function
- `rejectOrderViaDrawer(page, orderId, reason)` — local function
- `assertOrderImmutable(page, orderId)` — local function
- `loadOrder(orderId)` — local function using `supabaseRest`

## Playwright Config Notes

- Test timeout: 120s (matching existing E2E specs)
- Worker count: 1 (serial tests, shared state)
- Base URL: from `E2E_BASE_URL` env

## Environment Requirements

| Variable | Required | Purpose |
|----------|----------|---------|
| `E2E_ALLOW_LIVE_READS` | true | Gate for live reads |
| `E2E_ALLOW_LIVE_WRITES` | true | Gate for live writes |
| `E2E_ALLOW_LIVE_CRUD` | true | Gate for live CRUD |
| `E2E_BASE_URL` | true | Target URL (default: http://127.0.0.1:3000) |
| `E2E_ADMIN_EMAIL` | true | ADMIN login |
| `E2E_ADMIN_PASSWORD` | true | ADMIN login |
| `E2E_TEST_USER_PASSWORD` | true | Disposable user password |
| `E2E_TEST_EMAIL_DOMAIN` | true | Disposable email domain |
| `SUPABASE_URL` | true | Supabase REST |
| `SUPABASE_SERVICE_ROLE_KEY` | true | Supabase admin access |

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Drawer timing flakiness | Medium | Test failure | Explicit waits for overlay + buttons; retry logic |
| Rejection reason not filled | Low | Test failure | Fill before click; verify field value |
| ADMIN session expiry in afterAll | Low | Cleanup failure | Re-login in afterAll |
| Marker collision | Very Low | Data leakage | Timestamp + random bytes |
| Store not available | Low | Setup failure | Use first active store, no name dependency |
| RPC not deployed | Low | Test skip | Gate via verification SQL |
