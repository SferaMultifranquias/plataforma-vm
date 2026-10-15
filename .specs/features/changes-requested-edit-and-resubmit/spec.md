# changes-requested-edit-and-resubmit
# Status: COMPLETE — 2026-06-23. Migration applied, verified, E2E live passed.

## Goal
Allow requester to edit and resubmit same order after `CHANGES_REQUESTED`.

## Requirements
- CRR-001 Only requester may resubmit.
- CRR-002 Requester must be active.
- CRR-003 Order must be `CHANGES_REQUESTED`.
- CRR-004 Same `order_id` is preserved.
- CRR-005 Order fields and items update atomically.
- CRR-006 Items must not duplicate.
- CRR-007 Existing image stays when no new image is provided.
- CRR-008 New image replaces current DB image metadata.
- CRR-009 Status returns to `PENDING_APPROVAL`.
- CRR-010 Server appends one `status_history` entry.
- CRR-011 Previous change-request history remains preserved.
- CRR-012 Any failure rolls back all DB changes.
- CRR-013 Retry must not duplicate items, images, or history.
- CRR-014 Invalid statuses must be rejected.
- CRR-015 Direct table edits stay blocked when RPC is intended path.

## Scope Notes
- RPC is authoritative backend path for edit-and-resubmit.
- Store change is not part of RPC signature.
- Image cleanup must be defined and deterministic.
