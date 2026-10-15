# Order Review Branches E2E — Tasks

## Phase 1: Verify selectors, RPCs, and audit names

**Actions:**
- Confirm `#drawer-footer button:has-text("Aprovar")` exists in current UI
- Confirm `#drawer-footer button:has-text("Rejeitar")` exists in current UI
- Confirm `#drawer-justificativa` and `#drawer-justificativa-bloco` elements exist
- Confirm `#drawer-footer` for final states (APPROVED/REJECTED) shows no buttons
- Confirm `#toast` and `#toast-msg` elements exist
- Confirm `approve_order(p_order_id uuid)` RPC returns orders record
- Confirm `reject_order(p_order_id uuid, p_reason text)` RPC requires non-empty reason
- Confirm audit actions `ORDER_APPROVED` and `ORDER_REJECTED` in `audit_logs` table

**Dependencies:** Live Supabase, existing E2E env, `supabase/verification/*.sql`
**Risks:** RPC not deployed → test cannot run
**Completion criteria:** All selectors confirmed, RPCs return expected shape, audit action names verified
**Validation command:** Manual inspection of UI and verification SQL

## Phase 2: Prepare helper strategy

**Actions:**
- Define local helper functions in spec file:
  - `approveOrderViaDrawer(page, orderId)` — clicks "Aprovar", waits for drawer close + toast
  - `rejectOrderViaDrawer(page, orderId, reason)` — fills reason, clicks "Rejeitar", waits for drawer close + toast
  - `assertOrderImmutable(page, orderId)` — opens drawer, verifies no mutation buttons for ADMIN and USER
  - `loadOrder(orderId)` — fetches order + history + audit via `supabaseRest`
- Decide function signatures and return shapes before writing tests
- Confirm `openOrdersPage`, `openOrderDrawerByNumber`, `selectAndFillOrderForm` signatures match existing spec helpers

**Dependencies:** Phase 1
**Risks:** Low — all patterns exist in `order-lifecycle-ui.spec.js`
**Completion criteria:** Helper signatures documented, no implementation yet
**Validation command:** `npm run check` passes

## Phase 3: Implement APPROVED branch

**Actions:**
- Create `tests/e2e/order-review-branches.spec.js` with gate check + `describe.serial`
- Add `beforeAll`:
  - ADMIN login → read token → fetch active store (first, no name match)
  - Create 1 disposable USER with first active store
- Add `test('ADMIN approves order → APPROVED (immutable)')`:
  - Step 1: USER login → /novo-pedido → fill form → submit → wait for PENDING_APPROVAL
  - Step 2: ADMIN login → /pedidos → search → open drawer → click "Aprovar"
  - Step 3: Verify drawer closes, toast shows "Pedido aprovado."
  - Step 4: Backend: status=APPROVED, approved_at not null, rejection_reason=null
  - Step 5: Verify status_history has PENDING_APPROVAL→APPROVED entry
  - Step 6: Verify audit_logs ORDER_APPROVED exists

**Dependencies:** Phase 2
**Risks:** Flaky drawer interactions
**Completion criteria:** Test passes against live Supabase
**Validation command:** `npm run test:e2e -- tests/e2e/order-review-branches.spec.js`

## Phase 4: Implement REJECTED branch

**Actions:**
- Add `test('ADMIN rejects order with reason → REJECTED (immutable)')`:
  - Step 1: USER login → /novo-pedido → fill form → submit → wait for PENDING_APPROVAL
  - Step 2: ADMIN login → /pedidos → search → open drawer → fill reason → click "Rejeitar"
  - Step 3: Verify drawer closes, toast shows "Pedido rejeitado."
  - Step 4: Backend: status=REJECTED, rejected_at not null, rejection_reason=provided reason
  - Step 5: Verify status_history has PENDING_APPROVAL→REJECTED entry with matching comment
  - Step 6: Verify audit_logs ORDER_REJECTED exists

**Dependencies:** Phase 2
**Risks:** Rejection reason must be filled before click (UI + RPC both enforce)
**Completion criteria:** Test passes against live Supabase
**Validation command:** `npm run test:e2e -- tests/e2e/order-review-branches.spec.js`

## Phase 5: Add history, audit, reason, and immutability assertions

**Actions:**
- Approve test additions:
  - Assert exactly one status_history entry with `PENDING_APPROVAL→APPROVED` (allow other entries)
  - Assert exactly one audit_logs entry with `ORDER_APPROVED`
  - Assert drawer immutability for ADMIN (no "Aprovar", "Rejeitar", "Solicitar Edição")
  - Assert drawer immutability for USER (no "Editar e reenviar")
- Reject test additions:
  - Assert exactly one status_history entry with `PENDING_APPROVAL→REJECTED` and matching comment
  - Assert exactly one audit_logs entry with `ORDER_REJECTED`
  - Assert rejection_reason matches provided reason
  - Assert rejection reason visible in drawer history section (status_history comment)
  - Assert drawer immutability for ADMIN (no action buttons)
  - Assert drawer immutability for USER (no "Editar e reenviar")

**Dependencies:** Phases 3, 4
**Risks:** History/audit count assumptions may fail if RPC called multiple times
**Completion criteria:** All assertions pass, no false positives
**Validation command:** `npm run test:e2e -- tests/e2e/order-review-branches.spec.js`

## Phase 6: Validate cleanup

**Actions:**
- `afterAll` implementation:
  - Fresh browser context → ADMIN login
  - `cleanupMarkerOrders(baseMarker)` — deletes all marker orders
  - `deleteUserViaAdminApi(page, userId, token)` — deletes USER
  - Verify `findOrdersByMarker(baseMarker)` returns empty array
  - Verify USER no longer exists via admin list API
- Test cleanup works even when individual test fails mid-way
- Verify no leftover data in Supabase after test run

**Dependencies:** Phase 2
**Risks:** Cleanup may fail if ADMIN session expired
**Completion criteria:** No disposable orders/users remain after test run, post-cleanup verification passes
**Validation command:** `npm run test:e2e -- tests/e2e/order-review-branches.spec.js`

## Phase 7: Run targeted E2E and full validation

**Actions:**
```bash
npm run check
npm test
npm run test:e2e -- tests/e2e/order-review-branches.spec.js
npm run validate
```

**Dependencies:** Phases 3—6
**Risks:** E2E requires live Supabase with all env vars configured
**Completion criteria:** All commands pass
**Validation command:** `npm run validate`

## Phase 8: Update backlog documentation after success

**Actions:**
- Update `AGENTS.md` section 11 (Funcionalidades concluídas) to include approve/reject E2E coverage
- Update `AGENTS.md` section 13 (Tarefas pendentes) if `order-review-branches-e2e` was listed
- Update `CODEx_CONTEXT.md` if applicable

**Dependencies:** Phase 7
**Risks:** Low
**Completion criteria:** Documentation reflects current test coverage, `npm run check` passes
**Validation command:** `npm run check`
