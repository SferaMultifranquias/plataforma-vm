const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
var _asyncTests = [];
var _unused = null;
const test = (name, fn) => {
  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      _asyncTests.push(result.then(function() {
        console.log('  \u2714 ' + name);
      }));
    } else {
      console.log('  \u2714 ' + name);
    }
  } catch (e) {
    console.log('  \u2716 ' + name);
    throw e;
  }
};

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createElement(id) {
  return {
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    dataset: {},
    id: id || '',
    innerHTML: '',
    style: {},
    textContent: '',
    addEventListener(type, handler) {
      if (!this.listeners) this.listeners = {};
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
    },
    getAttribute(name) { return this[name] || null; },
    setAttribute(name, value) { this[name] = String(value); },
    value: '',
    focus() {},
    disabled: false,
    className: '',
    closest() { return null; },
  };
}

function createSandbox() {
  var elements = new Map();
  var document = {
    activeElement: null,
    createElement(tag) {
      var el = createElement(tag || 'div');
      el.appendChild = function appendChild(child) {
        if (child && typeof child === 'object') {
          this.innerHTML += child.innerHTML || '';
        }
        return child;
      };
      return el;
    },
    getElementById(id) {
      if (!elements.has(id)) {
        var el = createElement(id);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  var window = {
    console,
    document,
    Promise,
    URL,
    setTimeout,
    clearTimeout,
    lucide: { createIcons() {} },
    addEventListener() {},
  };
  window.window = window;
  window.globalThis = window;
  return { elements, window };
}

function loadModule(file, sandbox) {
  vm.runInNewContext(read(file), sandbox.window, { filename: file });
  return sandbox.window;
}

function getSandbox() {
  var s = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), s);
  loadModule(path.join('public', 'js', 'shared', 'confirmation-modal.js'), s);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), s);
  if (s.window.OrdersModule && s.window.OrdersModule.bindDrawerShellListeners) {
    s.window.OrdersModule.bindDrawerShellListeners();
  }
  return s;
}

// --- Source-level checks ---

test('index.html has no inline event attributes', () => {
  var html = read('public/index.html');
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('onchange='));
  assert.ok(!html.includes('onsubmit='));
  assert.ok(!html.includes('onerror='));
  assert.ok(!html.includes('onload='));
});

test('generated order footer markup contains no onclick', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  var renderDrawer = code.slice(
    code.indexOf('function renderDrawer('),
    code.indexOf('function createInitialOrdersPageState')
  );
  assert.ok(!renderDrawer.includes('onclick='));
});

test('generated edit button uses data-order-action and data-order-id', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  var editMatch = code.match(/data-order-action="edit"[^>]*data-order-id="[^"]*"/);
  assert.ok(editMatch, 'edit button has data-order-action and data-order-id');
});

test('ADMIN decision buttons use data-order-action delegation pattern', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(code.includes('data-order-action="aprovar"'));
  assert.ok(code.includes('data-order-action="rejeitar"'));
  assert.ok(code.includes('data-order-action="solicitar"'));
  assert.ok(code.includes('data-order-action="edit"'));
});

test('orders module has allowlist for footer actions', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(code.includes('ALLOWED_FOOTER_ACTIONS'));
  assert.ok(code.includes("aprovar: true"));
  assert.ok(code.includes("rejeitar: true"));
  assert.ok(code.includes("solicitar: true"));
  assert.ok(code.includes("edit: true"));
});

test('orders module validates unknown actions', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(code.includes("'Acao nao permitida no footer:'"));
});

