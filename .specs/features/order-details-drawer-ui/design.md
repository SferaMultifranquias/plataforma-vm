# Design

## Summary Grid

```css
.orders-drawer-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 480px) {
  .orders-drawer-summary-grid {
    grid-template-columns: 1fr;
  }
}
```

Replaces the previous inline `grid grid-cols-2 gap-3` Tailwind utility.

## Textarea

```css
.orders-drawer-textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 140px;
  padding: 0.875rem 1rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.75rem;
  resize: vertical;
}

.orders-drawer-textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
```

Uses project colors: `#cbd5e1` (slate-300 border from `form-input`), `#2563eb` (blue-600 focus), `rgba(37, 99, 235, 0.12)` (blue-600 at 12% focus ring from existing `orders-filter-row` pattern).

Existing disabled/read-only and error variants preserved.

## Drawer Layout

- Summary row: 2 equal cards filling available width
- Textarea wrapper `#drawer-justificativa-bloco` does not constrain width
- Drawer body scrollable, footer fixed/accessible
- Delete-block red zone preserved
- All existing action buttons, image gallery, item list, movement history unchanged
