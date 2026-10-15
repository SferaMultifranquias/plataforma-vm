# Tasks — User Deactivation + Historical Identity

## Current TLC checkpoint

| Field | Value |
|-------|-------|
| Phase | Execute / closeout handoff |
| Feature state | Complete — all code, migrations, tests done |
| Migrations | 21/21 synced local↔remote |
| E2E | 14/14 pass (admin-user-removal.spec.js) |
| Stale fixtures | 26 purged, zero leftovers |
| is_admin() | DB-backed (reads profiles, not JWT) — deployed |
| p_caller_id | Trust flow: server derives from validated bearer token, not browser |
| Worktree | Clean — no uncommitted changes |

### Approval gates (next session)
- No migration rewrite of any applied migration
- No purge, E2E run, or remote mutation without explicit approval
- No commit or push without explicit request

## Implementation evidence

### Migration files
| File | Purpose |
|------|---------|
| `20260630000000_user_deactivation_historical_identity.sql` | profiles.removed_at, removed_by_id, admin_remove_user_profile RPC, active checks added to 6 RPCs |
| `20260630100000_harden_rls_storage_active_user.sql` | Added current_user_is_active() to visible_scope + requester_edit_draft policies + Storage policies |
| `20260630200000_harden_rls_policies_complete.sql` | Updated all remaining policies missing active check + current_user_is_active() now checks removed_at IS NULL |
| `20260630210000_harden_function_execution_grants.sql` | DB-backed is_admin() — SECURITY INVOKER reads profiles table |
| `20260630220000_add_caller_id_to_admin_remove_user_profile.sql` | Added p_caller_id param for service_role calls |
| Applied: YES — all 5 pushed to remote | |
| Local↔remote: ALL **21** migrations synced | |

### Auth disable mechanism
- `disableAuthUser(authUserId)` in `supabase-admin-service.js`
- Calls `PUT /auth/v1/admin/users/{id}` with `ban_duration: '876000h'` + `app_metadata: { is_active: false, role: 'USER' }`
- Prevents new logins (ban_duration)
- Existing sessions denied by RPC-level `current_user_is_active()` checks (reads DB) + RLS policies

### Historical identity hydration
- `formatHistoricalActorName(profile)` in `app-utils.js` — exported helper
- Appends `— usuário removido` only when `removed_at` is present
- Used in `orders-data.js` normalizeOrderRecord for requester display
- Only requester is rendered in frontend; placed_by_id, received_by_id, uploaded_by_id queried but never displayed
- Drawer has no requester field — only Loja and Data shown

### User list behavior
- **Default**: removed users excluded (`status !== 'removed'` filter in `listUsers`)
- **Removidos filter**: `normalizeStatusFilter` recognizes `'removed'`/`'removido'`
- **Badge**: `.users-status-badge--removed` CSS class (slate/neutral colors)
- **Controls**: no edit/remove buttons for removed users (checked in E2E spec)
- **Summary**: `computeSummary()` includes `removed` count

### Partial failure / idempotency
- RPC `admin_remove_user_profile` idempotent via `already_removed` check (no second audit)
- `removeUser()` in server service: RPC success → Auth disable attempt
- RPC failure → no Auth change
- RPC success + Auth failure → partial failure reported; retry re-attempts Auth only
- Profile update + audit atomic in RPC (both roll back on failure)

### Test cleanup safety
- `purgeDisposableUser(userId, email, marker)` added to `disposable-user-fixtures.js`
- Uses service-role key directly (destructive path)
- Safety: checks marker in email before any deletion
- Order: Storage objects → DB artifacts → user_stores → audit_logs → profile → Auth (FK-safe)
- Never acts on non-marker users

## Phase 1: Complete function audit (executed against remote DB)

All 23 public functions audited via `pg_proc`, `pg_namespace`, `information_schema.routine_privileges`, and `pg_policies`.

