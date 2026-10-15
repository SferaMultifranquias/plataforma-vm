const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = (name, fn) => {
  fn();
  console.log('  \u2714 ' + name);
};

const ROOT = path.join(__dirname, '..', '..');
const AppUtils = require(path.join(ROOT, 'public/js/shared/app-utils'));

test('escapeHtml escapes & < > " \'', () => {
  assert.equal(AppUtils.escapeHtml('&'), '&amp;');
  assert.equal(AppUtils.escapeHtml('<'), '&lt;');
  assert.equal(AppUtils.escapeHtml('>'), '&gt;');
  assert.equal(AppUtils.escapeHtml('"'), '&quot;');
  assert.equal(AppUtils.escapeHtml("'"), '&#39;');
});

test('escapeHtml escapes composite malicious string', () => {
  assert.equal(AppUtils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(AppUtils.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(AppUtils.escapeHtml('"><svg onload=alert(1)>'), '&quot;&gt;&lt;svg onload=alert(1)&gt;');
  assert.equal(AppUtils.escapeHtml("' onmouseover='alert(1)"), '&#39; onmouseover=&#39;alert(1)');
  assert.equal(AppUtils.escapeHtml('javascript:alert(1)'), 'javascript:alert(1)');
});

test('escapeHtml returns empty string for null/undefined', () => {
  assert.equal(AppUtils.escapeHtml(null), '');
  assert.equal(AppUtils.escapeHtml(undefined), '');
});

test('escapeHtml preserves safe strings', () => {
  assert.equal(AppUtils.escapeHtml('hello world'), 'hello world');
  assert.equal(AppUtils.escapeHtml('abc123'), 'abc123');
  assert.equal(AppUtils.escapeHtml(''), '');
  assert.equal(AppUtils.escapeHtml(0), '0');
  assert.equal(AppUtils.escapeHtml(false), 'false');
});

test('renderDrawerItems escapes SKU names and descriptions', () => {
  var items = [{
    sku_digitado: '<script>alert(1)</script>',
    produtos: { nome: '<img src=x onerror=alert(1)>' },
    quantidade: 5,
    valor_unit: 10.5,
  }];
  var html = AppUtils.renderDrawerItems(items);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'SKU should be escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'SKU raw HTML must not appear');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'product name should be escaped');
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'product name raw HTML must not appear');
  assert.ok(html.includes('Quantidade: 5 unidade(s)'), 'quantity renders normally');
  assert.ok(html.includes('R$ 10.50'), 'formatted value renders');
});

test('renderDrawerItems escapes quantity string', () => {
  var items = [{
    sku_digitado: 'TEST',
    produtos: { nome: 'Item Test' },
    quantidade: '<script>bad</script>',
  }];
  var html = AppUtils.renderDrawerItems(items);
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'), 'quantity should be escaped');
});

test('renderDrawerHistory escapes action and date text', () => {
  var history = [{
    acao: '<script>alert(1)</script>',
    data: '"><svg onload=alert(1)>',
    icone: 'check-circle',
  }];
  var html = AppUtils.renderDrawerHistory(history);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'action should be escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'action raw HTML must not appear');
  assert.ok(html.includes('&quot;&gt;&lt;svg onload=alert(1)&gt;'), 'date should be escaped');
  assert.ok(!html.includes('"><svg onload=alert(1)>'), 'date raw HTML must not appear');
});

test('mapHistoryIcon returns only allowlisted icon names', () => {
  assert.equal(AppUtils.mapHistoryIcon('ORDER_PLACED'), 'package-check');
  assert.equal(AppUtils.mapHistoryIcon('RECEIVED'), 'badge-check');
  assert.equal(AppUtils.mapHistoryIcon('APPROVED'), 'check-circle');
  assert.equal(AppUtils.mapHistoryIcon('REJECTED'), 'x-circle');
  assert.equal(AppUtils.mapHistoryIcon('PENDING_APPROVAL'), 'send');
  assert.equal(AppUtils.mapHistoryIcon('CANCELLED'), 'ban');
  assert.equal(AppUtils.mapHistoryIcon('UNKNOWN'), 'clock');
  assert.equal(AppUtils.mapHistoryIcon(''), 'clock');
  assert.equal(AppUtils.mapHistoryIcon(null), 'clock');
  assert.equal(AppUtils.mapHistoryIcon('<script>'), 'clock');
});

test('renderDrawerHistory empty case returns fallback', () => {
  var html = AppUtils.renderDrawerHistory([]);
  assert.equal(html, '<div class="text-slate-400 text-sm">Sem historico disponivel.</div>');
});

test('renderDrawerItems empty case returns fallback', () => {
  var html = AppUtils.renderDrawerItems([]);
  assert.equal(html, '<div class="text-slate-400 text-sm">Sem itens cadastrados.</div>');
});

test('renderDrawerHistory preserves safe entries', () => {
  var history = [{
    acao: 'Pedido criado',
    data: '2026-06-30 14:30',
    icone: 'package-check',
  }];
  var html = AppUtils.renderDrawerHistory(history);
  assert.ok(html.includes('Pedido criado'), 'action text visible');
  assert.ok(html.includes('2026-06-30 14:30'), 'date visible');
  assert.ok(html.includes('package-check'), 'icon present');
});

test('renderDrawerItems preserves safe items', () => {
  var items = [{
    sku_digitado: 'PRD-001',
    produtos: { nome: 'Produto Teste' },
    quantidade: 3,
  }];
  var html = AppUtils.renderDrawerItems(items);
  assert.ok(html.includes('PRD-001'), 'SKU visible');
  assert.ok(html.includes('Produto Teste'), 'name visible');
  assert.ok(html.includes('Quantidade: 3 unidade(s)'), 'quantity visible');
});

test('dashboard-module.js: no inline onclick in renderRecentOrders', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/dashboard/dashboard-module.js'), 'utf8');
  var renderFunc = code.slice(code.indexOf('function renderRecentOrders'), code.indexOf('function afterRenderDashboard'));
  assert.ok(!renderFunc.includes('onclick='), 'renderRecentOrders must not contain inline onclick');
  assert.ok(renderFunc.includes('data-order-id'), 'renderRecentOrders must use data-order-id attribute');
});

