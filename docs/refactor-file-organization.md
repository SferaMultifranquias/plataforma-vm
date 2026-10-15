# HISTORICAL REFERENCE — NOT AUTHORITATIVE FOR CURRENT BACKLOG

This document records the directory reorganization completed in 2026. Current architecture, backlog, and priorities are documented in:
- `AGENTS.md`
- `CODEx_CONTEXT.md`

> Do not use this document for current task prioritization or code structure decisions. It is preserved for historical reference only.

# Reorganizacao de diretorios

## Convencoes aceitas

- `public/` contem somente arquivos que o navegador pode carregar.
- `src/server/` contem codigo server-only do Express, rotas e servicos.
- `tests/frontend/` e `tests/server/` contem testes automatizados.
- `scripts/admin/`, `scripts/maintenance/` e `scripts/smoke/` separam scripts operacionais.
- `supabase/migrations/` e `supabase/verification/` permanecem no lugar; migrations aplicadas nao devem ser renomeadas.

## Caminhos principais

```text
public/index.html
public/pages/
public/styles/pages/
public/js/core/
public/js/shared/
public/js/pages/
src/server/app.js
src/server/routes/
src/server/services/
```

## Ordem de migracao

1. Isolar static root em `public/`.
2. Separar app Express em `src/server/app.js`.
3. Mover modulos frontend mantendo scripts globais e ordem de carregamento.
4. Mover testes e scripts administrativos.
5. Remover diretorios antigos somente apos validacao completa.

## Validacao minima

```text
npm run check
npm test
npm run test:smoke
npm run validate
```
