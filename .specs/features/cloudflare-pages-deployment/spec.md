# Cloudflare Pages Deployment

## Summary
Deploy Sfera VM as static frontend + Cloudflare Pages Functions while preserving Express local development. Privileged Supabase operations stay server-side.

## Routes
- `public/` static files served by Cloudflare Pages
- Shell routes (`/dashboard`, `/login`, `/pedidos`, `/novo-pedido`, `/lojas`, `/usuarios`) rewritten to `/index.html` via `_redirects`
- `/api/config`, `/api/health`, `/api/admin/users`, `/api/admin/orders/:id` via Pages Functions
- `/vendor/supabase/supabase.js` vendored as static file

## API Surface
| Route | Method | Auth | Notes |
|-------|--------|------|-------|
| `/api/config` | GET | public | returns supabaseUrl + anonKey |
| `/api/health` | GET | public | server healthcheck |
| `/api/admin/users` | GET | ADMIN bearer | paginated list |
| `/api/admin/users` | POST | ADMIN bearer | create user |
| `/api/admin/users/:id` | PATCH | ADMIN bearer | update user |
| `/api/admin/users/:id` | DELETE | ADMIN bearer | soft-remove user |
| `/api/admin/orders/:id` | DELETE | ADMIN bearer + password | delete order + storage cleanup |

## Environment Variables
### Browser-safe (returned by /api/config)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### Server-only (Pages Function bindings)
- `SUPABASE_SERVICE_ROLE_KEY`

### Supabase Dashboard (deferred)
- Site URL, redirect URLs for production/preview/local Wrangler
- Password recovery remains a documented gap

## Security
- `SUPABASE_SERVICE_ROLE_KEY` only accessible via `context.env` in Functions
- Never exposed to browser JavaScript
- Bearer token validated via `auth/v1/user` (anon-key path)
- Caller identity derived from validated token, never from request body/params

## Deployment
- Production branch: `main`
- Build command: `exit 0` (static only, no build step)
- Build output: `public/`
- Framework preset: None
