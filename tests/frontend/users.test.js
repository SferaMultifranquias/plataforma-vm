const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

async function run() {
  const html = read(path.join('public', 'pages', 'usuarios.html'));
  const css = read(path.join('public', 'styles', 'pages', 'users.css'));

  assert.ok(html, 'usuarios.html loaded');
  assert.ok(css, 'users.css loaded');

  // Toolbar card structure
  assert.match(html, /users-toolbar-card/);
  assert.match(html, /users-filters/);

  // 4 filter fields
  assert.match(html, /users-filter/);
  assert.match(html, /users-filter--search/);

  // Labels above controls
  assert.match(html, /<label for="users-search">Buscar usuário<\/label>/);
  assert.match(html, /<label for="users-role">Perfil<\/label>/);
  assert.match(html, /<label for="users-status">Status<\/label>/);
  assert.match(html, /<label for="users-store">Loja<\/label>/);

  // Search icon inside wrapper
  assert.match(html, /users-search-wrapper/);
  assert.match(html, /data-lucide="search"/);

  // All filter IDs preserved
  assert.match(html, /id="users-search"/);
  assert.match(html, /id="users-role"/);
  assert.match(html, /id="users-status"/);
  assert.match(html, /id="users-store"/);

  // Select options preserved
  assert.match(html, /Todos os perfis/);
  assert.match(html, /Todos os status/);
  assert.match(html, /Todas as lojas/);
  assert.match(html, /Nome ou e-mail/);

  // Header actions unchanged
  assert.match(html, /id="users-create-open"/);
  assert.match(html, /Novo Usuário/);
  assert.match(html, /id="users-refresh"/);
  assert.match(html, /Atualizar/);

  // Table card still exists
  assert.match(html, /users-table-card/);
  assert.match(html, /users-table-wrap/);
  assert.match(html, /users-table-header/);
  assert.match(html, /users-table-count/);
  assert.match(html, /users-pagination/);
  assert.match(html, /users-table-body/);
  assert.match(html, /<th class="table-th">Usuário<\/th>/);
  assert.match(html, /<th class="table-th">E-mail<\/th>/);
  assert.match(html, /<th class="table-th">Perfil<\/th>/);
  assert.match(html, /<th class="table-th">Lojas vinculadas<\/th>/);
  assert.match(html, /<th class="table-th">Status<\/th>/);
  assert.match(html, /<th class="table-th">Último acesso<\/th>/);
  assert.match(html, /<th class="table-th">Criado em<\/th>/);
  assert.match(html, /<th class="table-th">Ações<\/th>/);
  assert.match(html, /Carregando\.\.\./);
  assert.match(html, /colspan="8"/);
  assert.doesNotMatch(html, /colspan="7"/);

  // CSS has toolbar styles
  assert.match(css, /\.users-toolbar-card/);
  assert.match(css, /\.users-filters/);
  assert.match(css, /\.users-filter/);
  assert.match(css, /\.users-filter--search/);
  assert.match(css, /\.users-search-wrapper/);

  // Control dimensions match Stores
  assert.match(css, /min-height: 42px/);
  assert.match(css, /border-radius: 8px/);

  // Focus state
  assert.match(css, /border-color: #2563eb/);
  assert.match(css, /box-shadow: 0 0 0 3px rgba\(37, 99, 235, 0\.15\)/);

  // Select styling
  assert.match(css, /appearance: none/);

  // Table styles
  assert.match(css, /\.users-table-wrap\s*\{[^}]*border-radius:\s*10px/);
  assert.match(css, /\.users-table thead th\.table-th/);
  assert.match(css, /text-transform:\s*uppercase/);
  assert.match(css, /\.users-table tbody td\.table-td/);
  assert.match(css, /\.users-table tbody tr:last-child td\s*\{[^}]*border-bottom:\s*none/);
  assert.match(css, /\.users-table tbody tr:hover\s*\{/);
  assert.match(css, /table-layout:\s*fixed/);

  // Badge styles match stores pattern
  assert.match(css, /border-radius:\s*999px/);
  assert.match(css, /font-size:\s*11px/);
  assert.match(css, /padding:\s*2px\s+10px/);

  // Action button styles
  assert.match(css, /\.users-row-action--delete[^}]*border:\s*1px\s+solid\s+#fecaca/);

  // No modal or filter styles changed
  assert.match(css, /\.users-modal-panel/);
  assert.match(css, /\.users-create-primary/);

  // Responsive rules
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.users-toolbar-card\s*\{[^}]*flex-direction:\s*column[^}]*\}/);

  // Label styles
  assert.match(css, /\.users-filter label/);

  // Old filter classes removed
  assert.doesNotMatch(html, /users-filter-card/);
  assert.doesNotMatch(html, /users-filter-grid/);
  assert.doesNotMatch(html, /users-filter-field/);
  assert.doesNotMatch(html, /users-search-input/);

  // Modal structure
  assert.match(html, /users-create-modal/);
  assert.match(html, /users-modal-backdrop/);
  assert.match(html, /users-modal-panel/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="users-create-title"/);
  assert.match(html, /aria-describedby="users-create-subtitle"/);
  assert.match(html, /users-modal-header/);
  assert.match(html, /users-modal-body/);
  assert.match(html, /users-modal-footer/);

  // Section cards and icons
  assert.match(html, /users-section--account/);
  assert.match(html, /users-section--access/);
  assert.match(html, /users-section--stores/);
  assert.match(html, /users-section-heading/);
  assert.match(html, /users-section-icon/);
  assert.match(html, /data-lucide="user"/);
  assert.match(html, /data-lucide="lock"/);
  assert.match(html, /data-lucide="store"/);

  // Stacked account fields and full-width password
  assert.match(html, /Nome completo <span class="required-indicator">\*<\/span>/);
  assert.match(html, /E-mail <span class="required-indicator">\*<\/span>/);
  assert.match(html, /users-field--full/);
  assert.match(html, /users-password-wrapper/);
  assert.match(html, /users-password-toggle/);
  assert.match(html, /Você pode editar a senha antes de salvar/);

  // Access section and dropdown controls
  assert.match(html, /users-section-grid--access/);
  assert.match(html, /users-field--role/);
  assert.match(html, /users-field--active/);
  assert.match(html, /id="users-create-store-count"/);
  assert.match(html, /id="users-create-store-trigger"/);
  assert.match(html, /id="users-create-store-trigger-label"/);
  assert.match(html, /id="users-create-store-dropdown"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="users-create-store-dropdown"/);
  assert.match(html, /Selecionar lojas/);
  assert.match(html, /id="users-create-store-search"/);
  assert.match(html, /id="users-create-store-list"/);
  assert.match(html, /id="users-create-stores-error"/);
  assert.match(html, /users-create-store-trigger-chevron/);
  assert.match(html, /users-create-store-dropdown hidden/);

  // All stable IDs preserved
  assert.match(html, /id="users-create-form"/);
  assert.match(html, /id="users-create-title"/);
  assert.match(html, /id="users-create-subtitle"/);
  assert.match(html, /id="users-create-error"/);
  assert.match(html, /id="users-create-success"/);
  assert.match(html, /id="users-create-name"/);
  assert.match(html, /id="users-create-email"/);
  assert.match(html, /id="users-create-password"/);
  assert.match(html, /id="users-create-toggle-password"/);
  assert.match(html, /id="users-create-password-note"/);
  assert.match(html, /id="users-create-password-error"/);
  assert.match(html, /id="users-create-role"/);
  assert.match(html, /id="users-create-active"/);
  assert.match(html, /id="users-create-cancel"/);
  assert.match(html, /id="users-create-submit"/);

  // Footer buttons present
  assert.match(html, /users-create-cancel/);
  assert.match(html, /users-create-submit/);

  // Old modal classes removed
  assert.doesNotMatch(html, /users-create-password-header/);
  assert.doesNotMatch(html, /users-create-grid/);
  assert.doesNotMatch(html, /users-create-field--full/);
  assert.doesNotMatch(html, /users-create-store-header/);
  assert.doesNotMatch(html, /users-create-footer/);

  console.log('Users filter toolbar checks ok.');
  console.log('Users modal structure checks ok.');

  // Modal CSS checks
  assert.match(css, /\.users-modal-panel\s*\{[^}]*width:\s*min\(880px/);
  assert.match(css, /\.users-modal-header/);
  assert.match(css, /\.users-modal-body/);
  assert.match(css, /\.users-modal-footer/);
  assert.match(css, /\.users-section\s*\{/);
  assert.match(css, /\.users-section-heading/);
  assert.match(css, /\.users-section-icon/);
  assert.match(css, /\.users-section-grid--access/);
  assert.match(css, /\.users-password-wrapper/);
  assert.match(css, /\.users-password-toggle/);
  assert.match(css, /\.users-create-store-trigger/);
  assert.match(css, /\.users-create-store-dropdown/);
  assert.match(css, /\.users-store-search-wrapper/);
  assert.match(css, /min-height: 46px/);
  assert.match(css, /border-radius: 0\.75rem/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-height: 16rem/);
  assert.match(css, /\.users-create-store-list\s*\{[^}]*flex:\s*1/);
  assert.match(css, /overflow-y: auto/);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
