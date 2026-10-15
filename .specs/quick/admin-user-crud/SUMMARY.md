# Admin User CRUD Live Validation Summary

## Input

- Load `.env` and `.env.e2e`.
- Verify env keys only as loaded/missing.
- Run validate, then headed live CRUD, then headless live CRUD if headed passes.

## Result

- `npm run validate`: pass.
- Headed live run: fail.
- Headless live run: not run.

## Failure

- Failing step: `deactivate disposable user`.
- Assertion: blocked badge not found inside exact disposable email row after refresh.
- Console signal: `Failed to fetch` from Supabase runtime, plus 404 noise.

## Cleanup

- Cleanup path attempted.
- Disposable user check after failure: none found.
- No additional disposable user created after failure.

## Notes

- No production code changed during this validation.
- No secrets printed.