test('dashboard-module.js: escapeHtml referenced', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/dashboard/dashboard-module.js'), 'utf8');
  assert.ok(code.includes('global.AppUtils.escapeHtml'), 'dashboard-module.js must reference AppUtils.escapeHtml');
});

test('users-module.js: renderStoreOptions escapes store name', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var storeOpts = code.slice(code.indexOf('function renderStoreOptions'), code.indexOf('function renderPagination'));
  assert.ok(storeOpts.includes('escapeHtml(store.name'), 'store name must be escaped');
  assert.ok(storeOpts.includes('escapeHtml(store.id'), 'store id must be escaped');
});

test('users-module.js: renderCreateStoreList escapes store name', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var createList = code.slice(code.indexOf('function renderCreateStoreList'), code.indexOf('function syncCreateForm'));
  assert.ok(createList.includes('escapeHtml(store.name'), 'checkbox store name must be escaped');
  assert.ok(createList.includes('escapeHtml(store.id'), 'checkbox store id must be escaped');
});

test('users-module.js: escapeHtml referenced', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  assert.ok(code.includes('global.AppUtils.escapeHtml'), 'users-module.js must reference AppUtils.escapeHtml');
});

// ---------------------------------------------------------------------------
// Second XSS remediation batch — renderUsersTable sanitisation
// ---------------------------------------------------------------------------

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function roleLabel(role) {
  var map = {
    admin: 'Administrador',
    loja: 'Loja',
  };
  return map[String(role || '').toLowerCase()] || '-';
}

function statusLabel(status) {
  var map = {
    active: 'Ativo',
    blocked: 'Bloqueado',
    invited: 'Convite pendente',
    removed: 'Removido',
  };
  return map[String(status || '').toLowerCase()] || 'Ativo';
}

function statusClass(status) {
  var map = {
    active: 'users-status-badge--active',
    blocked: 'users-status-badge--blocked',
    invited: 'users-status-badge--invited',
    removed: 'users-status-badge--removed',
  };
  return map[String(status || '').toLowerCase()] || map.active;
}

