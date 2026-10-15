# User Modal Redesign — Tasks

## Previous Iteration

- Completed: first-pass modal reshape with scrollable body, pinned footer, and inline password toggle.

## Second-Pass Implementation

- [ ] Update modal header hierarchy to match approved reference
- [ ] Convert account section to stacked field layout
- [ ] Add icon heading rows for all section cards
- [ ] Balance access section into two columns on desktop
- [ ] Add collapsed multi-select trigger for permitted stores
- [ ] Add dropdown panel for search + checkbox list
- [ ] Add dropdown open/close state to `users-module.js`
- [ ] Preserve selected-store count and persistence
- [ ] Preserve password toggle behavior and accessibility
- [ ] Keep payloads, validation, auth, and selectors unchanged
- [ ] Update frontend static tests for new structure
- [ ] Update server sandbox tests if needed for dropdown behavior
- [ ] Update TLC spec/design/tasks to reflect second pass
- [ ] Run validation commands
- [ ] Update `CODEx_CONTEXT.md` after validation

## Validation Plan

- `node tests/frontend/users.test.js`
- `node tests/server/users.test.js`
- `git diff --check`
- `npm run check`
- `npm test`
- `git status --short`
