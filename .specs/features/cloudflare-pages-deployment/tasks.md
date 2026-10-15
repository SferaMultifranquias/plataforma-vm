# Cloudflare Pages Deployment — Tasks

## States
- planned
- in progress
- implemented
- locally validated
- preview validated
- production validated
- completed

## Tasks

### Phase 1: Feature docs
- [x] spec.md
- [x] design.md
- [x] tasks.md
Status: **implemented**

### Phase 2: Static clean-URL routing
- [x] Create public/_redirects
Status: **implemented**

### Phase 3: Static Supabase browser bundle
- [x] Copy dist/umd/supabase.js to public/vendor/supabase/
- [x] Verify version 2.108.2
Status: **implemented**

### Phase 4: Shared portable server core
- [x] Create functions/_shared/admin-core.js (pure functions)
- [x] Create functions/_shared/admin-service.js (portable service with Web Crypto)
- [x] Create functions/_shared/env.js
- [x] Create functions/_shared/http.js
Status: **implemented**

### Phase 5: Function response utilities
- [x] Covered by _shared/http.js + _shared/env.js
Status: **implemented**

### Phase 6: /api/config Function
- [x] Create functions/api/config.js
Status: **implemented**

### Phase 7: /api/health Function
- [x] Create functions/api/health.js
Status: **implemented**

### Phase 8: Admin users Functions
- [x] Create functions/api/admin/users/index.js
- [x] Create functions/api/admin/users/[id].js
Status: **implemented**

### Phase 9: Admin order deletion Function
- [x] Create functions/api/admin/orders/[id].js
Status: **implemented**

### Phase 10: Express compatibility
- [x] Express unchanged (separate implementation)
- [x] Contract tests added to prevent drift
Status: **implemented**

### Phase 11: Static headers
- [x] Create public/_headers
- [x] Add CSP baseline with Supabase API/storage allowances
Status: **implemented**

### Phase 12: Cloudflare local config
- [x] Create wrangler.toml
- [x] Create .dev.vars.example
- [x] Add .dev.vars to .gitignore
Status: **implemented**

### Phase 13: Package scripts
- [x] Added `preview:pages` script (uses npx wrangler)
Status: **implemented**

### Phase 14: Separate Playwright Pages configuration
- [ ] Deferred: requires Wrangler installed + .dev.vars with real values
Status: **planned**

### Phase 15: Tests
- [x] Static file tests (_redirects, _headers, bundle, secrets)
- [x] Admin core pure function unit tests
- [x] HTTP utility unit tests
- [x] Env helper unit tests
- [x] Contract parity checks (Express vs Pages core)
- [x] CSP/SRI/static workflow guards in `cloudflare-pages-contract.test.js`
- [x] Optional browser CSP smoke spec (`tests/e2e/csp-smoke.spec.js`, requires Pages preview + `E2E_REQUIRE_CSP=true`)
- [ ] Full Pages Function integration tests deferred (need .dev.vars with real keys)
- [ ] Browser CSP validation deferred (need Pages preview with headers applied)
Status: **implemented**

### Phase 16: Local validation
- [x] git diff --check: PASS (CRLF warnings only)
- [x] npm run check: PASS (55 files)
- [x] npm test: PASS (12 suites)
- [x] npm run test:smoke: PASS
Status: **locally validated**

### Phase 17: Documentation update
- [x] Update README.md
- [x] Update CODEx_CONTEXT.md
- [x] Update AGENTS.md
- [x] Update .specs/codebase/ files
Status: **implemented**

## Overall Status
**locally validated**

## Notes
- Supabase Dashboard changes (Site URL, redirects) deferred
- Password recovery remains a documented gap
- E2E requires explicit authorization
- Tailwind CDN requires weak CSP allowances (`unsafe-inline`, `unsafe-eval`) until vendored/built