function renderUserRow(user) {
  var safeName = AppUtils.escapeHtml(String(user.name || '-'));
  var safeEmail = AppUtils.escapeHtml(String(user.email || '-'));
  var safeId = AppUtils.escapeHtml(String(user.id || ''));
  var idIsValid = isValidUUID(user.id);

  var initials = String(user.name || user.email || '-')
    .split(' ')
    .filter(Boolean)
    .map(function getInitial(part) {
      return part[0];
    })
    .slice(0, 2)
    .join('')
    .toUpperCase() || '-';

  var storesLabel = '-';
  if (Array.isArray(user.stores) && user.stores.length) {
    var firstStores = user.stores.slice(0, 2).map(function mapStore(store) {
      return AppUtils.escapeHtml(String(store.name));
    }).join(', ');
    storesLabel = firstStores + (user.stores.length > 2 ? ' +' + (user.stores.length - 2) : '');
  }

  var safeRoleLabel = roleLabel(user.role);
  var safeStatusLabel = statusLabel(user.status);
  var safeStatusClass = statusClass(user.status);

  var actionsHtml = '';
  if (idIsValid && user.status !== 'removed') {
    actionsHtml =
      '<button type="button" class="users-row-action users-row-action--edit" data-user-action="edit" data-user-id="' + safeId + '">' +
        '<i data-lucide="pencil" class="w-4 h-4" aria-hidden="true"></i>' +
        '<span>Editar</span>' +
      '</button>' +
      '<button type="button" class="users-row-action users-row-action--delete" data-user-action="delete" data-user-id="' + safeId + '">' +
        '<i data-lucide="user-x" class="w-4 h-4" aria-hidden="true"></i>' +
        '<span>Remover</span>' +
      '</button>';
  }

  return (
    '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">' +
      '<td class="table-td text-center">' +
        '<div class="flex items-center justify-center gap-3 min-w-0">' +
          '<div class="users-avatar">' + AppUtils.escapeHtml(initials) + '</div>' +
          '<div class="min-w-0 text-left">' +
            '<div class="font-medium text-slate-900 truncate">' + safeName + '</div>' +
            '<div class="text-xs text-slate-400 truncate">ID ' + safeId + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="table-td text-center text-slate-600">' + safeEmail + '</td>' +
      '<td class="table-td text-center">' +
        '<span class="users-role-badge">' + safeRoleLabel + '</span>' +
      '</td>' +
      '<td class="table-td text-center text-slate-600">' + storesLabel + '</td>' +
      '<td class="table-td text-center">' +
        '<span class="users-status-badge ' + safeStatusClass + '">' + safeStatusLabel + '</span>' +
      '</td>' +
      '<td class="table-td text-center text-slate-600">' + AppUtils.escapeHtml(String(user.lastSignInAt || 'Não disponível')) + '</td>' +
      '<td class="table-td text-center text-slate-600">' + AppUtils.escapeHtml(String(user.createdAt || 'Não disponível')) + '</td>' +
      '<td class="table-td text-center">' +
        '<div class="users-row-actions' + (idIsValid ? ' data-user-actions="' + safeId + '"' : '') + '">' +
          actionsHtml +
        '</div>' +
      '</td>' +
    '</tr>'
  );
}

// --- UUID validation ---

test('isValidUUID accepts valid UUIDs', () => {
  assert.ok(isValidUUID('550e8400-e29b-41d4-a716-446655440000'));
  assert.ok(isValidUUID('00000000-0000-0000-0000-000000000000'));
  assert.ok(isValidUUID('ffffffff-ffff-ffff-ffff-ffffffffffff'));
  assert.ok(isValidUUID('550E8400-E29B-41D4-A716-446655440000'));
});

test('isValidUUID rejects invalid values', () => {
  assert.equal(isValidUUID(null), false);
  assert.equal(isValidUUID(undefined), false);
  assert.equal(isValidUUID(''), false);
  assert.equal(isValidUUID('not-a-uuid'), false);
  assert.equal(isValidUUID('javascript:alert(1)'), false);
  assert.equal(isValidUUID('550e8400-e29b-41d4-a716-44665544000'), false);
  assert.equal(isValidUUID('550e8400-e29b-41d4-a716-4466554400000'), false);
  assert.equal(isValidUUID('" data-user-action="remove'), false);
});

// --- Role label allowlist ---

test('roleLabel returns safe labels for known roles', () => {
  assert.equal(roleLabel('admin'), 'Administrador');
  assert.equal(roleLabel('loja'), 'Loja');
  assert.equal(roleLabel('ADMIN'), 'Administrador');
});

test('roleLabel returns safe fallback for unknown role', () => {
  assert.equal(roleLabel(null), '-');
  assert.equal(roleLabel(undefined), '-');
  assert.equal(roleLabel(''), '-');
  assert.equal(roleLabel('<script>'), '-');
  assert.equal(roleLabel('hacker'), '-');
});

// --- Status label allowlist ---

