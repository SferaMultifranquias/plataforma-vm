# Cloudflare Pages Deployment — Design

## Architecture
```
                    Cloudflare Pages
                    ┌──────────────────────────────┐
  Browser ────────►  static/ (public/)             │
                    Pages Functions (/api/*)        │
                    └──────────────────────┬───────┘
                                           │
                                    Supabase
                                    Auth / REST / Storage
```

## Key Decisions

### Two-runtime strategy
- Express mode: existing `node server.js` for local dev and E2E
- Pages mode: `wrangler pages dev` for preview
- Shared portable core (`functions/_shared/admin-service.js`) for Functions
- Express service unchanged; contract tests prevent drift

### Static Supabase bundle
- `node_modules/@supabase/supabase-js/dist/umd/supabase.js` vendored into `public/vendor/supabase/supabase.js`
- Express route `/vendor/supabase/supabase.js` kept for backward compat but now serves real file
- Version 2.108.2

### Environment injection
- Express: `process.env` (existing .env loading)
- Pages Functions: `context.env` (Wrangler `.dev.vars` for local)

### Worker compatibility
- `crypto.randomBytes` → `crypto.getRandomValues(new Uint8Array(16))` in portable service
- No `require('node:crypto')` in portable code
- No filesystem, no child_process, no Express APIs in portable code
- `URL`, `fetch`, `Request`, `Response` only

### Secret boundary
- `SUPABASE_SERVICE_ROLE_KEY` only in Functions bindings
- `/api/config` returns only supabaseUrl + anonKey
- Bearer token extracted from `Authorization` header, validated via Supabase Auth API
- Caller identity never accepted from body/params/headers

### Browser security headers
- `public/_headers` applies the Pages CSP/security header baseline.
- CDN scripts are version-pinned and protected with SRI + `crossorigin="anonymous"`.
- CSP allows Supabase API calls with `connect-src https://*.supabase.co` and signed Storage images with `img-src https://*.supabase.co`.
- Current Tailwind CDN usage requires `script-src 'unsafe-eval'` and inline script/style allowances. Stricter CSP requires vendoring/building Tailwind.
- Browser CSP validation must run against Pages preview/deploy because Express does not apply `_headers`.

## File Organization
```
functions/
  _shared/
    admin-core.js      # pure functions (normalizers, DTOs, validators)
    admin-service.js   # portable service factory (Web Crypto, fetch)
    env.js             # environment value helpers
    http.js            # Response utilities
  api/
    config.js          # GET /api/config
    health.js          # GET /api/health
    admin/
      users/
        index.js       # GET+POST /api/admin/users
        [id].js        # PATCH+DELETE /api/admin/users/:id
      orders/
        [id].js        # DELETE /api/admin/orders/:id
```

## Rollback
- git revert Cloudflare commits
- keep Express mode working throughout