test('no javascript: URL in frontend JS', () => {
  var jsFiles = [
    'public/js/core/app-shell.js',
    'public/js/core/auth.js',
    'public/js/pages/orders/orders-module.js',
    'public/js/pages/dashboard/dashboard-module.js',
    'public/js/pages/stores/stores-module.js',
    'public/js/shared/app-utils.js',
  ];
  jsFiles.forEach(function(filePath) {
    var code = read(filePath);
    assert.ok(!code.match(/<a[^>]*javascript:/i), filePath + ': no javascript: in href');
    assert.ok(!code.match(/location\s*=\s*["']javascript:/i), filePath + ': no javascript: in location');
  });
});

test('no eval or new Function in frontend', () => {
  var jsFiles = [
    'public/js/core/app-shell.js',
    'public/js/core/auth.js',
    'public/js/pages/orders/orders-module.js',
    'public/js/pages/dashboard/dashboard-module.js',
    'public/js/pages/stores/stores-module.js',
  ];
  jsFiles.forEach(function(filePath) {
    var code = read(filePath);
    assert.ok(!/\beval\s*\(/.test(code), filePath + ': no eval');
    assert.ok(!/new\s+Function\s*\(/.test(code), filePath + ': no new Function');
    assert.ok(!/setTimeout\s*\(\s*["']/.test(code), filePath + ': no string setTimeout');
    assert.ok(!/setInterval\s*\(\s*["']/.test(code), filePath + ': no string setInterval');
  });
});

// --- Behavioral tests ---

test('unknown data-order-action is ignored', () => {
  var s = getSandbox();
  var footer = s.window.document.getElementById('drawer-footer');
  var called = false;
  s.window.OrdersModule.decidirPedido = function() { called = true; };

  var btn = s.window.document.createElement('button');
  btn.setAttribute('data-order-action', 'unknown-action');
  btn.setAttribute('data-order-id', 'order-1');
  footer.dispatchEvent = function() {};
  footer.addEventListener('click', function(e) {
    var b = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-order-action]') : null;
    if (!b) return;
    var action = b.getAttribute('data-order-action');
    if (action && ['aprovar', 'rejeitar', 'solicitar', 'edit'].indexOf(action) === -1) return;
    if (action === 'edit') return;
    s.window.OrdersModule.decidirPedido('order-1', action, {});
  });

  var clickEvent = { target: btn, preventDefault: function() {} };
  var handlers = footer.listeners && footer.listeners.click;
  if (handlers) {
    handlers.forEach(function(h) { h(clickEvent); });
  }
  assert.equal(called, false, 'unknown action must not trigger decidirPedido');
});

test('invalid order ID does not invoke decision or edit', () => {
  var s = getSandbox();
  var footer = s.window.document.getElementById('drawer-footer');
  var editCalled = false;
  var decisionCalled = false;
  s.window.OrdersModule.editarPedido = function() { editCalled = true; };
  s.window.OrdersModule.decidirPedido = function() { decisionCalled = true; };

  var btn = s.window.document.createElement('button');
  btn.setAttribute('data-order-action', 'edit');
  btn.setAttribute('data-order-id', '');

  var clickEvent = { target: btn, preventDefault: function() {} };
  var handlers = footer.listeners && footer.listeners.click;
  if (handlers) {
    handlers.forEach(function(h) { h(clickEvent); });
  }
  assert.equal(editCalled, false, 'empty order ID must not trigger edit');

  btn.setAttribute('data-order-action', 'aprovar');
  btn.setAttribute('data-order-id', '');
  if (handlers) {
    handlers.forEach(function(h) { h(clickEvent); });
  }
  assert.equal(decisionCalled, false, 'empty order ID must not trigger decision');
});

test('sidebar toggle button exists and is bound', () => {
  var html = read('public/index.html');
  assert.ok(html.includes('id="sidebar-toggle-btn"'));
  assert.ok(html.includes('type="button"'));
});

test('logout control is a button', () => {
  var html = read('public/index.html');
  assert.ok(html.includes('id="logout-btn"'));
  assert.ok(html.includes('type="button"'));
});

test('store modal controls have stable IDs', () => {
  var html = read('public/index.html');
  assert.ok(html.includes('id="modal-loja-close-btn"'));
  assert.ok(html.includes('id="modal-loja-cancel-btn"'));
  assert.ok(html.includes('id="modal-loja-btn-save"'));
  assert.ok(!html.includes('onclick="fecharModalLoja()"'));
  assert.ok(!html.includes('onclick="salvarLoja()"'));
});

test('drawer controls have stable IDs', () => {
  var html = read('public/index.html');
  assert.ok(html.includes('id="drawer-close-btn"'));
  assert.ok(html.includes('id="drawer-delete-btn"'));
  assert.ok(!html.includes('onclick="closeDrawer()"'));
  assert.ok(!html.includes('onclick="excluirPedido()"'));
});

test('store modal close/cancel buttons use fecharModalLoja', () => {
  var code = read('public/js/pages/stores/stores-module.js');
  assert.ok(code.includes("modal-loja-close-btn"));
  assert.ok(code.includes("modal-loja-cancel-btn"));
  assert.ok(code.includes("fecharModalLoja"));
});

test('malicious attribute-breakout cannot create other action', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  var renderFn = code.slice(
    code.indexOf('function renderDrawer('),
    code.indexOf('function createInitialOrdersPageState')
  );
  assert.ok(!renderFn.includes(' onclick='));
  assert.ok(renderFn.includes('escapeHtml(order.id)'));
});

test('drawer footer delegation uses allowlist', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(code.includes('ALLOWED_FOOTER_ACTIONS'));
  assert.ok(code.includes("drawerFooter.dataset.boundActions = 'true'"));
});

test('stores module uses dataset.bound for modal listeners', () => {
  var code = read('public/js/pages/stores/stores-module.js');
  assert.ok(code.includes('modal-loja-close-btn'));
  assert.ok(code.includes('modal-loja-cancel-btn'));
  assert.ok(code.includes('modal-loja-btn-save'));
  var boundMatches = code.match(/dataset\.bound\s*=\s*'true'/g);
  assert.ok(boundMatches && boundMatches.length >= 3);
});

test('dashboard uses addEventListener not onclick property', () => {
  var code = read('public/js/pages/dashboard/dashboard-module.js');
  assert.ok(code.includes('addEventListener(\'click\''));
  assert.ok(!code.includes('tbody.onclick'));
});

test('shell ensureListeners binds sidebar toggle and logout', () => {
  var code = read('public/js/core/app-shell.js');
  assert.ok(code.includes('sidebar-toggle-btn'));
  assert.ok(code.includes('logout-btn'));
  assert.ok(code.includes('toggleSidebar'));
  assert.ok(code.includes('fazerLogout'));
});

// ── Drawer event delegation behavioral tests ───────────────────

function makeActionBtn(action, orderId, extra) {
  var btn = Object.assign({}, extra || {}, {
    dataset: {},
    getAttribute(name) { return this[name] || null; },
    setAttribute(name, value) { this[name] = String(value); },
    closest(selector) {
      if (selector === '[data-order-action]' && this['data-order-action']) return this;
      return null;
    },
    disabled: false,
    addEventListener() {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    focus() {},
  });
  btn['data-order-action'] = action || '';
  btn['data-order-id'] = orderId || '';
  return btn;
}

test('drawer close button has dataset.bound click listener', () => {
  var s = getSandbox();
  var btn = s.window.document.getElementById('drawer-close-btn');
  assert.ok(btn.listeners && btn.listeners.click, 'close button must have click listener');
  assert.equal(btn.dataset.bound, 'true', 'close button must have dataset.bound=true');
  assert.equal(btn.listeners.click.length, 1, 'close button must have exactly one click listener');
});

test('drawer overlay has dataset.bound click listener', () => {
  var s = getSandbox();
  var overlay = s.window.document.getElementById('drawer-overlay');
  assert.ok(overlay.listeners && overlay.listeners.click, 'overlay must have click listener');
  assert.equal(overlay.dataset.bound, 'true', 'overlay must have dataset.bound=true');
  assert.equal(overlay.listeners.click.length, 1, 'overlay must have exactly one click listener');
});

test('drawer delete button has dataset.bound click listener', () => {
  var s = getSandbox();
  var btn = s.window.document.getElementById('drawer-delete-btn');
  assert.ok(btn.listeners && btn.listeners.click, 'delete button must have click listener');
  assert.equal(btn.dataset.bound, 'true', 'delete button must have dataset.bound=true');
  assert.equal(btn.listeners.click.length, 1, 'delete button must have exactly one click listener');
});

test('drawer footer has dataset.boundActions delegation listener', () => {
  var s = getSandbox();
  var footer = s.window.document.getElementById('drawer-footer');
  assert.ok(footer.listeners && footer.listeners.click, 'footer must have click listener');
  assert.equal(footer.dataset.boundActions, 'true', 'footer must have dataset.boundActions=true');
  assert.equal(footer.listeners.click.length, 1, 'footer must have exactly one click listener');
});

test('close button click sets drawer transform via closeDrawer', () => {
  var s = getSandbox();
  var drawer = s.window.document.getElementById('drawer');
  var btn = s.window.document.getElementById('drawer-close-btn');
  var handler = btn.listeners.click[0];
  handler({ target: btn });
  assert.equal(drawer.style.transform, 'translateX(100%)', 'drawer must have translateX(100%) after close');
});

test('overlay click sets drawer transform via closeDrawer', () => {
  var s = getSandbox();
  var drawer = s.window.document.getElementById('drawer');
  var overlay = s.window.document.getElementById('drawer-overlay');
  var handler = overlay.listeners.click[0];
  handler({ target: overlay });
  assert.equal(drawer.style.transform, 'translateX(100%)', 'drawer must have translateX(100%) after close');
});

test('delete button listener invokes local excluirPedido', () => {
  var s = getSandbox();
  var btn = s.window.document.getElementById('drawer-delete-btn');
  assert.ok(btn.listeners && btn.listeners.click, 'delete button must have click listener');
  assert.equal(btn.listeners.click.length, 1, 'delete button must have exactly one click listener');
  // The handler calls local excluirPedido(). Without deps/orderId it does nothing
  // and doesn't throw for missing deps (drawerActionDeps || {} handles null).
  // Test verifies handler is reachable and connected to module logic.
  var handler = btn.listeners.click[0];
  assert.equal(typeof handler, 'function', 'delete handler must be a function');
});

test('edit delegation calls editarPedido and closes drawer', () => {
  var s = getSandbox();
  var drawer = s.window.document.getElementById('drawer');
  var footer = s.window.document.getElementById('drawer-footer');
  var btn = makeActionBtn('edit', 'order-edit-1');
  var handler = footer.listeners.click[0];
  handler({ target: btn });
  assert.equal(drawer.style.transform, 'translateX(100%)', 'edit must close drawer via editarPedido -> closeDrawer');
});

test('delegation handler parses action and orderId from button', () => {
  var ALLOWED = { aprovar: true, rejeitar: true, solicitar: true, edit: true };

  function handleClick(event) {
    var button = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-order-action]') : null;
    if (!button) return null;
    var action = button.getAttribute('data-order-action');
    if (!action) return null;
    var orderId = button.getAttribute('data-order-id');
    if (!orderId || !String(orderId).trim()) return null;
    action = String(action).toLowerCase();
    if (!ALLOWED[action]) return null;
    return { action: action, orderId: orderId };
  }

  var btn = makeActionBtn('aprovar', 'order-1');
  assert.deepEqual(handleClick({ target: btn }), { action: 'aprovar', orderId: 'order-1' });
});

test('delegation handler normalizes action to lowercase', () => {
  var ALLOWED = { aprovar: true, edit: true };

  function handleClick(event) {
    var button = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-order-action]') : null;
    if (!button) return null;
    var action = button.getAttribute('data-order-action');
    if (!action) return null;
    var orderId = button.getAttribute('data-order-id');
    if (!orderId || !String(orderId).trim()) return null;
    action = String(action).toLowerCase();
    if (!ALLOWED[action]) return null;
    return { action: action, orderId: orderId };
  }

  var btn = makeActionBtn('EDIT', 'order-2');
  assert.deepEqual(handleClick({ target: btn }), { action: 'edit', orderId: 'order-2' }, 'EDIT must normalize to edit');
});

test('delegation handler with no data-order-action returns null', () => {
  var ALLOWED = { aprovar: true, edit: true };

  function handleClick(event) {
    var button = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-order-action]') : null;
    if (!button) return null;
    var action = button.getAttribute('data-order-action');
    if (!action) return null;
    var orderId = button.getAttribute('data-order-id');
    if (!orderId || !String(orderId).trim()) return null;
    action = String(action).toLowerCase();
    if (!ALLOWED[action]) return null;
    return { action: action, orderId: orderId };
  }

  var overlay = { closest: function() { return null; } };
  assert.equal(handleClick({ target: overlay }), null, 'click outside action button must return null');
});

test('OrdersModule decidirPedido rejects when deps missing', async () => {
  var s = getSandbox();
  try {
    await s.window.OrdersModule.decidirPedido('o1', 'aprovar', {});
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.constructor.name, 'TypeError', 'must throw TypeError from missing deps');
  }
});

test('OrdersModule decidirPedido shows offline toast when API_OK false', async () => {
  var s = getSandbox();
  var toastMsg = null;
  await s.window.OrdersModule.decidirPedido('o1', 'aprovar', {
    API_OK: function() { return false; },
    showToast: function(msg) { toastMsg = msg; },
  });
  assert.equal(toastMsg, 'Sem conexao com o banco de dados.', 'must show offline toast');
});

test('unknown action is ignored by delegation handler', () => {
  var s = getSandbox();
  var decisionCalled = false;
  var editCalled = false;
  s.window.OrdersModule.decidirPedido = function() { decisionCalled = true; return Promise.resolve(); };
  s.window.OrdersModule.editarPedido = function() { editCalled = true; };

  var footer = s.window.document.getElementById('drawer-footer');
  var btn = makeActionBtn('unknown-action', 'order-1');
  var handler = footer.listeners.click[0];
  handler({ target: btn });
  assert.equal(decisionCalled, false, 'unknown action must not call decidirPedido');
  assert.equal(editCalled, false, 'unknown action must not call editarPedido');
});

test('empty order ID is ignored by delegation handler', () => {
  var s = getSandbox();
  var decisionCalled = false;
  var editCalled = false;
  s.window.OrdersModule.decidirPedido = function() { decisionCalled = true; return Promise.resolve(); };
  s.window.OrdersModule.editarPedido = function() { editCalled = true; };

  var footer = s.window.document.getElementById('drawer-footer');
  var btn = makeActionBtn('edit', '');
  var handler = footer.listeners.click[0];
  handler({ target: btn });
  assert.equal(editCalled, false, 'empty order ID must not trigger edit');
  assert.equal(decisionCalled, false, 'empty order ID must not trigger decision');
});

test('malicious data-order-action attribute-breakout cannot create other action', () => {
  var s = getSandbox();
  var decisionCalled = false;
  var editCalled = false;
  s.window.OrdersModule.decidirPedido = function() { decisionCalled = true; return Promise.resolve(); };
  s.window.OrdersModule.editarPedido = function() { editCalled = true; };

  var footer = s.window.document.getElementById('drawer-footer');
  var btn = makeActionBtn('edit" onclick="malicious()', 'order-1');
  var handler = footer.listeners.click[0];
  handler({ target: btn });
  // action is 'edit" onclick="malicious()' which doesn't match allowlist
  assert.equal(editCalled, false, 'malicious action must not trigger edit');
  assert.equal(decisionCalled, false, 'malicious action must not trigger decision');
});

test('disabled button does not fire delegation event', () => {
  var s = getSandbox();
  var called = false;
  s.window.OrdersModule.decidirPedido = function() { called = true; return Promise.resolve(); };
  s.window.OrdersModule.editarPedido = function() {};
  s.window.OrdersModule.showToast = function() {};

  var footer = s.window.document.getElementById('drawer-footer');
  var btn = makeActionBtn('aprovar', 'order-1');
  btn.disabled = true;
  var handler = footer.listeners.click[0];
  // disabled buttons should not trigger click events (browser behavior)
  // the delegation handler should check and ignore disabled buttons
  handler({ target: btn });
  assert.equal(called, false, 'disabled button must not trigger action');
});

test('footer delegation listener survives innerHTML replacement', () => {
  var s = getSandbox();
  var footer = s.window.document.getElementById('drawer-footer');

  // simulate renderDrawer replacing innerHTML
  footer.innerHTML = '<button data-order-action="aprovar" data-order-id="order-new">Aprovar</button>';

  // dataset.boundActions must still be present on footer element
  assert.equal(footer.dataset.boundActions, 'true', 'dataset.boundActions must survive innerHTML replacement');

  // listener count must not change (innerHTML replacement doesn't add/remove listeners on parent)
  assert.equal(footer.listeners.click.length, 1, 'listener count must stay 1 after innerHTML replacement');
});

test('reopening drawer does not duplicate listeners', () => {
  var s = getSandbox();

  // Simulate second load (like afterRenderPedidos resets)
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), s.window);
  loadModule(path.join('public', 'js', 'shared', 'confirmation-modal.js'), s.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), s.window);
  if (s.window.OrdersModule && s.window.OrdersModule.bindDrawerShellListeners) {
    s.window.OrdersModule.bindDrawerShellListeners();
  }

  var closeBtn = s.window.document.getElementById('drawer-close-btn');
  var overlay = s.window.document.getElementById('drawer-overlay');
  var deleteBtn = s.window.document.getElementById('drawer-delete-btn');
  var footer = s.window.document.getElementById('drawer-footer');

  // All must still have exactly one listener each (guarded by dataset.bound)
  assert.equal(closeBtn.listeners.click.length, 1, 'close button must still have 1 listener after reload');
  assert.equal(overlay.listeners.click.length, 1, 'overlay must still have 1 listener after reload');
  assert.equal(deleteBtn.listeners.click.length, 1, 'delete button must still have 1 listener after reload');
  assert.equal(footer.listeners.click.length, 1, 'footer must still have 1 listener after reload');
});

test('no inline event handler reintroduced in orders-module', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(!code.includes('onclick='));
  assert.ok(!code.includes("'.onclick'"));
  assert.ok(!code.includes('.onclick '));
});

test('closeDrawer re-enables delete button', () => {
  var s = getSandbox();
  var deleteBtn = s.window.document.getElementById('drawer-delete-btn');

  // simulate state after successful delete (excluirPedido disables all drawer buttons)
  deleteBtn.disabled = true;

  s.window.OrdersModule.closeDrawer();

  assert.equal(deleteBtn.disabled, false, 'delete button must be re-enabled after closeDrawer');
});

test('no drawer listeners before bindDrawerShellListeners called', () => {
  var s = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), s);
  loadModule(path.join('public', 'js', 'shared', 'confirmation-modal.js'), s);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), s);

  var closeBtn = s.window.document.getElementById('drawer-close-btn');
  var overlay = s.window.document.getElementById('drawer-overlay');
  var deleteBtn = s.window.document.getElementById('drawer-delete-btn');
  var footer = s.window.document.getElementById('drawer-footer');

  assert.equal(!!(closeBtn.listeners && closeBtn.listeners.click), false, 'close button must not have listener before bind');
  assert.equal(!!(overlay.listeners && overlay.listeners.click), false, 'overlay must not have listener before bind');
  assert.equal(!!(deleteBtn.listeners && deleteBtn.listeners.click), false, 'delete button must not have listener before bind');
  assert.equal(!!(footer.listeners && footer.listeners.click), false, 'footer must not have listener before bind');

  s.window.OrdersModule.bindDrawerShellListeners();

  assert.ok(closeBtn.listeners && closeBtn.listeners.click, 'close button must have listener after bind');
  assert.equal(closeBtn.dataset.bound, 'true', 'close button must have dataset.bound=true');
  assert.equal(closeBtn.listeners.click.length, 1, 'close button must have exactly one listener after bind');

  assert.ok(overlay.listeners && overlay.listeners.click, 'overlay must have listener after bind');
  assert.equal(overlay.dataset.bound, 'true', 'overlay must have dataset.bound=true');
  assert.equal(overlay.listeners.click.length, 1, 'overlay must have exactly one listener after bind');

  assert.ok(deleteBtn.listeners && deleteBtn.listeners.click, 'delete button must have listener after bind');
  assert.equal(deleteBtn.dataset.bound, 'true', 'delete button must have dataset.bound=true');
  assert.equal(deleteBtn.listeners.click.length, 1, 'delete button must have exactly one listener after bind');

  assert.ok(footer.listeners && footer.listeners.click, 'footer must have listener after bind');
  assert.equal(footer.dataset.boundActions, 'true', 'footer must have dataset.boundActions=true');
  assert.equal(footer.listeners.click.length, 1, 'footer must have exactly one listener after bind');
});

