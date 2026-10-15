# Playwright E2E Design

## Approach

Use one serial Playwright spec for ADMIN CRUD against live app. Keep existing Node tests unchanged.

## File Structure

```text
playwright.config.js
tests/e2e/admin-users.spec.js
tests/e2e/helpers/auth.js
tests/e2e/helpers/runtime.js
tests/e2e/helpers/users-admin.js
.env.e2e.example
```

## Execution Flow

1. Playwright starts or reuses app with existing `npm start` command.
2. Playwright waits for `GET /api/health`.
3. Test checks `E2E_ALLOW_LIVE_CRUD === 'true'` before login.
4. Test logs only hostname being targeted.
5. ADMIN login uses `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.
6. Disposable email is generated from timestamp + random bytes + `E2E_TEST_EMAIL_DOMAIN`.
7. CRUD flow runs in serial order.
8. Cleanup runs in `finally` or equivalent teardown.
9. UI delete is attempted first during cleanup.
10. Fallback cleanup may call `/api/admin/users` with browser session bearer token only.

## Safeguards

- No `SUPABASE_SERVICE_ROLE_KEY` in browser tests.
- No token, password, cookie, or session logging.
- No query strings in host log output.
- Abort early if live CRUD flag is not exact `true`.
- Warn when target host is not localhost.

## Playwright Config

- `workers: 1`
- `fullyParallel: false`
- `trace: 'retain-on-failure'`
- `screenshot: 'only-on-failure'`
- `webServer.command = npm start`
- `webServer.url = http://127.0.0.1:3000/api/health`
- `webServer.reuseExistingServer = true` for local runs

## Cleanup Strategy

- Track disposable user email and any created state in test scope.
- Prefer UI-driven delete.
- If UI cleanup fails, use authenticated browser-session request to `/api/admin/users`.
- On cleanup failure, report leftover disposable email only.

## npm Scripts

- `test:e2e`: headless Playwright.
- `test:e2e:headed`: headed Playwright.
- `test:e2e:ui`: Playwright UI mode.
- `validate:e2e`: `npm run validate && npm run test:e2e`.

## CI Notes

- Keep E2E opt-in until staging secrets and cleanup are stable.
- Run sequentially only.
- Store artifacts only on failure.
- Prefer protected non-production environment.
