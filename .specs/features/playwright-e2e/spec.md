# Playwright E2E Spec

**Mode:** quick
**Status:** approved for infrastructure only, no live CRUD execution yet
**Scope:** ADMIN user CRUD workflow in `/usuarios`

## Goal

Add Playwright E2E coverage for live browser validation without replacing existing Node-based tests or changing production behavior.

## Requirements

### Functional

- `E2E-001`: Use Playwright for browser E2E.
- `E2E-002`: Preserve existing tests and `npm run validate`.
- `E2E-003`: Authenticate with dedicated ADMIN test account from env.
- `E2E-004`: Generate disposable user email as `e2e-user-<timestamp>-<random>@<E2E_TEST_EMAIL_DOMAIN>`.
- `E2E-005`: Use `E2E_TEST_USER_PASSWORD` from env; keep it in memory only.
- `E2E-006`: Abort before login or data creation unless `E2E_ALLOW_LIVE_CRUD=true`.
- `E2E-007`: Run sequentially.
- `E2E-008`: Cleanup disposable user in teardown; prefer UI delete first, fallback to admin API with browser session token only.
- `E2E-009`: Verify blocked user cannot log in; verify reactivated user can log in.
- `E2E-010`: Confirm admin-only access to `/usuarios`.
- `E2E-011`: Do not print secrets, tokens, cookies, sessions, or service role key.
- `E2E-012`: Collect screenshot, trace, console errors, and network failures only on failure.

### Operational

- `E2E-013`: Keep live CRUD opt-in through separate npm commands.
- `E2E-014`: Validate target host before data creation; warn when host is not localhost.
- `E2E-015`: Use existing application start command and wait for `/api/health`.

## Required Env Vars

- `E2E_BASE_URL`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_TEST_USER_PASSWORD`
- `E2E_TEST_EMAIL_DOMAIN`
- `E2E_ALLOW_LIVE_CRUD`

## Deliverables

- Playwright config and test files
- `.env.e2e.example`
- `.gitignore` updates for artifacts and local E2E env files
- npm scripts for opt-in E2E

## Non-Goals

- No production code changes for test convenience.
- No migration changes.
- No live CRUD execution until explicitly approved.