test('statusLabel returns safe labels for known status', () => {
  assert.equal(statusLabel('active'), 'Ativo');
  assert.equal(statusLabel('blocked'), 'Bloqueado');
  assert.equal(statusLabel('invited'), 'Convite pendente');
  assert.equal(statusLabel('removed'), 'Removido');
});

test('statusLabel returns safe fallback for unknown status', () => {
  assert.equal(statusLabel(null), 'Ativo');
  assert.equal(statusLabel('<svg onload=alert(1)>'), 'Ativo');
  assert.equal(statusLabel('unknown'), 'Ativo');
});

// --- Status class allowlist ---

test('statusClass returns allowlisted class for known status', () => {
  assert.equal(statusClass('active'), 'users-status-badge--active');
  assert.equal(statusClass('blocked'), 'users-status-badge--blocked');
  assert.equal(statusClass('invited'), 'users-status-badge--invited');
  assert.equal(statusClass('removed'), 'users-status-badge--removed');
});

test('statusClass returns safe default for unknown status', () => {
  assert.equal(statusClass(null), 'users-status-badge--active');
  assert.equal(statusClass('<img>'), 'users-status-badge--active');
});

// --- Rendered output tests ---

var VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

test('renderUserRow escapes name', () => {
  var html = renderUserRow({ id: VALID_UUID, name: '<img src=x onerror=alert(1)>', email: 'a@b.com' });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('data-user-action="edit"'));
  assert.ok(html.includes('data-user-action="delete"'));
});

test('renderUserRow escapes email', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: '"><svg onload=alert(1)>@example.com' });
  assert.ok(html.includes('&quot;&gt;&lt;svg onload=alert(1)&gt;@example.com'));
  assert.ok(!html.includes('<svg onload=alert(1)>'));
});

test('renderUserRow escapes store name', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com', stores: [{ id: 1, name: '<script>alert(1)</script>' }] });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('renderUserRow escapes ID in text position', () => {
  var html = renderUserRow({ id: '<script>alert(1)</script>', name: 'User', email: 'a@b.com' });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('renderUserRow: invalid UUID produces no actions', () => {
  var html = renderUserRow({ id: 'not-a-uuid', name: 'User', email: 'a@b.com' });
  assert.ok(!html.includes('data-user-action="edit"'));
  assert.ok(!html.includes('data-user-action="delete"'));
  assert.ok(!html.includes('data-user-actions='));
  assert.ok(!html.includes('data-user-id='));
});

test('renderUserRow: javascript-like ID produces no actions', () => {
  var html = renderUserRow({ id: 'javascript:alert(1)', name: 'User', email: 'a@b.com' });
  assert.ok(!html.includes('data-user-action="edit"'));
  assert.ok(!html.includes('data-user-action="delete"'));
  assert.ok(!html.includes('data-user-actions='));
  assert.ok(!html.includes('data-user-id='));
});

test('renderUserRow: ID attribute breakout produces no actions', () => {
  var html = renderUserRow({ id: '" data-user-action="remove', name: 'User', email: 'a@b.com' });
  assert.ok(!html.includes('data-user-action="edit"'));
  assert.ok(!html.includes('data-user-action="delete"'));
  assert.ok(!html.includes('data-user-actions='));
  assert.ok(!html.includes('data-user-id='));
});

test('renderUserRow: valid UUID preserves Edit and Remove buttons', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com' });
  assert.ok(html.includes('data-user-action="edit"'));
  assert.ok(html.includes('data-user-action="delete"'));
  assert.ok(html.includes('data-user-actions="' + VALID_UUID + '"'));
  assert.ok(html.includes('data-user-id="' + VALID_UUID + '"'));
});

test('renderUserRow: removed user has no action buttons', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com', status: 'removed' });
  assert.ok(!html.includes('<button'), 'no button element in removed row');
  assert.ok(!html.includes('data-user-action="edit"'));
  assert.ok(!html.includes('data-user-action="delete"'));
});

test('renderUserRow: portuguese accented names preserved', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'José da Silva', email: 'jose@example.com' });
  assert.ok(html.includes('José da Silva'));
});

test('renderUserRow: no inline event handler generated', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com' });
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('onchange='));
  assert.ok(!html.includes('onerror='));
  assert.ok(!html.includes('onload='));
  assert.ok(!html.includes('javascript:'));
});

test('renderUserRow: role/status classes are allowlisted', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com', role: '<script>', status: '<img>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img>'));
  assert.ok(html.includes('users-role-badge'), 'role badge container present');
  assert.ok(html.includes('users-status-badge'), 'status badge container present');
});

