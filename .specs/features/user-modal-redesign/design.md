# User Modal Redesign — Design

## Layout

```
Modal
├── Header
│   ├── Title + subtitle
│   └── Close button
├── Body
│   ├── Error / success
│   ├── Section card: Dados da conta
│   │   ├── icon heading
│   │   ├── name
│   │   ├── email
│   │   └── password wrapper + inline toggle
│   ├── Section card: Configuração de acesso
│   │   ├── icon heading
│   │   └── balanced two-column row
│   └── Section card: Lojas permitidas
│       ├── icon heading + count
│       ├── trigger button
│       └── dropdown panel
└── Footer
    ├── Cancelar
    └── Criar / Salvar
```

## Section Cards

- rounded white cards
- 1px slate border
- light-blue circular icons
- bold section headings
- 16–24px internal spacing

## Stores Dropdown

- `storesOpen` controls open/closed state
- trigger button controls dropdown visibility
- `aria-expanded` mirrors `storesOpen`
- `aria-controls="users-create-store-dropdown"`
- dropdown stays inside stores card
- search input + checkbox list live in dropdown
- list gets internal scrolling
- no-results and loading states rendered in same panel
- click outside closes only dropdown
- Escape closes dropdown before modal

## Password Field

- toggle remains real button inside wrapper
- icon swap via existing Lucide eye / eye-off
- aria-label toggles between `Mostrar senha` and `Ocultar senha`

## Access Row

- role select left
- active toggle right
- optional divider on desktop
- stacks to one column on mobile

## Responsive

- width `min(880px, calc(100vw - 2rem))`
- height `calc(100dvh - 2rem)`
- body scroll only when needed
- footer pinned visually separated

## Accessibility

- dialog semantics preserved
- initial focus on name field
- focus return on close
- Escape order: dropdown first, modal second
- Tab trap minimal, scoped to modal if browser allows focus escape
- labels remain connected
- errors remain live regions
