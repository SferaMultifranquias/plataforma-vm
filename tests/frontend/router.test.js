const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createElement() {
  const classes = new Set();

  return {
    className: '',
    classList: {
      add(...values) {
        values.forEach((value) => classes.add(value));
      },
      remove(...values) {
        values.forEach((value) => classes.delete(value));
      },
      toggle(value, force) {
        if (force === true) {
          classes.add(value);
          return true;
        }

        if (force === false) {
          classes.delete(value);
          return false;
        }

        if (classes.has(value)) {
          classes.delete(value);
          return false;
        }

        classes.add(value);
        return true;
      },
      contains(value) {
        return classes.has(value);
      },
    },
    dataset: {},
    innerHTML: '',
    style: {},
    textContent: '',
    addEventListener() {},
    appendChild() {},
    focus() {},
    querySelector() {
      return null;
    },
    remove() {},
  };
}

function createSandbox() {
  const elements = new Map();
  const document = {
    addEventListener() {},
    createElement() {
      return createElement();
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
  };

  const window = {
    AppDiagnostics: {
      logBootstrapEvent() {},
      withTimeout(label, promise, timeoutMs) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
      },
    },
    AppUtils: {
      canAccessResource() {
        return true;
      },
    },
    DashboardModule: {
      afterRenderDashboard() {
        return Promise.resolve();
      },
      renderDashboard() {
        return '<section data-page="dashboard">Dashboard</section>';
      },
    },
    FormModule: {
      afterRenderFormulario() {
        return Promise.resolve();
      },
    },
    OrdersModule: {
      afterRenderPedidos() {
        return new Promise(() => {});
      },
      openPedido() {
        return Promise.resolve();
      },
      closeDrawer() {},
      decidirPedido() {
        return Promise.resolve();
      },
    },
    UsersModule: {
      afterRenderUsuarios() {
        return Promise.resolve();
      },
      beforeLeave() {
        return Promise.resolve();
      },
    },
    StoresModule: {
      carregarTabelaLojas() {
        return Promise.resolve();
      },
      afterRenderLojasCadastro() {
        return Promise.resolve();
      },
    },
    console,
    crypto: {
      randomUUID() {
        return 'boot-test';
      },
    },
    document,
    history: {
      pushState() {},
      replaceState() {},
    },
    location: {
      href: 'http://localhost:3000/dashboard',
      pathname: '/dashboard',
      search: '',
    },
    lucide: {
      createIcons() {},
    },
    Promise,
    URL,
    addEventListener() {},
    setTimeout,
    clearTimeout,
  };

  window.window = window;
  window.globalThis = window;

  return window;
}

function loadModule(file, window) {
  const code = read(file);
  vm.runInNewContext(code, window, { filename: file });
  return window;
}

