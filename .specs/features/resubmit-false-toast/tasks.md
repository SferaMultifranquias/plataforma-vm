# Tasks

0. [x] Add hidden `#f-justification` textarea to `novo-pedido.html`
   - File: `public/pages/novo-pedido.html`
   - Element: `<textarea id="f-justification" class="hidden" aria-hidden="true"></textarea>`
   - No `name` attribute — not submitted with form
   - Sibling of `#f-motivo` select
   - Done when: `populateFormFromOrder` can hydrate, `syncGeneralStateFromDom` reads as fallback

1. [x] Fix `submitForm()` — clear `orderId` from URL before re-init
   - File: `public/js/pages/order-form/order-form-module.js`
   - After `resetForm()`, before `await runtimeDeps.afterRenderForm()`
   - Use `history.replaceState` to strip `orderId` from URL search params
   - Preserve unrelated params, hash, history state
   - Done when: post-submit re-init does not attempt edit-load

2. [x] Update frontend test `order-form.test.js`
   - Verify `orderId` removed after successful resubmit
   - Verify unrelated query params remain
   - Verify URL hash preserved
   - Verify history state preserved
   - Verify no URL replacement when orderId absent
   - Verify legitimate edit-load errors still produce toast

3. [x] Extend E2E test `order-resubmit.spec.js`
   - Add UI lifecycle test in serial block
   - Create + submit order (RPC)
   - Request changes (RPC)
   - Open `/novo-pedido?orderId=X` via browser
   - Confirm edit mode hydration
   - Edit and submit through UI
   - Verify success toast, no false error toast
   - Verify URL cleaned, edit banner hidden
   - Verify order status PENDING_APPROVAL via RPC
   - Verify no replacement order
   - Verify single resubmit execution
   - Verify reopening blocked while PENDING_APPROVAL

4. [x] Update documentation
   - `CODEx_CONTEXT.md`: validation status, feature map, known issues
   - `.specs/codebase/CONCERNS.md`: resolved entry + parallel E2E concern
   - `AGENTS.md` §20: add fix entry
   - `.specs/features/resubmit-false-toast/spec.md`: dual root cause
   - `.specs/features/resubmit-false-toast/tasks.md`: this file

5. [x] Validate
   - `npm run test:e2e -- tests/e2e/order-resubmit.spec.js --workers=1`
   - `npm run test:e2e -- tests/e2e/order-review-branches.spec.js --workers=1`
   - `npm run validate`
   - `git diff --check`
