# order-lifecycle-ui-e2e-hardening

## Goal
Validate full browser order lifecycle: requester creates order, admin requests changes, requester edits same order, and resubmits it back to `PENDING_APPROVAL`.

## Requirements
- OLEH-001 Use Playwright live browser in serial mode.
- OLEH-002 Use dedicated disposable ADMIN and USER accounts from env.
- OLEH-003 User creates order through `/novo-pedido` UI.
- OLEH-004 Admin requests changes through `/pedidos` drawer UI.
- OLEH-005 Requester reopens same order in edit mode via `/novo-pedido?orderId=...`.
- OLEH-006 Same `order_id` is preserved after resubmit.
- OLEH-007 Existing image remains when no replacement image is provided.
- OLEH-008 Order returns to `PENDING_APPROVAL` after resubmit.
- OLEH-009 No duplicate items, images, or history rows are created.
- OLEH-010 Cleanup removes disposable user and order artifacts.
- OLEH-011 No `service_role` is available in browser context.
- OLEH-012 Retry after success is rejected by edit gate / terminal status.

## Scope Notes
- Live Supabase required.
- No production code changes for test convenience.
- No migration changes.
