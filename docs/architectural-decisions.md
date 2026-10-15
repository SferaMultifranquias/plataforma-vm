# Architectural Decisions

## Authorization Model

### Context
The current authorization model uses:
- Persisted `role` column on `profiles` (`USER` | `ADMIN`)
- `user_stores` join table for store-level access
- Row-Level Security (RLS) policies in Supabase
- Server-side role verification for admin APIs

A permissions table (e.g., `permissions` with granular resource + action rows) was proposed as a more flexible alternative.

### Decision
**Keep `role + user_stores + RLS`. Do not add a permissions table.**

### Rationale
- Current model covers all known use cases: ADMIN vs USER, store-level scoping, RLS for data isolation
- No concrete feature requires granular resource-level permissions (e.g., "can edit orders but not approve")
- Adding a permissions table would increase complexity without a demonstrated need
- `service_role` on the server provides a safe backstop for admin-only endpoints

### Risks
- If a new role type is added (e.g., "store manager" with partial admin powers), the binary ADMIN/USER split may be insufficient
- Granular permission requirements would require a migration and RPC changes

### Reconsider when
A feature requires resource-level permissions not expressible via roles + store association. Examples: time-limited admin delegation, per-user feature flags, or third-party auditor access.

---

## Generic `update_order` RPC

### Context
The order mutation surface currently uses status-specific RPCs:
- `create_order` → `DRAFT`
- `submit_order` → `PENDING_APPROVAL`
- `request_order_changes` → `CHANGES_REQUESTED`
- `resubmit_changed_order` → `PENDING_APPROVAL`
- `approve_order` → `APPROVED`
- `reject_order` → `REJECTED`

A generic `update_order` RPC accepting any status transition was proposed.

### Decision
**Do not implement. Status-specific RPCs remain authoritative.**

### Rationale
- Each RPC enforces its own validations (ownership, current status, authorizations)
- A generic RPC would need complex validation logic to prevent invalid transitions
- Current design makes the workflow explicit in the API surface
- YAGNI: no business use case requires a generic updater

### Risks
- New status transitions require new RPCs, adding boilerplate
- Client code coupling: each mutation has a single entry point

### Reconsider when
A business use case requires a status transition that cannot be named in advance (e.g., admin bulk status override, conditional workflow). Even then, prefer a targeted RPC over a generic one.

---

## Order Audit Metadata Fields

### Context
Proposal to add `last_edited_by` and `last_edited_at` columns to the `orders` table for quick "who last touched this" display.

### Current coverage
- `status_history` table records every status transition with user_id and timestamp
- `audit_logs` table records mutations with user_id, action, and timestamp
- Both provide full audit trail for any order

### Decision
**Do not add `last_edited_by` / `last_edited_at` columns now. `status_history` and `audit_logs` remain the source of truth.**

### Rationale
- Adding denormalized columns creates a sync problem: any mutation must update both the audit trail and the denormalized fields
- Current audit tables already answer "who last edited this" via queries
- No UI requirement currently exists that cannot be served by querying `audit_logs`
- Defer complexity until there is a concrete performance or UX need

### Risks
- Queries for "last editor" require a JOIN/lookup on `audit_logs` instead of a direct column read
- Minimal risk: the audit trail is already in place and correct

### Reconsider when
The UI needs a low-latency "last edited by" display on order list cards or dashboard widgets, and the JOIN to `audit_logs` becomes a measurable bottleneck.
