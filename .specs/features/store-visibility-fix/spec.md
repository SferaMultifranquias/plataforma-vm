# Store Visibility Fix

## Problem
`loadStores()` in `stores-module.js:158` hardcodes `.eq('ativo', true)` — filters out inactive stores at query level, *after* RLS. Admin cannot see/edit/reactivate inactive stores on `/lojas` page.

## Root Cause
Frontend query adds filter redundant for non-admin (RLS already enforces `ativo=true` for non-admin) and destructive for admin (RLS allows admin to see all stores).

RLS policy (`lojas_select_authenticated`):
```sql
using (
  auth.uid() is not null
  and public.current_user_is_active()
  and (public.is_admin() or lojas.ativo = true)
);
```

Admin: condition reduces to `auth.uid() is not null and current_user_is_active()` — ALL stores.
Non-admin: condition includes `lojas.ativo = true` — only active stores.

## Fix
Remove `.eq('ativo', true)` from `loadStores()`. RLS is authoritative.

## Acceptance Criteria
1. ADMIN sees active AND inactive stores in `/lojas` table
2. Inactive stores render with "Inativa" badge  
3. ADMIN can edit an inactive store
4. ADMIN can reactivate (toggle ativo) an inactive store — store reappears as "Ativa"
5. Non-admin USER cannot access `/lojas` page (frontend permission block) — RLS would also prevent seeing inactive stores
6. E2E cleanup unchanged — `test.afterAll` still deletes exact codigo matches via service_role

## Files Changed
- `public/js/pages/stores/stores-module.js` — remove `.eq('ativo', true)` in `loadStores()`
- `tests/e2e/store-crud.spec.js` — update deactivate test, add reactivation test

## Test Plan
1. store-crud E2E: deactivate store → verify row visible + Inativa badge
2. store-crud E2E: edit deactivated store → reactivate → verify Ativa badge
3. `npm run validate` — existing tests pass
