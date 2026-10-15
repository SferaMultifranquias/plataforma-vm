# Order Admin Delete

## Goal
Active ADMIN may permanently delete any order (any status) by re-entering their current login password. Cascade deletes order_items, order_images (rows + Storage objects), status_history. Final `ORDER_DELETED` audit entry preserved.

## Architecture
- Password verification in Express via Supabase Auth password grant (anon key, caller email, never service role)
- Storage deletion (order-images bucket) in Express via service_role key
- `delete_order` RPC performs database deletion only — caller JWT, no storage access, no password parameter
- Storage failure prevents database RPC
- Database failure after Storage success returns partial failure
- Password confirmation modal extends the shared ConfirmModal with password input (no native dialog)

## Requirements
- Only active ADMIN may delete (is_admin RPC check + Express assertActiveAdmin)
- Any order status accepted (no DRAFT restriction)
- ADMIN must re-enter current login password for every deletion
- Password verified via `POST /auth/v1/token?grant_type=password` with anon key
- Returned user ID must match verified caller Auth user ID
- Generic "Senha incorreta" for any auth failure (wrong password, disabled account, user ID mismatch)
- Password never logged, stored, or passed to SQL RPC
- Operation order: Bearer token → active admin → order ID → password → load order → load image paths → delete Storage → call RPC → success
- Missing or wrong password prevents Storage deletion, RPC execution, audit creation, any database change
- Storage files deleted before RPC (service role)
- ConfirmModal with password input, focus trap, Escape/Cancel, loading state, duplicate-confirm guard
- Success: toast "Pedido excluído com sucesso. A exclusão foi registrada no histórico de auditoria."
- Wrong password: toast "Senha incorreta. O pedido não foi excluído."
- Cancel leaves order, Storage, and DB untouched
- Duplicate confirm sends one request (modal processing guard)

## Implementation
- `supabase/migrations/20260626090000_delete_order_any_status.sql`: replaces `delete_order` — no status restriction, audit snapshot includes `deleted_by`, `deleted_at`, `image_count`
- `public/js/shared/app-utils.js`: `canDeleteOrder(user, order)` — only ADMIN + valid ID
- `public/js/shared/confirmation-modal.js`: `confirmPassword()` extends modal with password input
- `public/index.html`: `#confirm-modal-password-block` + input in confirm-modal
- `public/js/pages/orders/orders-data.js`: `deletarPedidoAPI(id, deps, password)` — sends password in request body
- `public/js/pages/orders/orders-module.js`: `excluirPedido()` — password confirm modal, toast messages, list refresh
- `src/server/services/supabase-admin-service.js`: `verifyCallerPassword()` — Supabase Auth password grant; `deleteOrder()` — no DRAFT check
- `src/server/routes/orders-admin.js`: reads `req.body.password`, calls `verifyCallerPassword` before `deleteOrder`
- `tests/server/orders-admin.test.js`: password verification, non-DRAFT acceptance, password failure prevents deleteOrder
- `tests/e2e/order-delete.spec.js`: DRAFT + correct password, non-DRAFT (PENDING_APPROVAL) + correct password, USER no-button, wrong password, cancel, duplicate confirm

## Acceptance Criteria
- Delete button visible for ADMIN on any status
- Delete button hidden for USER always
- Password modal confirms with correct password → deletion
- Wrong password → error toast, DB/Storage untouched
- Cancel → modal closes, drawer still open, DB/Storage untouched
- Successful delete: order + items + images + history gone, audit_log entry preserved with previous status
- Storage files cleaned up BEFORE database deletion
- Storage failure → database deletion NOT performed
- Database failure after Storage success → partial failure reported
- Duplicate confirm → one request
- RPC blocks non-ADMIN (direct call)
- Password never appears in error responses or logs
- Server tests: password verification, wrong password, password before deleteOrder guard, non-DRAFT acceptance, Auth token concealment

## Migration history
- `20260625000000`: initial `delete_order` (DRAFT-only)
- `20260625120000`: corrected auth + status validation
- `20260625130000`: hardened — SECURITY DEFINER, caller JWT, schema-qualified, structured errors
- `20260626090000`: replaces `delete_order` — any status, enhanced audit snapshot, no password in SQL
