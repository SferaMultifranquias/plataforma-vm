# Tech Stack

**Analyzed:** 2026-06-22

## Core

- Framework: Express `^4.19.2`
- Language: JavaScript, CommonJS on server, browser globals on frontend
- Runtime: Node.js
- Package manager: npm (`package-lock.json` present)

## Frontend

- UI Framework: none; HTML partials plus plain browser JavaScript
- Styling: Tailwind CDN in `public/index.html`, inline shell utilities, page CSS in `public/styles/pages/`
- State Management: module-local variables and globals (`currentUser`, `AppShellModule`, page modules)
- Form Handling: native DOM forms and custom validation in `public/js/shared/order-rules.js`
- Browser libraries: Supabase JS v2 CDN, Lucide CDN, js-sha256 CDN, XLSX CDN

## Backend

- API Style: REST-like Express endpoints in `src/server/app.js` and `src/server/routes/`
- Database: Supabase PostgreSQL via browser Supabase client and server-side REST/Auth HTTP calls
- Authentication: Supabase Auth; server admin endpoints validate bearer token before service-role work
- Environment: `dotenv` `^16.4.5`
- CORS: `cors` `^2.8.5`

## Testing

- Unit/Integration: Node scripts with `node:assert/strict`, `vm`, and hand-written stubs
- E2E: no browser E2E framework detected
- Smoke: PowerShell script in `scripts/smoke/smoke-test.ps1`

## External Services

- Auth: Supabase Auth
- Database: Supabase PostgreSQL with RLS and RPCs
- Storage: Supabase Storage private bucket `order-images`
- CDN: Tailwind, Lucide, Supabase JS, js-sha256, XLSX

## Development Tools

- Dev server: `nodemon` `^3.1.4`
- Supabase tooling: `supabase` `^2.107.0` dev dependency
- Static checks: `scripts/maintenance/check-project.js`
