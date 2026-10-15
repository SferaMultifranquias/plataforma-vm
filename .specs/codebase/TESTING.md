# Testing Infrastructure

## Test Frameworks

**Unit/Integration:** Node.js with `node:assert/strict`; no test runner package.  
**E2E:** Playwright available in `tests/e2e/` for live Supabase validation.
**Coverage:** no coverage tool detected.
**Security:** Static security coverage in `tests/server/security-hardening.test.js`, `tests/server/cloudflare-pages-contract.test.js`, `tests/server/e2e-runtime-safety.test.js`, `tests/server/supabase-verification-assets.test.js`, `tests/frontend/xss-escape.test.js`, and `tests/frontend/no-inline-events.test.js`.

## Test Organization

**Location:** `tests/frontend/` and `tests/server/`  
**Naming:** `*.test.js`  
**Structure:** Each file is an executable Node script. Most tests define local helpers, run assertions, and print success output.

## Testing Patterns

### Unit Tests

**Approach:** Require pure/shared modules and assert behavior directly.  
**Location:** `tests/frontend/order-rules.test.js`  
**Pattern:** Uses `node:assert/strict`, imports `order-rules.js` and `app-utils.js`, validates role mapping, status rules, form validation, filtering, pagination.

### Browser Module Tests

**Approach:** Load browser global modules in `vm` sandboxes with fake `window`, `document`, `fetch`, `lucide`, and Supabase stubs.  
**Location:** `tests/frontend/router.test.js`, `tests/frontend/auth.test.js`, `tests/frontend/users.test.js`, `tests/frontend/stores.test.js`, `tests/frontend/orders-module.test.js`, `tests/frontend/order-form.test.js`, `tests/frontend/inventory.test.js`

### Server Tests

**Approach:** Require server modules directly and stub HTTP/fetch behavior.  
**Location:** `tests/server/startup.test.js`, `tests/server/users.test.js`  
**Pattern:** `users.test.js` creates fetch stubs for Supabase Auth Admin and REST paths, then validates admin auth and CRUD behavior. `inventory-admin.test.js` tests auth gates, CRUD, quantity adjustment, validation, and prototype pollution rejection.

### E2E Tests

**Approach:** Playwright live browser tests gated by environment variables; smoke coverage still exists through PowerShell.
**Location:** `tests/e2e/`, `scripts/smoke/smoke-test.ps1`

## Playwright E2E Constraints

- **webServer command:** `node server.js` (not `npm start`)
- `reuseExistingServer: false` — prevents port-3000 conflicts from orphaned processes
- `stdout/stderr: 'pipe'` for diagnostics
- **Writes tests require `--workers=1`** (parallel sessions share storage state, causing session token leaks)
- Do NOT manually run `npm start` before E2E — Playwright manages server lifecycle
- Kill orphaned port-3000 listeners between failed runs

## Test Execution

**Commands:**

- `npm run check`: syntax, partial markup, and local reference validation.
- `npm test`: runs all Node test scripts listed in `package.json`.
- `npm run test:smoke`: runs PowerShell smoke test.
- `npm run validate`: runs check, tests, and smoke.
- `npm run e2e`: runs Playwright E2E headless (49 tests + optional CSP smoke, requires env vars).
- `npm run e2e -- tests/e2e/admin-user-removal.spec.js --workers=1`: targeted E2E user-removal (14 tests).
- `E2E_REQUIRE_CSP=true npm run e2e -- tests/e2e/csp-smoke.spec.js --workers=1`: optional CSP/SRI browser smoke against Pages preview.

**Configuration:** Inline npm scripts in `package.json`; Playwright config in `playwright.config.js`.

## Coverage Targets

**Current:** Not measured.  
**Goals:** Not documented.  
**Enforcement:** No coverage enforcement detected.

## Test Coverage Matrix

| Code Layer | Required Test Type | Location Pattern | Run Command |
| ---------- | ------------------ | ---------------- | ----------- |
| Pure shared rules/utilities | Unit | `tests/frontend/*rules*.test.js`, shared utility assertions | `npm test` |
| Browser routing/auth/pages | Browser-module sandbox | `tests/frontend/*.test.js` (25 inventory groups) | `npm test` |
| Server admin API/service | Unit/integration-like with stubs | `tests/server/*.test.js` | `npm test` |
| Static route/partial integrity | Static check + assertions | `scripts/maintenance/check-project.js`, `tests/frontend/router.test.js` | `npm run check`, `npm test` |
| Supabase migrations/RLS/RPCs | Manual/live SQL verification | `supabase/verification/*.sql` | no npm command |
| Full browser behavior | Playwright E2E | `tests/e2e/*.spec.js` | `npm run e2e` |
| CSP/SRI browser behavior | Optional Playwright E2E against Pages preview | `tests/e2e/csp-smoke.spec.js` | `E2E_REQUIRE_CSP=true npm run e2e -- tests/e2e/csp-smoke.spec.js --workers=1` |

## Security Validation Notes

- `npm test` validates CSP/SRI statically, including pinned CDN URLs, `integrity`, `crossorigin`, Supabase `connect-src`, Storage `img-src`, and security workflow baseline.
- Real CSP enforcement requires Cloudflare Pages preview or deployment because Express local does not apply `public/_headers`.
- Hosted RLS, IDOR, Storage, and stale-session tests remain deferred until explicit non-production approval.

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| Pure shared unit tests | Yes | In-process assertions, no shared external state | `tests/frontend/order-rules.test.js` |
| Browser module sandbox tests | Mostly yes per file | Each file creates fake window/document/sandbox | `tests/frontend/router.test.js` |
| Server service tests | Mostly yes per file | Stubbed fetch routes, no real Supabase writes | `tests/server/users.test.js` |
| Playwright E2E | No — requires `--workers=1` | Shared browser profile storage leaks Supabase session tokens | `admin-user-removal.spec.js`, `order-review-branches.spec.js` |
| Smoke tests | No assumption | External process/server behavior | `scripts/smoke/smoke-test.ps1` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Docs/static-only or small pure JS changes | `npm run check` |
| Standard | Frontend/server logic changes | `npm test` |
| Full | Route, server, auth, Supabase-adjacent, or release validation | `npm run validate` |
