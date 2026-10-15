# Orphan Auth User Cleanup

## Problem  
Two auth users from prior E2E runs remain in `auth.users` without matching `profiles` records. Profiles were deleted (service_role `DELETE /rest/v1/profiles`) without deleting the auth user first. FK is `profiles(id) REFERENCES auth.users(id) ON DELETE CASCADE` — deleting auth cascades to profiles, but NOT vice versa.

## Orphans identified
- `6ea04e26-d9f2-473a-9a3c-09918416bbec` — `e2e-user-eor-1782230547415-26951d-req@dominio-valido.com`
- `f0215205-d2d5-4aa5-912f-272dc2677475` — `e2e-user-eor-1782230443357-bd3a38@dominio-valido.com`

No profiles, user_stores, audit_logs, or orders (FKs prevent orphans in child tables).

## Safety checks
1. Email domain matches `E2E_TEST_EMAIL_DOMAIN` from `.env.e2e`
2. Email starts with `e2e-user-`
3. Role in `app_metadata` is not `ADMIN`
4. Profile is absent (orphan) OR profile has E2E marker
5. ID is in explicit allowlist hardcoded in script

## Script: `scripts/maintenance/cleanup-orphan-e2e-users.js`
- Dry-run by default (reports what would be deleted)
- `--confirm` flag required for actual deletion
- Loads `.env` + `.env.e2e` directly
- Paginates Supabase Auth Admin API `GET /auth/v1/admin/users`
- For each candidate: runs all safety checks
- Deletion order: audit_logs (if profile exists) → auth user (GoTrue Admin API)
- Verification: GET auth user returns 404, GET profiles returns 0, GET user_stores returns 0, GET audit_logs returns 0
- Skips any candidate failing a safety check with exact reason

## Acceptance Criteria
1. Dry-run displays both orphans with safety checks
2. `--confirm` deletes both orphans
3. Each deleted auth ID verified individually (404)
4. Zero related rows in profiles, user_stores, audit_logs
5. No ADMIN or non-E2E users touched
6. Admin-users E2E still passes (existing cleanup pattern unchanged)

## Files Changed
- `scripts/maintenance/cleanup-orphan-e2e-users.js` — NEW one-time cleanup script

## Test Plan
1. `node scripts/maintenance/cleanup-orphan-e2e-users.js` — dry-run, verify output
2. `node scripts/maintenance/cleanup-orphan-e2e-users.js --confirm` — delete + verify
3. `npm run test:e2e -- tests/e2e/admin-users.spec.js --workers=1` — existing flow works
4. `npm run validate`
