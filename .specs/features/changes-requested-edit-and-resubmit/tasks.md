# Tasks
# Status: All complete — 2026-06-23

1. [x] Add migration for `resubmit_changed_order`.
Done when function exists, helper updated, storage policies widened, and grants added.

2. [x] Add verification SQL.
Done when read-only checks cover RPC signature, helper, policies, bucket config, and orphan scan.

3. [x] Add contract test.
Done when test reads migration/verification SQL and asserts required backend strings.

4. [x] Validate current suite.
Done when `npm run validate` passes with new backend files.

5. [x] Keep frontend contract aligned.
Done when RPC signature matches current frontend payload and no extra backend parameter is required.