| # | Function | Signature | Security | Granted | current_user_is_active? | Admin check? | Classification |
|---|----------|-----------|----------|---------|------------------------|-------------|----------------|
| 1 | `is_admin` | () | INVOKER | authenticated, anon | ✅ N/A (reads DB: profiles) | self | DB-backed; reads is_active + removed_at IS NULL from profiles |
| 2 | `generate_order_internal_number` | () | INVOKER | authenticated, anon | ❌ omitted | ❌ | **Public helper** — intentional; generates sequence number |
| 3 | `current_user_is_active` | () | DEFINER | authenticated, anon | ✅ self | ❌ | **Self** — correctly checks is_active + removed_at IS NULL |
| 4 | `create_order` | (8 params) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 5 | `submit_order` | (uuid) | DEFINER | authenticated | ✅ | ❌ (owner-only) | **Protected** — OK |
| 6 | `approve_order` | (uuid) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 7 | `reject_order` | (uuid, text) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 8 | `return_order_to_draft` | (uuid) | DEFINER | authenticated | ✅ | ❌ (owner-only) | **Protected** — OK |
| 9 | `request_order_changes` | (uuid, text) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 10 | `user_can_access_store` | (bigint) | INVOKER | authenticated | ✅ | ✅ is_admin() | **Protected helper** — OK |
| 11 | `order_visible_to_current_user` | (uuid) | INVOKER | authenticated | ❌ omitted | ✅ is_admin() | **Read-only helper** — not used in RLS policies; callers responsible for auth |
| 12 | `order_editable_by_current_user` | (uuid) | INVOKER | authenticated | ❌ omitted (reads is_active directly) | ❌ | **Read-only helper** — checks profiles.is_active directly; OK |
| 13 | `record_order_status_history` | (uuid, text, text, text) | DEFINER | authenticated | ❌ omitted | ❌ | **Internal helper** — called FROM SECURITY DEFINER RPCs that already check active |
| 14 | `resubmit_changed_order` | (7 params) | DEFINER | authenticated | ❌ omitted (reads v_profile.is_active) | ❌ | **Protected** — reads v_profile.is_active + FOR UPDATE directly |
| 15 | `delete_order` | (uuid) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 16 | `delete_store` | (bigint) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 17 | `mark_order_placed` | (uuid, text, date) | DEFINER | authenticated | ✅ | ✅ is_admin() | **Protected** — OK |
| 18 | `confirm_order_received` | (uuid) | DEFINER | authenticated | ✅ | ❌ (owner-only) | **Protected** — OK |
| 19 | `resubmit_changed_order_multi_image` | (8 params) | DEFINER | authenticated | ❌ omitted (reads v_profile.is_active) | ❌ | **Protected** — reads v_profile.is_active + FOR UPDATE directly |
| 20 | `cleanup_draft_order` | (uuid) | DEFINER | authenticated | ✅ | ❌ (owner-only) | **Protected** — OK |
| 21 | `admin_remove_user_profile` | (uuid, uuid) | DEFINER | authenticated | ❌ omitted (reads v_caller.is_active) | ✅ (manual role check) | **Protected ADMIN** — reads v_caller.is_active + FOR UPDATE directly |
| 22 | `handle_new_user` | () | DEFINER | authenticated | N/A | N/A | **Trigger** — not user-callable |
| 23 | `set_updated_at` | () | INVOKER | authenticated | N/A | N/A | **Trigger** — not user-callable |

### Functions intentionally left without current_user_is_active()
| Function | Reason |
|----------|--------|
| `is_admin` | DB-backed — reads is_active + removed_at IS NULL from profiles directly |
| `generate_order_internal_number` | Public helper; generates sequential number |
| `order_visible_to_current_user` | Read-only, not used in RLS policies |
| `order_editable_by_current_user` | Reads profiles.is_active directly |
| `record_order_status_history` | Called only from SECURITY DEFINER RPCs that already check |
| `resubmit_changed_order` | Reads v_profile.is_active + FOR UPDATE directly |
| `resubmit_changed_order_multi_image` | Reads v_profile.is_active + FOR UPDATE directly |
| `admin_remove_user_profile` | Reads v_caller.is_active + FOR UPDATE directly |
| `handle_new_user`, `set_updated_at` | Triggers, not user-callable |

