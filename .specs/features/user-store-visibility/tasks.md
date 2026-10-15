# User Store Visibility — Tasks

## Task 1: Create verification SQL
**File:** `supabase/verification/20260622_verify_user_store_visibility.sql`

Verify current state of policies, functions, and data before migration.

**Verification criteria:**
- Reports all RLS policies on `lojas`, `orders`, `user_stores`
- Reports `create_order` and `user_can_access_store` function definitions
- Reports count of inactive stores, inactive profiles, and user_stores entries
- Reports any existing orders linked to inactive stores
- Read-only, no data changes

---

## Task 2: Create migration draft SQL
**File:** `supabase/migrations/20260622_restrict_user_store_visibility.sql`

**Changes:**
1. Create `current_user_is_active()` helper (security definer)
2. Update `lojas_select_authenticated` policy — filter `ativo = true` for non-admin
3. Update `orders_insert_own` policy — add `current_user_is_active()` check
4. Update `create_order` RPC — add active-user guard + active-store guard
5. Update `user_can_access_store` function — add active-user + active-store checks
6. Grant execute on new function

**Verification criteria:**
- `npm run check` passes
- `npm test` passes
- `npm run validate` passes
- Review or manual apply: all existing RLS/RPC definitions referenced by `DROP IF EXISTS` + `CREATE OR REPLACE`

---

## Task 3: Validate frontend store-loading logic (no-code review)
**Files:** `order-form-module.js:644-709`, `orders-data.js:324-387`

**Verify:**
- `loadStoresIntoSelect()` loads active stores, reloads assignments on init, and fail-closes on lookup error
- `loadAllowedStoreIds()` reads `user_stores` → RLS returns only self entries — correct
- Filter at line 674-677 works with cached authorized list — correct (set intersection)
- Empty-state message matches spec — `Nenhuma loja vinculada ao seu usuário` — correct
- Inactive stores never render
- Tampered store IDs are cleared before submit
- Direct-insert fallback `createOrderDirectly()` at line 349-387 calls `loadAllowedStoreIds` + checks `allowedStoreIds.has()` — correct
- Direct-insert fallback remains DB-gated by `orders_insert_own` and `create_order`

**Verification criteria:**
- Frontend fail-closed behavior implemented
- No fallback to all stores on lookup failure

---

## Task 4: Run validation suite
```bash
npm run check
npm test
npm run test:smoke
npm run validate
```

**Verification criteria:**
- All four commands pass
- No regressions in existing tests

---

## Task 5: Prepare E2E plan only
Define scenarios for ADMIN, USER (1 store, many stores, none, inactive), tamper, and cleanup.

**Verification criteria:**
- Plan only, no execution
- Microsoft Edge channel noted
- No secrets in logs
- No `SUPABASE_SERVICE_ROLE_KEY` in browser context

---

## Task 5: Report local vs remote policy/function differences *(requires remote access)*
Compare verification SQL output against known migration state.

**Verification criteria:**
- List any drift between local migrations and remote schema
- Flag if remote has different policy definitions
- No changes made — report only
