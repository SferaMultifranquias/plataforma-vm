# Multi-Image + Delivery Lifecycle

## Multi-Image Upload

### Goal
Allow users to attach multiple images to a single order, with a persistent file-picker trigger that remains available after each selection.

### Requirements (create mode)
- `#foto-input` has `multiple` attribute
- After selecting images, `#upload-area` remains visible (not hidden)
- Label shows "Arraste as fotos ou clique para selecionar" when no local images, "Adicionar mais imagens" when 1+
- Later picker actions **append** images (do not replace)
- `input.value` cleared after every selection to allow same-file reselection
- Remove button per image card
- Submission uploads each file to Storage and creates one `order_images` record per file

### Requirements (edit mode)
- Persisted images shown in `#edit-images-section` with toggle-remove
- `#upload-area` visible (same behavior as create mode)
- New local images shown in `#image-gallery`
- `resubmit_changed_order_multi_image` RPC handles items + new image metadata + removed image IDs atomically

### Original root cause (regression fix)
`handleImagesUpload()` and `handleImagesDrop()` called `uploadArea.classList.add('hidden')` after first successful file add, hiding the file-picker permanently. Fix: removed those hidden calls; `renderImageGallery()` now owns visibility.

---

# Delivery Lifecycle — Order Placed + Received

## Goal
Add post-approval delivery lifecycle: ADMIN marks order as placed (with protocol + delivery date), requester confirms receipt.

## Requirements
- Add `ORDER_PLACED`, `RECEIVED` statuses (transition `APPROVED → ORDER_PLACED → RECEIVED`)
- Add `delivery_protocol`, `delivery_date`, `placed_by_id`, `placed_at`, `received_by_id`, `received_at` columns to `orders`
- ADMIN-only `mark_order_placed` RPC: validates active + ADMIN + APPROVED, sets protocol/date/status
- Requester-only `confirm_order_received` RPC: validates active + owner + ORDER_PLACED, sets receipt fields
- Drawer renders delivery form for APPROVED (ADMIN), confirm button for ORDER_PLACED (requester), final message for RECEIVED
- Fix: `APPROVED` is no longer a final status; `RECEIVED` is the sole final delivery state
- Fix: drawer branch ordering — `APPROVED` shows placement form, not review buttons

## Non-goals
- Image management in lifecycle
- Hard-delete changes
- RPC modifications for existing review/delete flows

---

## Cache/Asset-Freshness Strategy

### Problem
Manual browser may serve stale `order-form-module.js` from cache, hiding multi-image fixes.

### Root cause
- Express `express.static()` defaulted to `Cache-Control: public, max-age=0`
- No version query strings on JS/CSS module URLs
- `window.APP_VERSION` was stale (`20260618-2`)

### Server changes
- `express.static(PUBLIC_DIR, { setHeaders })` sets `Cache-Control: no-store, max-age=0` for `.html`, `.js`, `.mjs` files
- Route fallback handlers (SPA routes) set `Cache-Control: no-store, max-age=0`
- CSS and other asset types keep existing default behavior (`public, max-age=0`)

### Version marker
- `window.APP_VERSION` updated to `20260629-1`
- Used by `app-shell.js` `loadPagePartial()` as query param for partial HTML cache bust (`/pages/novo-pedido.html?v=20260629-1`)

### Script/link versioning
- All 12 local `<script src>` tags and 5 `<link>` CSS tags include `?v=20260629-1` query string
- CDN/external scripts remain unversioned