### Functions corrected in this session
| Function | Correction | Migration |
|----------|-----------|-----------|
| `current_user_is_active()` | Added `removed_at IS NULL` check | 20260630200000 |
| `return_order_to_draft` | Added `current_user_is_active()` | 20260630000000 |
| `cleanup_draft_order` | Added `current_user_is_active()` | 20260630000000 |
| `is_admin()` | Changed from JWT-only to DB-backed (SECURITY INVOKER, reads profiles) | 20260630210000 |
| `admin_remove_user_profile` | Added `p_caller_id` parameter for service_role calls | 20260630220000 |

## Phase 2: current_user_is_active() deployed definition

```
CREATE OR REPLACE FUNCTION public.current_user_is_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select is_active and removed_at is null from public.profiles where id = auth.uid()),
    false
  );
$function$
```

**Verification:**
- ✅ `is_active = true` required
- ✅ `removed_at IS NULL` required (added in 20260630200000)
- ✅ Reads from `profiles` table (not JWT) — immune to stale JWT metadata
- ✅ `coalesce(..., false)` protects against missing profile
- ✅ Not fooled by duplicated profile data (unique PK on id)
- ✅ Not fooled by role stored in token claims (only checks is_active, not role)

## Phase 3: Historical actor display audit

| Actor field | Screen/component | Rendered? | Removed state supported? | Change required? |
|-------------|-----------------|-----------|------------------------|-----------------|
| `requester_name` | Orders list table (`Solicitante` column) | ✅ Yes via `getRequesterLabel()` | ✅ `formatHistoricalActorName()` used as fallback | ❌ No |
| `requester_name` | Mobile card (`Solicitante` field) | ✅ Yes via `getRequesterLabel()` | ✅ Same path | ❌ No |
| `requester_name` | Drawer summary | ❌ Not rendered (only Loja + Data shown) | N/A | ❌ No — drawer does not show requester; intent verified |
| `placed_by_id` | Any screen | ❌ Not rendered (queried but never displayed) | N/A | ❌ No — not displayed |
| `received_by_id` | Any screen | ❌ Not rendered (queried but never displayed) | N/A | ❌ No — not displayed |
| `uploaded_by_id` | Any screen | ❌ Not rendered (queried but never displayed) | N/A | ❌ No — not displayed |
| `approved_by_id` | Any screen | ❌ Not rendered | N/A | ❌ No — not displayed |
| `changed_by_id` | Status history | ❌ Hardcoded as `'Sistema'` | N/A | ❌ No — history does not render actor names |
| Sidebar username | App shell | ✅ `sidebar-username.textContent = user.nome` | ✅ Reads from currentUser loaded at auth | ❌ No — current user always known |
| User admin table | `/usuarios` | ✅ Name, email, stores rendered | ✅ Removed badge, no edit/remove buttons | ❌ No |

## Phase 4: RLS and Storage policy audit

### Pre-fix analysis (before 20260630200000)

Because Supabase OR's multiple policies per table+command, the old `_select_own_or_admin` and `_modify_editable_orders` policies lacked `current_user_is_active()` and created a bypass around the newer `_visible_scope` policies.

| Table | Missing policies | Risk |
|-------|-----------------|------|
| `orders` | `select_own_or_admin`, `update_draft_own_or_admin` | Removed user with stale JWT could SELECT own + admin orders; removed ADMIN could UPDATE |
| `order_items` | `select_own_or_admin`, `modify_editable_orders` | Removed user could SELECT + modify items via old policy |
| `order_images` | `select_own_or_admin`, `modify_editable_orders` | Removed user could SELECT + modify image metadata |
| `status_history` | `select_own_or_admin` | Removed user could SELECT history |
| `lojas` | `admin_write` | Removed ADMIN could INSERT/UPDATE/DELETE lojas |
| `user_stores` | `admin_write` | Removed ADMIN could INSERT/UPDATE/DELETE user_stores |
| `profiles` | `update_self_limited` | Removed ADMIN could bypass self-limits |

### Fix applied in 20260630200000

All 11 policies above dropped and recreated with `current_user_is_active()` prefix.

### Storage bucket: `order-images`