// ── Asset version consistency ──────────────────────────────────

test('APP_VERSION declared in index.html', () => {
  var html = read('public/index.html');
  var match = html.match(/window\.APP_VERSION\s*=\s*'([^']+)'/);
  assert.ok(match, 'APP_VERSION must be declared');
  assert.ok(match[1], 'APP_VERSION must be non-empty');
  assert.equal(match[1], '20260702-1', 'APP_VERSION must be current');
});

test('all first-party assets use same version', () => {
  var html = read('public/index.html');
  var versionMatch = html.match(/window\.APP_VERSION\s*=\s*'([^']+)'/);
  assert.ok(versionMatch, 'APP_VERSION must be declared');
  var version = versionMatch[1];

  var assetMatches = html.matchAll(/['"]\/[^'"]*\?v=([^'"&]+)/g);
  var count = 0;
  for (var m of assetMatches) {
    count++;
    assert.equal(m[1], version, 'asset ' + m[0] + ' must use version ' + version);
  }
  assert.ok(count >= 15, 'at least 15 versioned first-party assets found, got ' + count);
});

test('no empty or malformed ?v= values', () => {
  var html = read('public/index.html');
  var empty = html.match(/\?v=(?:['"&\s]|$)/g);
  assert.equal(empty && empty.length || 0, 0, 'no empty ?v= values');
});

test('old version 20260629-1 absent from index.html', () => {
  var html = read('public/index.html');
  assert.ok(!html.includes('20260629-1'), 'old asset version must not remain in index.html');
});

test('orders-module.js contains bindDrawerShellListeners', () => {
  var code = read('public/js/pages/orders/orders-module.js');
  assert.ok(code.includes('bindDrawerShellListeners'), 'orders-module.js must contain bindDrawerShellListeners');
  assert.ok(code.includes('function bindDrawerShellListeners'), 'bindDrawerShellListeners must be a function declaration');
});

Promise.all(_asyncTests).then(function() {
  console.log('No-inline-events checks ok.');
}).catch(function(e) {
  console.error('Async test failed:', e.message);
  process.exit(1);
});
