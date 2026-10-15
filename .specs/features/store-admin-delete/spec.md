# Store Admin Delete

## Goal
Admins can physically delete stores that have no orders. Stores must be deactivated (`ativo=false`) before deletion. Stores with existing orders are blocked (FK `orders.store_id` has NO ON DELETE). Deactivation (`ativo=false`) remains the standard archival path.

## Architecture
- `delete_store` RPC is SECURITY DEFINER, invoked with caller JWT
- RPC verifies admin + active status + zero orders before deletion
- `user_stores` removal handled by FK `ON DELETE CASCADE` on `user_stores.store_id` → `lojas(id)` — verified by querying `information_schema`
- BIGINT store ID stored in audit `previous_data` JSON; `entity_id` set to NULL (avoids unsafe UUID cast)
- Confirmation modal shows store `codigo - nome` before deletion

## Requirements
- Store must be `ativo=false` before delete button appears
- ADMIN sees "Excluir" button in store table action column (third button, after Edit and Toggle)
- ConfirmModal dialog shows store code + name
- Calls `delete_store` RPC (SECURITY DEFINER, `is_admin()` check)
- RPC checks `orders` table for references → if count > 0, raises "Store has orders and cannot be deleted."
- RPC deletes the store row (FK CASCADE handles `user_stores`)
- On success: toast "Loja excluida com sucesso", table refreshes
- On error (has orders): toast "Erro: Store has orders and cannot be deleted."
- On other error: toast "Erro: <message>"
- USER route is blocked (`lojas-cadastro` resource), so USER never sees delete button
- USER cannot call RPC directly

## Implementation
- `supabase/migrations/20260625000000_add_admin_delete_rpcs.sql`: initial RPC
- `supabase/migrations/20260625130000_fix_delete_rpcs_hardened.sql`: corrective forward migration — SECURITY DEFINER, caller JWT auth, schema-qualified refs, BIGINT-safe audit, revoke/grant
- `public/js/pages/stores/stores-module.js`: delete button visibility gated on `ativo=false`, `excluirLoja(id, deps)` handler, event delegation in `bindLojasPageControls`
- `public/index.html`: `global.excluirLoja` wrapper
- `public/js/shared/confirmation-modal.js`: modal with focus trap, loading, no native confirm fallback
- `tests/e2e/store-delete.spec.js`: full E2E coverage (2 tests)

## Acceptance Criteria
- Delete button hidden for active stores (ativo=true)
- Delete button visible for deactivated stores (ativo=false)
- ADMIN sees delete button in store table for inactive stores
- Store with orders: delete blocked, error toast shown
- Store without orders: physical delete succeeds
- ConfirmModal dialog shows store code + name
- `user_stores` entries cleaned up via FK CASCADE (verified)
- BIGINT store ID in audit `previous_data`, `entity_id` = NULL
- Table refreshes after delete
- RPC blocks non-ADMIN (direct call)
- Deactivation (`ativo=false`) still works as before
