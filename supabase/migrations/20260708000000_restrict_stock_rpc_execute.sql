-- Restrict stock RPC execution grants and verify RLS policies.
-- Goals:
--   1. recompute_store_stock_balance is only callable via admin SECURITY DEFINER RPCs
--   2. store_stock_receipts and store_stock_balances have no direct mutation grants
--   3. Order-level stock RLS policies already exist from correct_stock_lifecycle migration

-- 1) Revoke direct execute of recompute_store_stock_balance from authenticated
revoke execute on function public.recompute_store_stock_balance(bigint, text) from authenticated;

-- Keep grant only for admin role (the existing grant on public is already revoked).
-- The function is still callable by SECURITY DEFINER RPCs because definer permissions
-- bypass RLS and grant checks, so admin_update_stock_receipt and admin_void_stock_receipt
-- can still recompute balances internally.
