# Design
# Status: COMPLETE — 2026-06-23.

## Backend Contract
Frontend calls `public.resubmit_changed_order` with:
`p_order_id`, `p_items`, `p_image`, `p_purpose`, `p_justification`, `p_priority`, `p_notes`.

## RPC
- `language plpgsql`
- `security definer`
- `set search_path = public`
- return `public.orders`

## Authorization
- Require `auth.uid()`.
- Require matching `public.profiles.id`.
- Require `profiles.is_active = true`.
- Require requester owns order.
- Require `orders.status = 'CHANGES_REQUESTED'`.

## Data Flow
1. Lock order row `for update`.
2. Validate status, owner, profile, and payload.
3. Replace all `order_items` rows for same `order_id`.
4. Keep existing `order_images` when `p_image` is null.
5. When `p_image` is present, replace DB image metadata and delete old storage objects.
6. Update same `orders.id` to `PENDING_APPROVAL`.
7. Append `status_history` row server-side.
8. Insert audit log.

## RLS
- Keep direct `orders`, `order_items`, `order_images` edit policies `DRAFT`-only.
- Expand `order_editable_by_current_user()` to `DRAFT` and `CHANGES_REQUESTED`.
- Expand `storage.objects` insert/delete policies to allow requester while order is `DRAFT` or `CHANGES_REQUESTED`.

## Idempotency
- No idempotency key in frontend contract.
- Strict status gate is enough: after success, order becomes `PENDING_APPROVAL` and retry fails without duplicating data.

## Cleanup Strategy
- New image uploaded by browser first.
- RPC deletes old storage objects, deletes old `order_images` rows, then inserts replacement metadata (storage delete BEFORE metadata insert — avoids partial orphan).
- If RPC fails, frontend cleanup removes uploaded object.
- Orphan scan SQL remains for maintenance.

## Verification
- Add read-only SQL file for function signatures, policy state, bucket config, and orphan scan.
