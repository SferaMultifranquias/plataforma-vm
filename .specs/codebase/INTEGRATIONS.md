# External Integrations

## Supabase Auth

**Service:** Supabase Auth  
**Purpose:** Login, session restoration, current user lookup, admin user creation/update/delete.  
**Implementation:** Browser auth in `public/js/core/auth.js`; server admin calls in `src/server/services/supabase-admin-service.js`.  
**Configuration:** `SUPABASE_URL`/`VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`.  
**Authentication:** Browser uses anon key and user session; server admin service validates bearer token then uses service role.

## Supabase PostgreSQL

**Service:** Supabase REST/PostgREST and RPCs  
**Purpose:** Profiles, stores, orders, items, images, history, audit logs, user-store links.  
**Implementation:** Browser Supabase client in `orders-data.js`, `stores-module.js`, `auth.js`; server REST calls in `supabase-admin-service.js`.  
**Configuration:** SQL migrations in `supabase/migrations/`.  
**Authentication:** RLS for browser access; service role for server admin user operations.

## Supabase Storage

**Service:** Supabase Storage bucket `order-images`  
**Purpose:** Private order image upload and signed display URLs.  
**Implementation:** Upload and metadata link in `public/js/pages/orders/orders-data.js`; signed URL creation in `loadOrderImagesWithSignedUrls()`.  
**Configuration:** Bucket and policies in Supabase migrations; file limit and MIME types configured for JPEG, PNG, WebP.  
**Authentication:** Authenticated browser client with RLS/storage policies; signed URLs for display.

## API Integrations

### `/api/config`

**Purpose:** Provide browser-safe Supabase URL and anon key.  
**Location:** `src/server/app.js`  
**Authentication:** Public.  
**Key endpoints used:** `GET /api/config`

### `/api/health`

**Purpose:** Backend healthcheck.  
**Location:** `src/server/app.js`  
**Authentication:** Public.  
**Key endpoints used:** `GET /api/health`

### `/api/admin/users`

**Purpose:** Secure administrative user CRUD.  
**Location:** `src/server/routes/users-admin.js`, `src/server/services/supabase-admin-service.js`  
**Authentication:** Bearer token from active ADMIN user, then server-side service role.  
**Key endpoints used:** `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`

## CDN Libraries

**Service:** Tailwind CDN, Lucide CDN, js-sha256 CDN, XLSX CDN; Supabase browser bundle is vendored locally.  
**Purpose:** Styling utilities, icons, hashing/export support, browser Supabase client.  
**Implementation:** Version-pinned CDN `<script>` tags in `public/index.html`; Supabase bundle in `public/vendor/supabase/supabase.js`.  
**Configuration:** CDN scripts use SRI + `crossorigin="anonymous"`; CSP lives in `public/_headers`.  
**Authentication:** None for CDN loads.

Security notes:
- Tailwind CDN requires weak CSP allowances (`script-src 'unsafe-eval'`, inline config, and `style-src 'unsafe-inline'`). Vendoring/building Tailwind is the path to stricter CSP.
- Supabase browser calls require `connect-src https://*.supabase.co`.
- Storage signed image display requires `img-src https://*.supabase.co`.
- Browser CSP validation is pending via Pages preview (`E2E_REQUIRE_CSP=true`).

## Webhooks

No webhook handlers detected.

## Background Jobs

**Queue system:** none detected.  
**Location:** none.  
**Jobs:** none detected.

## Operational Scripts

**Admin creation:** `scripts/admin/create-admin.ps1` and `scripts/admin/create-admin.js` use real Supabase env values to create/update admin users.  
**Smoke tests:** `scripts/smoke/smoke-test.ps1` validates running app behavior.
