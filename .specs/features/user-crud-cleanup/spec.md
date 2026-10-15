# User CRUD E2E Cleanup

## Problem

The admin-users E2E spec (`tests/e2e/admin-users.spec.js`) creates disposable USER accounts via the admin UI but does not reliably remove them after execution. Cleanup lives in `try/finally` within a single test, depends on the browser page being open, and has no DB-level fallback when the page or admin token is unavailable.

## Requirements

1. Wrap the spec in `test.describe()` with `test.afterAll()` for cleanup.
2. Track disposable email before first Supabase mutation.
3. Track user ID immediately after it becomes available from the API.
4. Delete dependent records before deleting Auth user, following actual FK cascade rules.
5. Use existing service-role Supabase helper (`supabaseRest` from `disposable-user-fixtures.js`).
6. Preserve the UI delete as the primary test assertion.
7. Treat Auth Admin 404 as acceptable only when UI delete already succeeded (user already gone).
8. Fail on every other unexpected cleanup error.
9. No `try/catch` swallowing in cleanup.
10. Verify directly: Auth user gone, profiles row gone, user_stores entries gone.

## FK Deletion Order

Confirmed from migrations:

1. `audit_logs` — `user_id` FK to `profiles(id)` WITHOUT `ON DELETE CASCADE` → must delete first
2. `auth.users(id)` — deleting via GoTrue admin API cascades to `profiles(id)` (ON DELETE CASCADE)
3. `profiles(id)` — cascades to `user_stores(user_id)` (ON DELETE CASCADE)
4. Verifications: Auth 404 expected (ok), profiles query empty, user_stores query empty

## Acceptance Criteria

- [ ] `afterAll` deletes tracked user from Auth, profiles, user_stores
- [ ] `afterAll` throws integrity error listing remaining IDs/emails if any record survives
- [ ] All 7 codebase docs updated (CODEx_CONTEXT.md, CONCERNS.md, feature task file)
- [ ] `npm run validate` passes
- [ ] DB inspection shows zero remaining disposable records