| Policy | current_user_is_active? | Bucket check | Path auth check | Order status check |
|--------|------------------------|-------------|----------------|-------------------|
| `order_images_storage_select` | ✅ | ✅ bucket_id = 'order-images' | ✅ admin OR requester OR user_stores | N/A (SELECT) |
| `order_images_storage_insert` | ✅ | ✅ | ✅ split_part path matches auth.uid() | ✅ DRAFT, CHANGES_REQUESTED |
| `order_images_storage_delete` | ✅ | ✅ | ✅ split_part path matches auth.uid() | ✅ DRAFT, CHANGES_REQUESTED |

**Result**: All Storage policies correctly block removed users.

### Final RLS state

All policies across all 8 tables (`orders`, `order_items`, `order_images`, `status_history`, `profiles`, `lojas`, `user_stores`, `audit_logs`) and `storage.objects` now include `current_user_is_active()`.

### Verification SQL

See `supabase/verification/20260630000000_verify_user_deactivation.sql`
(schema-wide read-only queries confirming RLS/function coverage).

## Test results
- `npm run check`: ✅ PASS (53 files)
- `npm test`: ✅ PASS (11 suites)
- `npm run test:smoke`: ✅ PASS
- `npm run validate`: ✅ PASS
- E2E `admin-user-removal.spec.js`: ✅ **ALL 14/14 PASS**

### E2E assertions proven
1. ✅ Admin login succeeds, token captured
2. ✅ Historical fixture (user, order, items, image, storage) created
3. ✅ ADMIN removes user through UI — toast shown
4. ✅ Removed user disappears from default list
5. ✅ Removed user appears in Removidos filter with Removido badge — edit/remove buttons hidden
6. ✅ Auth profile and FK records preserved (orders, images, user_stores unchanged)
7. ✅ New login fails after removal (redirects to /login)
8. ✅ Existing session token cannot read orders via PostgREST (empty result)
9. ✅ Existing session token cannot call protected RPCs (create_order, submit_order rejected)
10. ✅ Existing session token cannot access Storage (upload + download rejected)
11. ✅ Removal is idempotent (second call returns alreadyRemoved: true)
12. ✅ Cleanup purges user and verifies zero leftovers
13. **06b** ✅ Auth REST denial: direct login via Supabase Auth REST returns HTTP 400 with `user_banned` error
14. **08b** ✅ Stale-session mutation block: INSERT/UPDATE/DELETE on orders, order_items, order_images, profiles, user_stores blocked by RLS (data integrity verified via service-role reads)

### Fixes applied during E2E validation
| Issue | Cause | Fix |
|-------|-------|-----|
| RPC auth.uid() null | `admin_remove_user_profile` used `auth.uid()` but service_role calls get NULL | Added `p_caller_id` param to RPC + migration `20260630220000` |
| Test 06 localStorage denied | `clearCookies()` before `page.goto()` on blank page | Navigate to `/login` first, then clear |
| Test 10 user not found | `listUsersViaAdminApi` without `status=removed` skips removed users | Direct fetch with `status=removed&search=...` |
| Storage cleanup error | `supabaseRest` sent `Content-Type: application/json` with empty DELETE body | `deleteStorageObject` uses direct `fetch` without Content-Type header |
| Playwright server not retained | `npm start` spawns node process that survives Playwright killing npm shell | Changed to `node server.js` + added `stdout/stderr: 'pipe'` |
| Edit/Remove buttons shown for removed users | Template unconditionally rendered action buttons for all users | Cond rendering: `user.status !== 'removed'` shows buttons |

## Remaining risks
1. **Stale JWT for removed ADMIN** — `is_admin()` reads DB (not JWT), RPCs check `current_user_is_active()` before `is_admin()`, RLS has active check on admin policies — fully mitigated
2. **Reactivation UI out of scope** — if needed, requires new migration + UI
3. **Drawer missing requester name** — intentional design, drawer shows Loja + Data only
4. **placed_by_id, received_by_id, uploaded_by_id not rendered** — tracking-only fields, never displayed, no removal required
5. **Stale E2E fixtures** — **RESOLVED**: 26 stale removed users purged via `scripts/maintenance/purge-stale-e2e-users.js`; zero leftovers verified
6. **is_admin() JWT-only** — **RESOLVED**: migration `20260630210000` makes it DB-backed (SECURITY INVOKER, reads profiles table)
