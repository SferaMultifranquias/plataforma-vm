# Multi-Image Upload Design

## Persistent trigger behavior

```
[upload-area]  ← always visible, clickable
  └─ [image-upload-label]
       ├─ no newImages → "Arraste as fotos ou clique para selecionar"
       └─ has newImages → "Adicionar mais imagens"
  └─ [foto-input type=file multiple]  ← hidden, triggers file picker
       └─ on change → handleImagesUpload(input)
            ├─ reads input.files → addNewImages(files)
            ├─ clears input.value (for same-file reselection)
            └─ NEVER hides upload-area ← original bug fix

[image-gallery]  ← visible when newImages.length > 0
  └─ [image-gallery-container]
       └─ div[data-image-id] per image
            ├─ img[src=blob:]  preview
            └─ button[data-action=remove-new-image]

[edit-images-section]  ← visible when mode=EDIT_CHANGES + existingImages.length > 0
  └─ [edit-images-container]
       └─ div[data-image-id] per persisted image
            ├─ img or "Sem preview" placeholder
            └─ button[data-action=toggle-existing-image]
```

## Reset flow
```
resetForm()
  ├─ formState.newImages = []
  ├─ updateUploadLabel()  → "Arraste as fotos ou clique para selecionar"
  ├─ upload-area .hidden removed
  ├─ image-gallery .hidden added
  └─ edit-images-section .hidden added
```

## Submission flow (create)
```
submitForm()
  └─ enviarPedidoAPI()
       ├─ create_order RPC
       ├─ order_items insert
       └─ forEach image in newImages:
            ├─ calcularHashArquivo()
            ├─ sb.storage.upload(bucket, path, file)
            └─ order_images insert
       └─ submit_order RPC
```

## Submission flow (edit)
```
submitForm()
  └─ resubmitChangedOrderAPI()
       ├─ forEach new image: storage upload + metadata
       ├─ forEach removed image: storage delete
       └─ resubmit_changed_order_multi_image RPC (atomic)
```

# Delivery Lifecycle — Design

## Status flow
```
APPROVED → ORDER_PLACED → RECEIVED
```

## Schema
`orders` columns:
- `delivery_protocol TEXT`, `delivery_date DATE` — set by ADMIN when marking placed
- `placed_by_id UUID → auth.users`, `placed_at TIMESTAMPTZ` — placed metadata
- `received_by_id UUID → auth.users`, `received_at TIMESTAMPTZ` — receipt metadata

## RPCs

### `mark_order_placed(order_id UUID, protocol TEXT, delivery_date DATE)`
- Security: `set search_path = ''`, `security definer`, authenticated + check is_admin
- Validates: profile active, status == 'APPROVED'
- Mutations: update status='ORDER_PLACED', delivery_protocol, delivery_date, placed_by_id, placed_at
- Also: insert status_history + audit_logs
- Returns: void

### `confirm_order_received(order_id UUID)`
- Security: same pattern
- Validates: profile active, user owns order, status == 'ORDER_PLACED'
- Mutations: update status='RECEIVED', received_by_id, received_at
- Also: insert status_history + audit_logs
- Returns: void

## FE wire
- `renderDrawer` branch ordering: `changes_requested/approved-delivered` checked first, then `order_placed`, then `received`
- `APPROVED` → delivery form (protocol + date + submit)
- `ORDER_PLACED` → if requester: confirm button; else: "Aguardando confirmação"
- `RECEIVED` → final message with receipt metadata

## Key constraint
- `APPROVED` removed from `FINAL_STATUSES` — `RECEIVED` is the sole terminal state
- `mark_order_placed` idempotent: 2nd call fails with status check
- `confirm_order_received` idempotent: same

---

## Cache/Asset-Freshness Design

### Strategy: dual protection (server headers + URL versioning)

### Layer 1: Server cache headers
```
express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if ext is .html/.js/.mjs:
      res.setHeader('Cache-Control', 'no-store, max-age=0')
  }
})
```
- Forces browser to request fresh copy every time for mutable application code
- CSS/images/fonts keep `public, max-age=0` (revalidating, can use ETag)

### Layer 2: Version query strings
- `index.html` embeds `window.APP_VERSION = '20260629-1'`
- All `<script src>` and `<link>` tags include `?v=APP_VERSION`
- Partial HTML loading (`app-shell.js` → `loadPagePartial()`) already appends `?v=APP_VERSION`
- Changes all URLs on version increment, bypassing any intermediate cache

### Layer 3: Runtime marker
```js
window.APP_VERSION  // inspectable from DevTools console
```
- Single source of truth for version
- Incremented as part of each release/deployment
- Enables comparison between source, Playwright, and manual browser
