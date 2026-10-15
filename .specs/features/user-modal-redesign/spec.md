# User Modal Redesign — Spec

## Approved Target

Attached image is visual target for both create/edit modal modes.

## Scope

UI-only redesign of `#users-create-modal` in `public/pages/usuarios.html`.

- Create mode: `Novo usuário`
- Edit mode: `Editar usuário`
- Preserve business rules, API contracts, selectors, security, Sfera VM colors.

## Sections

1. Header: title, subtitle, close button.
2. Error / success feedback.
3. `Dados da conta`: icon heading, stacked fields, inline password toggle.
4. `Configuração de acesso`: icon heading, balanced role/active row.
5. `Lojas permitidas`: icon heading, selected count, collapsed multi-select dropdown.
6. Footer: `Cancelar`, `Criar usuário` / `Salvar alterações`.

## Required Visual Direction

- white modal
- dark slate text
- blue primary actions
- neutral gray borders
- icon circles on light-blue background
- clear section cards
- 44px to 48px controls
- 8px to 12px radius
- footer separated from body
- dropdown panel bounded and searchable

## Preserved IDs

Preserve all existing `users-create-*` IDs. New IDs only where needed for dropdown trigger/panel.

## Out of Scope

- database schema / migrations
- Supabase config
- API contracts
- password generation rules
- role mapping
- authorization changes
- dependencies
- E2E execution

## Responsive

- Desktop: centered modal, account stacked, access row balanced, dropdown full width.
- Tablet: modal uses most width, dropdown remains usable.
- Mobile: one column, stacked footer buttons, bounded dropdown.

## Accessibility

- `role="dialog"`, `aria-modal="true"`
- `aria-labelledby="users-create-title"`
- `aria-describedby="users-create-subtitle"`
- initial focus on name field
- Escape closes dropdown first, modal second
- focus returns to trigger after close
- password toggle label changes between `Mostrar senha` / `Ocultar senha`
- store dropdown keyboard accessible
- errors keep `role="alert"` / `aria-live`
