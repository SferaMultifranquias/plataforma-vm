# User Store Visibility — Spec

## Problem

1. `/novo-pedido` still needs browser-side fail-closed filtering for store visibility by role and assignment
2. stale store permissions must not leak across user/session changes
3. tampered `loja_id` must not be treated as valid by frontend validation
4. direct-insert fallback must keep DB as final authority

## Requirements

### R1 — Store visibility by role
- ADMIN: sees all stores (active + inactive) via `lojas` table queries
- USER: sees only `ativo = true` stores via `lojas` table queries
- Inactive user (any role): sees zero stores, can create zero orders

### R2 — Store selector in `/novo-pedido`
- ADMIN: sees only active stores in dropdown
- USER: sees only linked (`user_stores`) **AND** active (`lojas.ativo = true`) stores
- USER with zero linked active stores: disabled dropdown with message `Nenhuma loja vinculada ao seu usuário`
- lookup failure: disabled dropdown with a clear access-loading error and no fallback to all stores

### R3 — Order creation authorization (DB layer)
- Active check: `current_user_is_active()` must return true before any order insert
- Store check: non-admin must have a `user_stores` row for the selected store AND store must be active
- Admin: active check applies, store access automatic
- Direct insert RLS (`orders_insert_own`): must enforce active user
- `create_order` RPC: must enforce active user + active store + store access

### R4 — Fail-closed on lookup errors
- If `user_stores` lookup fails (network/DB error): no stores shown, select disabled
- If profile lookup fails: `current_user_is_active()` returns `false`
- If browser selection is tampered: invalid store must be cleared before submit

### R5 — No data changes to existing migrations
- All changes additive (new migration, new functions, policy drop/recreate)
- Never edit `20260617...`, `20260618...`, `2026061912...`, `2026061914...`, `2026061915...`

### R6 — REJECTED/CHANGES_REQUESTED workflow preserved
- Review RPCs (`approve_order`, `reject_order`, `request_order_changes`) unchanged
- Active-user check only at store-access + order-creation boundary, not at review boundary

## Out of Scope

- Audit/logging changes
- Review RPC active-user enforcement
- E2E tests (requires test fixture USER)
- `/lojas` page migration to partial