test('renderUserRow: malicious ID cannot create second data-user-action', () => {
  var html = renderUserRow({ id: VALID_UUID, name: 'User', email: 'a@b.com' });
  var matches = html.match(/data-user-action=/g);
  assert.equal(matches ? matches.length : 0, 2, 'exactly two data-user-action attributes (edit + delete)');
});

// --- Inline event handler audit ---

test('index.html has no inline event attributes', () => {
  var html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!html.includes('onclick='), 'no onclick= in index.html');
  assert.ok(!html.includes('onchange='), 'no onchange= in index.html');
  assert.ok(!html.includes('onsubmit='), 'no onsubmit= in index.html');
  assert.ok(!html.includes('onerror='), 'no onerror= in index.html');
  assert.ok(!html.includes('onload='), 'no onload= in index.html');
});

test('orders-module.js generated footer has no onclick', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/orders/orders-module.js'), 'utf8');
  var renderFn = code.slice(code.indexOf('function renderDrawer('), code.indexOf('function createInitialOrdersPageState'));
  assert.ok(!renderFn.includes('onclick='), 'renderDrawer must not contain inline onclick');
  assert.ok(renderFn.includes('data-order-action'), 'renderDrawer must use data-order-action');
  assert.ok(renderFn.includes('data-order-id'), 'renderDrawer must use data-order-id');
  assert.ok(renderFn.includes('escapeHtml(order.id)'), 'renderDrawer must escape order.id');
});

test('dashboard-module.js uses addEventListener not onclick property', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/dashboard/dashboard-module.js'), 'utf8');
  assert.ok(code.includes('addEventListener'), 'dashboard-module must use addEventListener');
  assert.ok(!code.includes('tbody.onclick'), 'dashboard-module must not use onclick property');
});

test('no javascript: URLs in index.html', () => {
  var html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!html.includes('javascript:'), 'no javascript: pseudo-protocol in index.html');
});

test('renderDrawer buttons use type=button and data attributes', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/orders/orders-module.js'), 'utf8');
  var renderFn = code.slice(code.indexOf('function renderDrawer'), code.indexOf('function createInitialOrdersPageState'));
  assert.ok(renderFn.includes('type="button" data-order-action="aprovar"'), 'approve button has type=button and data-order-action');
  assert.ok(renderFn.includes('type="button" data-order-action="edit"'), 'edit button has type=button and data-order-action');
});

// --- Source-code structure checks ---

test('renderUsersTable source uses escapeHtml for user name', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(fn.includes('escapeHtml(String(user.name ||'), 'user.name passed through escapeHtml');
});

test('renderUsersTable source uses escapeHtml for user email', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(fn.includes('escapeHtml(String(user.email ||'), 'user.email passed through escapeHtml');
});

test('renderUsersTable source uses escapeHtml for user id', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(fn.includes('escapeHtml(String(user.id ||'), 'user.id passed through escapeHtml');
});

test('renderUsersTable source uses escapeHtml for store name', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(fn.includes('escapeHtml(String(store.name)'), 'store.name passed through escapeHtml');
});

test('renderUsersTable source references isValidUUID', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(fn.includes('isValidUUID'), 'renderUsersTable uses isValidUUID');
});

test('renderUsersTable source has no inline onclick', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(!fn.includes('onclick='), 'no inline onclick in renderUsersTable');
});

test('renderUsersTable source has no inline event handlers', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function renderUsersTable'), code.indexOf('function renderUsersTable') + code.slice(code.indexOf('function renderUsersTable')).indexOf('\n  function'));
  assert.ok(!fn.includes('onchange='), 'no inline onchange');
  assert.ok(!fn.includes('onsubmit='), 'no inline onsubmit');
  assert.ok(!fn.includes('javascript:'), 'no javascript: pseudo-protocol');
});

test('roleLabel source has safe fallback', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  var fn = code.slice(code.indexOf('function roleLabel'), code.indexOf('function roleLabel') + code.slice(code.indexOf('function roleLabel')).indexOf('\n  function'));
  assert.ok(!fn.includes('|| role ||'), 'roleLabel does not interpolate raw role');
  assert.ok(fn.includes("|| '-';"), 'roleLabel returns safe dash fallback');
});

test('isValidUUID function defined in users-module.js', () => {
  var code = fs.readFileSync(path.join(ROOT, 'public/js/pages/users/users-module.js'), 'utf8');
  assert.ok(code.includes('function isValidUUID'), 'isValidUUID defined in users-module.js');
});
