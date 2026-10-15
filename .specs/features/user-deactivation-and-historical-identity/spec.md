# User Deactivation with Historical Identity Preservation

## Problem
Physical user deletion breaks historical FK references in orders, status_history, audit_logs, order_images, and user_stores. FK constraints use NO ACTION — deleting a profile with historical records violates FK constraints.

## Solution
Replace physical deletion with operational deactivation (soft-remove):

- Set `profiles.is_active = false`
- Record `profiles.removed_at` and `profiles.removed_by_id`
- Insert `USER_REMOVED` audit event (atomic with profile update)
- Disable Auth access via Supabase Admin API
- Revoke active sessions

## Constraints
- Never delete from `auth.users` or `public.profiles`
- Never alter historical FKs to CASCADE or SET NULL
- Auth user remains stored; email remains reserved
- Future reactivation preserves profile ID and history (out of scope)
- Removed user display uses `<name> — usuário removido`
- Only service-role server can call Auth Admin API

## Locked Decisions
- User removal = operational deactivation, not physical deletion
- Historical profile identity is preserved
- Existing orders, images, history, audit, actor references unchanged
- `user_stores` assignments remain stored
- Removed users excluded from default list; `Removidos` filter added
- Reactivation UI out of scope
- Blocked and removed users both `is_active = false`; removal metadata distinguishes them
- Action: `Remover usuário`; confirmation explains historical preservation

## Acceptance Criteria
- [x] Operational deactivation: profile set inactive, removed_at, removed_by_id recorded
- [x] Auth identity preserved (not deleted) with ban_duration + app_metadata
- [x] UUID and FK references preserved in all historical records
- [x] RLS and Storage policies block removed users from any data access
- [x] Stale JWT sessions: denied at RPC level (current_user_is_active) and RLS level
- [x] Reactivation out of scope (no UI, no migration)
- [x] Final active ADMIN cannot be removed (RPC-level guard)
- [x] Removed user display uses formatHistoricalActorName() helper
