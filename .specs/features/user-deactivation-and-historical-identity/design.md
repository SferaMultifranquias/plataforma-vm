# Design: User Deactivation with Historical Identity

## Migration
- Add `profiles.removed_at timestamptz` (default NULL)
- Add `profiles.removed_by_id uuid` FK → `public.profiles(id) ON DELETE SET NULL`
- Index: `idx_profiles_removed` on `(removed_at IS NOT NULL)`
- Index: `idx_profiles_active` on `(is_active)` for active-list filtering

## Atomic RPC: `admin_remove_user_profile`
- `security definer`, `set search_path = ''`
- Parameters: `p_target_id uuid`, `p_caller_id uuid DEFAULT NULL`
- Uses `SELECT ... FOR UPDATE` on target + caller profiles for race safety
- Validates: caller (by p_caller_id or auth.uid()) is active ADMIN, target exists, not self, not final active ADMIN
- Sets `is_active=false`, `removed_at=now()`, `removed_by_id=<caller_id>`
- Idempotent: if `removed_at IS NOT NULL` already, return success
- Inserts `USER_REMOVED` audit entry
- Returns `{ target_id, removed_at, removed_by_id }`
- Revoke execute from `PUBLIC` and `anon`
- Grant execute to `authenticated` (service-role server calls it)

## is_admin() Implementation
- `SECURITY INVOKER`, reads `public.profiles` table (not JWT)
- Checks: `role = 'ADMIN'`, `is_active = true`, `removed_at IS NULL`
- DB-backed = immune to stale JWT metadata claims
- Deployed in migration `20260630210000_harden_function_execution_grants.sql`

## ActiveRecord Enforcement
- `submit_order`: add `current_user_is_active()` guard
- `approve_order`, `reject_order`, `request_order_changes`: add `current_user_is_active()` guard
- RPCs already guarded: `create_order`, `mark_order_placed`, `confirm_order_received`,
  `resubmit_changed_order_multi_image`, `delete_order`, `admin_delete_order`
- `is_admin()` reads DB (not JWT) — removed user with stale JWT cannot act because
  RPCs call `is_admin()` which checks `is_active + removed_at IS NULL`

## Server Orchestration (`supabase-admin-service.js`)
Replace `deleteUser()` with `removeUser()`:
1. `assertActiveAdmin(token)` (validates caller is active ADMIN via auth/v1/user + profile query)
2. Call `admin_remove_user_profile` RPC via POST /rest/v1/rpc/ with `p_caller_id` = caller.authUser.id
3. If RPC succeeds: call Auth Admin API PUT to disable (`ban_duration: '876000h'` + `app_metadata.is_active=false`)
4. If Auth disable fails: return partial failure (profile already locked)
5. Return `{ removed: true, id, removed_at, authDisable: 'ok'|'failed' }`

## Auth Disable Strategy
Supabase Auth Admin API supports PUT `/auth/v1/admin/users/{id}` with:
- `ban_duration: '876000h'` to ban effectively permanently (100 years)
- Plus `app_metadata: { is_active: false }`

Session revocation: Supabase Auth Admin API does NOT expose a session revocation endpoint
in the GoTrue Admin API for project-level auth. Use `ban_duration: '876000h'` to disable login.
Existing tokens are rejected by RPC-level `current_user_is_active()` checks (reads DB).

## p_caller_id Trust Flow
- Browser never supplies `p_caller_id`
- Express extracts bearer token from Authorization header
- `assertActiveAdmin()` validates token via Supabase Auth REST (`auth/v1/user`) + profile query
- `caller.authUser.id` passed as `p_caller_id` to `admin_remove_user_profile` RPC
- If `auth.uid()` is NULL (service_role call), RPC uses `p_caller_id` instead

## UI Changes
- users-module.js: action label → "Remover usuário", confirmation text updated
- usuarios.html: status filter includes "Removidos"
- users-data.js: `deleteUser` → `removeUser`, normalize `removed` status
- app-utils.js: `formatHistoricalActorName()` helper
- orders-data.js and orders-module.js: use helper for historical actor display

## Display Helper
```js
function formatHistoricalActorName(profile) {
  if (!profile) return 'Usuário não encontrado';
  if (profile.removed_at) return profile.name + ' — usuário removido';
  return profile.name;
}
```

## Test Plan
- Server: remove user, idempotent, self-remove blocked, final-admin blocked, non-admin blocked
- Historical: profile/auth remain, FKs intact, removed filter, default exclusion
- Session denial: removed session cannot create/submit/approve/reject
- Frontend: confirmation text, display helper, filter option
- E2E: full workflow with order-owning user, removed display, historical display

## Playwright E2E Constraints
- webServer command: `node server.js` (not `npm start`)
- `reuseExistingServer: false` to prevent port conflicts
- `stdout/stderr: 'pipe'` for diagnostics
- Writes tests require `--workers=1`
- Do not manually run `npm start` before E2E — Playwright manages server lifecycle
