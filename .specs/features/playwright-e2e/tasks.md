# Playwright E2E Tasks

## Phase 1: Docs

1. Create `spec.md`.
2. Create `design.md`.
3. Create `tasks.md`.

Verification: files exist under `.specs/features/playwright-e2e/`.

## Phase 2: Dependencies

1. Install `@playwright/test`.
2. Install Chromium browser.

Verification: `npm ls @playwright/test` and Playwright install output.

## Phase 3: Configuration

1. Add `playwright.config.js`.
2. Add opt-in npm scripts.
3. Add `.env.e2e.example`.
4. Update `.gitignore` for artifacts and local E2E env files.

Verification: `npx playwright test --list`.

## Phase 4: Tests

1. Add serial ADMIN CRUD E2E spec.
2. Add helper modules for runtime, auth, and users API/session cleanup.

Verification: `npm run test:e2e -- --list`.

## Phase 5: Non-Destructive Checks

1. Run `npm run validate`.
2. Run static inspection to confirm no browser test references `SUPABASE_SERVICE_ROLE_KEY`.

Verification: command output only, no live CRUD execution.