async function run() {
  const appShell = read(path.join('public', 'js', 'core', 'app-shell.js'));
  const indexHtml = read(path.join('public', 'index.html'));
  const server = read('server.js');
  const serverApp = read(path.join('src', 'server', 'app.js'));
  const pedidosHtml = read(path.join('public', 'pages', 'pedidos.html'));
  const usuariosHtml = read(path.join('public', 'pages', 'usuarios.html'));
  const loginHtml = read(path.join('public', 'pages', 'login.html'));
  const lojasHtml = read(path.join('public', 'pages', 'lojas.html'));
  const ordersCss = read(path.join('public', 'styles', 'pages', 'orders.css'));
  const usersCss = read(path.join('public', 'styles', 'pages', 'users.css'));

  assert.match(appShell, /path:\s*'\/dashboard'/);
  assert.match(appShell, /path:\s*'\/login'/);
  assert.match(appShell, /path:\s*'\/pedidos'/);
  assert.match(appShell, /path:\s*'\/usuarios'/);
  assert.match(appShell, /path:\s*'\/novo-pedido'/);
  assert.match(appShell, /path:\s*'\/lojas'/);
  assert.match(appShell, /path:\s*'\/estoque'/);
  assert.doesNotMatch(appShell, /path:\s*'\/motivos-solicitacao'/);
  assert.doesNotMatch(appShell, /path:\s*'\/tipos-produto'/);
  assert.match(appShell, /function showPage\(pageKey\)/);
  assert.match(appShell, /resolvePageKey\(pageKey\)/);
  assert.match(appShell, /navigateTo\(route\.path/);
  assert.match(appShell, /function routeHasVisibleContent\(route\)/);
  assert.match(appShell, /signature === renderedRouteSignature && routeHasVisibleContent\(route\)/);
  assert.match(appShell, /logBootstrapEvent\('router', 'start'/);
  assert.match(appShell, /logBootstrapEvent\('router', 'markup-ready'/);
  assert.match(appShell, /logBootstrapEvent\('router', 'complete'/);
  assert.match(appShell, /logBootstrapEvent\('router', 'error'/);
  assert.match(appShell, /public:\s*true/);
  assert.match(appShell, /mountId:\s*'login-screen'/);
  assert.match(indexHtml, /href="\/usuarios"/);
  assert.match(indexHtml, /data-resource="usuarios"/);
  assert.match(indexHtml, /listOrdersForCurrentProfile/);
  assert.match(indexHtml, /id="bootstrap-screen"/);
  assert.match(indexHtml, /id="bootstrap-message"/);
  assert.match(indexHtml, /id="app"\s+class="hidden flex h-screen overflow-hidden"/);
  assert.doesNotMatch(indexHtml, /legacy\/pages-module\.js/);
  assert.match(indexHtml, /function withTimeout\(label, promise, timeoutMs\)/);

  const popstateMatches = appShell.match(/addEventListener\('popstate'/g) || [];
  assert.equal(popstateMatches.length, 1);

  assert.doesNotMatch(pedidosHtml, /<!doctype/i);
  assert.doesNotMatch(pedidosHtml, /<html\b/i);
  assert.doesNotMatch(pedidosHtml, /<head\b/i);
  assert.doesNotMatch(pedidosHtml, /<body\b/i);
  assert.doesNotMatch(pedidosHtml, /<script\b/i);
  assert.doesNotMatch(pedidosHtml, /\bonclick\s*=/i);
  assert.doesNotMatch(pedidosHtml, /\bonchange\s*=/i);
  assert.doesNotMatch(pedidosHtml, /\bonsubmit\s*=/i);

  assert.doesNotMatch(usuariosHtml, /<!doctype/i);
  assert.doesNotMatch(usuariosHtml, /<html\b/i);
  assert.doesNotMatch(usuariosHtml, /<head\b/i);
  assert.doesNotMatch(usuariosHtml, /<body\b/i);
  assert.doesNotMatch(usuariosHtml, /<script\b/i);
  assert.doesNotMatch(usuariosHtml, /\bonclick\s*=/i);
  assert.doesNotMatch(usuariosHtml, /\bonchange\s*=/i);
  assert.doesNotMatch(usuariosHtml, /\bonsubmit\s*=/i);

  assert.doesNotMatch(loginHtml, /<!doctype/i);
  assert.doesNotMatch(loginHtml, /<html\b/i);
  assert.doesNotMatch(loginHtml, /<head\b/i);
  assert.doesNotMatch(loginHtml, /<body\b/i);
  assert.doesNotMatch(loginHtml, /<script\b/i);
  assert.doesNotMatch(loginHtml, /\bonclick\s*=/i);
  assert.doesNotMatch(loginHtml, /\bonchange\s*=/i);
  assert.doesNotMatch(loginHtml, /\bonsubmit\s*=/i);

  assert.doesNotMatch(lojasHtml, /\bonclick\s*=/i);
  assert.doesNotMatch(lojasHtml, /\bonchange\s*=/i);
  assert.doesNotMatch(lojasHtml, /\boninput\s*=/i);

  assert.doesNotMatch(ordersCss, /onclick\s*=/i);
  assert.doesNotMatch(usersCss, /onclick\s*=/i);

  assert.match(server, /require\('\.\/src\/server\/app'\)/);
  assert.match(serverApp, /express\.static\(PUBLIC_DIR/);
  assert.match(serverApp, /app\.get\(\['\/dashboard', '\/login', '\/pedidos', '\/novo-pedido', '\/lojas', '\/usuarios', '\/estoque', '\/suprimentos', '\/dashboard-suprimentos', '\/estoque-sfera'\]/);
  assert.doesNotMatch(serverApp, /app\.get\('\*'/);
  assert.match(serverApp, /\/api\/config/);
  assert.match(serverApp, /\/api\/health/);

  const sandbox = createSandbox();
  loadModule(path.join('public', 'js', 'core', 'app-shell.js'), sandbox);

  sandbox.AppShellModule.setRouterContext({
    API_OK() {
      return true;
    },
    afterRenderForm() {},
    carregarLojas() {
      return Promise.resolve([]);
    },
    carregarPedidos() {
      return Promise.resolve([]);
    },
    carregarStats() {
      return Promise.resolve({});
    },
    decidirPedidoAPI() {
      return Promise.resolve();
    },
    enqueueRouteRefresh() {
      return Promise.resolve();
    },
    getCurrentUser() {
      return { papel: 'admin' };
    },
    getSb() {
      return null;
    },
    listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
    iniciarApp() {
      return Promise.resolve();
    },
    listOrdersForCurrentProfile() {
      return Promise.resolve([]);
    },
    mapRole(role) {
      return role;
    },
    navigateTo() {
      return Promise.resolve();
    },
    renderDashboard() {
      return '<section>Dashboard</section>';
    },
    renderDrawerHistory() {
      return '';
    },
    renderDrawerItems() {
      return '';
    },
    renderDrawerStatusBar() {
      return '';
    },
    showPage() {
      return Promise.resolve();
    },
    showToast() {},
    statCard() {
      return '';
    },
    statusBadge() {
      return '';
    },
    waveCard() {
      return '';
    },
  });

  sandbox.location.pathname = '/pedidos';
  sandbox.location.href = 'http://localhost:3000/pedidos';

  sandbox.fetch = function fetch(url) {
    if (String(url).includes('/pages/pedidos.html')) {
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve('<section id="orders-page">Pedidos</section>');
        },
      });
    }

    return Promise.resolve({
      ok: true,
      text() {
        return Promise.resolve('<section>Fallback</section>');
      },
    });
  };

  const routeResolved = await Promise.race([
    sandbox.AppShellModule.handleRouteChange({ force: true }).then(() => true),
    delay(100).then(() => false),
  ]);

  assert.equal(routeResolved, true);
  assert.match(sandbox.document.getElementById('content').innerHTML, /Pedidos/);

  let formInitDeps = null;
  const formSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'core', 'app-shell.js'), formSandbox);
  formSandbox.FormModule.afterRenderFormulario = function afterRenderFormulario(deps) {
    formInitDeps = deps;
    return Promise.resolve();
  };
  formSandbox.AppShellModule.setRouterContext({
    API_OK() {
      return true;
    },
    afterRenderForm() {},
    carregarLojas() {
      return Promise.resolve([]);
    },
    carregarPedidos() {
      return Promise.resolve([]);
    },
    carregarStats() {
      return Promise.resolve({});
    },
    decidirPedidoAPI() {
      return Promise.resolve();
    },
    enqueueRouteRefresh() {
      return Promise.resolve();
    },
    getCurrentUser() {
      return { papel: 'admin' };
    },
    getSb() {
      return null;
    },
    enviarPedidoAPI() {
      return Promise.resolve({ protocolo: 'ORD-1', status: 'DRAFT' });
    },
    iniciarApp() {
      return Promise.resolve();
    },
    listOrdersForCurrentProfile() {
      return Promise.resolve([]);
    },
    listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
    mapRole(role) {
      return role;
    },
    navigateTo() {
      return Promise.resolve();
    },
    renderDashboard() {
      return '<section>Dashboard</section>';
    },
    renderDrawerHistory() {
      return '';
    },
    renderDrawerItems() {
      return '';
    },
    renderDrawerStatusBar() {
      return '';
    },
    showPage() {
      return Promise.resolve();
    },
    showToast() {},
    statCard() {
      return '';
    },
    statusBadge() {
      return '';
    },
    waveCard() {
      return '';
    },
  });

  formSandbox.location.pathname = '/novo-pedido';
  formSandbox.location.href = 'http://localhost:3000/novo-pedido';
  formSandbox.fetch = function fetch(url) {
    if (String(url).includes('/pages/novo-pedido.html')) {
      return Promise.resolve({
        ok: true,
        text() {
          return Promise.resolve('<section id="form-page">Novo Pedido</section>');
        },
      });
    }

    return Promise.resolve({
      ok: true,
      text() {
        return Promise.resolve('<section>Fallback</section>');
      },
    });
  };

  const formRouteResolved = await Promise.race([
    formSandbox.AppShellModule.handleRouteChange({ force: true }).then(() => true),
    delay(100).then(() => false),
  ]);

  assert.equal(formRouteResolved, true);
  assert.equal(typeof formInitDeps.API_OK, 'function');
  assert.equal(typeof formInitDeps.showToast, 'function');
  assert.equal(typeof formInitDeps.enviarPedidoAPI, 'function');
  assert.equal(typeof formInitDeps.carregarLojas, 'function');
  assert.equal(typeof formInitDeps.carregarPedidos, 'function');

  let loginInitDeps = null;
  const loginSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'core', 'app-shell.js'), loginSandbox);
  loginSandbox.AuthModule = {
    afterRenderLogin: function afterRenderLogin(deps) {
      loginInitDeps = deps;
      return Promise.resolve();
    },
  };
  loginSandbox.AppShellModule.setRouterContext({
    API_OK() { return true; },
    afterRenderForm() {},
    carregarLojas() { return Promise.resolve([]); },
    carregarPedidos() { return Promise.resolve([]); },
    carregarStats() { return Promise.resolve({}); },
    getCurrentUser() { return null; },
    getSb() { return null; },
    initSupabase() { return Promise.resolve(); },
    iniciarApp() { return Promise.resolve(); },
    listOrdersForCurrentProfile() { return Promise.resolve([]); },
    listUsers() {
      return Promise.resolve({ items: [], page: 1, pageSize: 20, stores: [], summary: { active: 0, admin: 0, blocked: 0, invited: 0, total: 0 }, total: 0, totalPages: 1 });
    },
    mapRole(role) { return role; },
    navigateTo() { return Promise.resolve(); },
    renderDashboard() { return '<section>Dashboard</section>'; },
    renderDrawerHistory() { return ''; },
    renderDrawerItems() { return ''; },
    renderDrawerStatusBar() { return ''; },
    showPage() { return Promise.resolve(); },
    showToast() {},
    statCard() { return ''; },
    statusBadge() { return ''; },
    waveCard() { return ''; },
  });

  loginSandbox.location.pathname = '/login';
  loginSandbox.location.href = 'http://localhost:3000/login';
  loginSandbox.fetch = function fetch(url) {
    if (String(url).includes('/pages/login.html')) {
      return Promise.resolve({
        ok: true,
        text() { return Promise.resolve('<section id="login-form">Login</section>'); },
      });
    }
    return Promise.resolve({ ok: true, text() { return Promise.resolve('<section>Fallback</section>'); } });
  };

  const loginRouteResolved = await Promise.race([
    loginSandbox.AppShellModule.handleRouteChange({ force: true }).then(() => true),
    delay(100).then(() => false),
  ]);

  assert.equal(loginRouteResolved, true);
  assert.equal(typeof loginInitDeps.initSupabase, 'function', 'login deps must include initSupabase');

  const unauthorizedSandbox = createSandbox();
  unauthorizedSandbox.AppUtils.canAccessResource = function canAccessResource(currentUser, permissions, resource) {
    return resource !== 'usuarios' && currentUser && currentUser.papel === 'admin';
  };
  loadModule(path.join('public', 'js', 'core', 'app-shell.js'), unauthorizedSandbox);

  let usersModuleInitialized = false;
  unauthorizedSandbox.UsersModule.afterRenderUsuarios = function afterRenderUsuarios() {
    usersModuleInitialized = true;
    return Promise.resolve();
  };
  unauthorizedSandbox.AppShellModule.setRouterContext({
    API_OK() {
      return true;
    },
    afterRenderForm() {},
    carregarLojas() {
      return Promise.resolve([]);
    },
    carregarPedidos() {
      return Promise.resolve([]);
    },
    carregarStats() {
      return Promise.resolve({});
    },
    decidirPedidoAPI() {
      return Promise.resolve();
    },
    enqueueRouteRefresh() {
      return Promise.resolve();
    },
    getCurrentUser() {
      return { papel: 'loja' };
    },
    getSb() {
      return null;
    },
    iniciarApp() {
      return Promise.resolve();
    },
    listOrdersForCurrentProfile() {
      return Promise.resolve([]);
    },
    listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
    mapRole(role) {
      return role;
    },
    navigateTo() {
      return Promise.resolve();
    },
    renderDashboard() {
      return '<section>Dashboard</section>';
    },
    renderDrawerHistory() {
      return '';
    },
    renderDrawerItems() {
      return '';
    },
    renderDrawerStatusBar() {
      return '';
    },
    showPage() {
      return Promise.resolve();
    },
    showToast() {},
    statCard() {
      return '';
    },
    statusBadge() {
      return '';
    },
    waveCard() {
      return '';
    },
  });

  unauthorizedSandbox.location.pathname = '/usuarios';
  unauthorizedSandbox.location.href = 'http://localhost:3000/usuarios';
  unauthorizedSandbox.fetch = function fetch() {
    throw new Error('Users partial should not be fetched for unauthorized access.');
  };

  const unauthorizedResolved = await Promise.race([
    unauthorizedSandbox.AppShellModule.handleRouteChange({ force: true }).then(() => true),
    delay(100).then(() => false),
  ]);

  assert.equal(unauthorizedResolved, true);
  assert.equal(usersModuleInitialized, false);
  assert.match(unauthorizedSandbox.document.getElementById('content').innerHTML, /Acesso não autorizado/);

  // ── Deep-link path preservation ──────────────────────────────────
  var deepLinkSandbox = createSandbox();
  deepLinkSandbox.location.pathname = '/novo-pedido';
  deepLinkSandbox.location.href = 'http://localhost:3000/novo-pedido?orderId=123';
  var replaceStateCalls = [];
  deepLinkSandbox.history.replaceState = function replaceState(state, title, url) {
    replaceStateCalls.push(url);
  };
  loadModule(path.join('public', 'js', 'core', 'app-shell.js'), deepLinkSandbox);
  deepLinkSandbox.AppShellModule.setRouterContext({
    API_OK() { return true; },
    afterRenderForm() {},
    carregarLojas() { return Promise.resolve([]); },
    carregarPedidos() { return Promise.resolve([]); },
    carregarStats() { return Promise.resolve({}); },
    decidirPedidoAPI() { return Promise.resolve(); },
    enqueueRouteRefresh() { return Promise.resolve(); },
    getCurrentUser() { return { papel: 'admin' }; },
    getSb() { return null; },
    iniciarApp() { return Promise.resolve(); },
    listOrdersForCurrentProfile() { return Promise.resolve([]); },
    listUsers() { return Promise.resolve({ items: [], page: 1, pageSize: 20, stores: [], summary: { active: 0, admin: 0, blocked: 0, invited: 0, total: 0 }, total: 0, totalPages: 1 }); },
    mapRole(role) { return role; },
    navigateTo() { return Promise.resolve(); },
    renderDashboard() { return '<section>Dashboard</section>'; },
    renderDrawerHistory() { return ''; },
    renderDrawerItems() { return ''; },
    renderDrawerStatusBar() { return ''; },
    showPage() { return Promise.resolve(); },
    showToast() {},
    statCard() { return ''; },
    statusBadge() { return ''; },
    waveCard() { return ''; },
  });
  deepLinkSandbox.fetch = function fetch(url) {
    if (String(url).includes('/pages/novo-pedido.html')) {
      return Promise.resolve({ ok: true, text() { return Promise.resolve('<section id="form-page">Novo Pedido</section>'); } });
    }
    return Promise.resolve({ ok: true, text() { return Promise.resolve('<section>Fallback</section>'); } });
  };
  var deepLinkResolved = await Promise.race([
    deepLinkSandbox.AppShellModule.handleRouteChange({ force: true }).then(function done() { return true; }),
    delay(100).then(function timeout() { return false; }),
  ]);
  assert.equal(deepLinkResolved, true);
  // replaceState must NOT be called for non-root deep-link paths
  var dashboardReplace = replaceStateCalls.filter(function matchDashboard(u) { return typeof u === 'string' && u.includes('/dashboard'); });
  assert.equal(dashboardReplace.length, 0, 'handleRouteChange must not replaceState to /dashboard for /novo-pedido deep-link');

  console.log('Router checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
