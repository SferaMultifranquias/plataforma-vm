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
  return {
    className: '',
    classList: {
      add() {},
      remove() {},
      
      toggle() {},
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
      getBootstrapId() {
        return 'boot-test';
      },
      getBootstrapRetryHandler() {
        return null;
      },
      logAuthEvent() {},
      logBootstrapEvent() {},
      setBootstrapId() {},
      setBootstrapRetryHandler() {},
      withTimeout(label, promise, timeoutMs) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
      },
    },
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
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout,
    clearTimeout,
    console,
    Promise,
    URL,
  };

  window.window = window;
  window.globalThis = window;
  window.addEventListener = function addEventListener() {};

  return window;
}

function loadModule(file, window) {
  const code = read(file);
  vm.runInNewContext(code, window, { filename: file });
  return window;
}

async function run() {
  const indexHtml = read(path.join('public', 'index.html'));
  const authModule = read(path.join('public', 'js', 'core', 'auth.js'));

  assert.match(indexHtml, /let _supabaseInitPromise = null/);
  assert.match(indexHtml, /function withTimeout\(label, promise, timeoutMs\)/);
  assert.match(indexHtml, /function setBootstrapId\(bootId\)/);
  assert.match(indexHtml, /function showBootstrapError\(error, options\)/);
  assert.match(indexHtml, /id="bootstrap-message"/);

  assert.match(authModule, /var bootstrapPromise = null/);
  assert.match(authModule, /var bootstrapState = \{/);
  assert.match(authModule, /function setBootstrapState\(nextState, details\)/);
  assert.match(authModule, /function withTimeout\(label, promise, timeoutMs\)/);
  assert.match(authModule, /logBoot\('ready-public'\)/);
  assert.match(authModule, /logBoot\('ready-authenticated'\)/);
  assert.match(authModule, /setBootstrapState\('STARTING_ROUTER'\)/);
  assert.match(authModule, /setBootstrapState\('ERROR'/);
  assert.doesNotMatch(authModule, /await deps\.checkBackend\(\);/);

  // nav-admin is NOT hidden for non-admin users (shows Minha Conta)
  var navAdminHideLine = authModule.match(/adminEl\?\.classList\.add\('hidden'\)/);
  assert.equal(navAdminHideLine, null, 'auth.js must not hide nav-admin for non-admin users');
  var navAdminRemoveLine = authModule.match(/adminEl\?\.classList\.remove\('hidden'\)/);
  assert.ok(navAdminRemoveLine, 'auth.js must restore nav-admin visibility for admin users');

  const timeoutSandbox = createSandbox();
  await assert.rejects(
    timeoutSandbox.AppDiagnostics.withTimeout('probe', new Promise(() => {}), 5),
    /probe timed out after 5ms/
  );

  const appSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'core', 'auth.js'), appSandbox);

  const appResolved = await Promise.race([
    appSandbox.AuthModule.iniciarApp({
      aplicarPermissoes() {},
      canAccess() {
        return true;
      },
      carregarPermissoes() {
        return Promise.resolve();
      },
      checkBackend() {
        return new Promise(() => {});
      },
      getCurrentUser() {
        return { nome: 'Ana Silva', papel: 'admin' };
      },
      papeis: {
        admin: { label: 'Administrador' },
      },
    }).then(() => true),
    delay(100).then(() => false),
  ]);
  assert.equal(appResolved, true);

  const bootstrapSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'core', 'auth.js'), bootstrapSandbox);

  const fakeSb = {
    auth: {
      getSession() {
        return Promise.resolve({ data: { session: null }, error: null });
      },
      onAuthStateChange() {},
      signOut() {
        return Promise.resolve();
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  const bootstrapResolved = await Promise.race([
    bootstrapSandbox.AuthModule.bootstrap({
      aplicarPermissoes() {},
      canAccess() {
        return true;
      },
      carregarPermissoes() {
        return Promise.resolve();
      },
      checkBackend() {
        return Promise.resolve();
      },
      getCurrentUser() {
        return null;
      },
      getSb() {
        return fakeSb;
      },
      hideBootstrapScreen() {},
      initSupabase() {
        return Promise.resolve(fakeSb);
      },
      isSupabaseReady() {
        return true;
      },
      iniciarApp() {
        return Promise.resolve();
      },
      handleRouteChange() {
        return Promise.resolve();
      },
      mapRole(role) {
        return String(role || 'USER').toLowerCase();
      },
      papeis: {
        admin: { label: 'Administrador' },
      },
      setCurrentUser() {
        return Promise.resolve();
      },
      showBootstrapError() {},
      showPage() {},
      navigateTo() {
        return Promise.resolve();
      },
    }).then(() => true),
    delay(100).then(() => false),
  ]);
  assert.equal(bootstrapResolved, true);

  console.log('Auth cold-start checks ok.');

  var loginHtml = read(path.join('public', 'pages', 'login.html'));

  assert.ok(loginHtml.includes('>Login<'), 'Field label is Login');
  assert.ok(loginHtml.includes('Acesse sua conta para continuar.'), 'Helper text present');
  assert.ok(loginHtml.includes('id="login-email"'), 'login-email id present');
  assert.ok(loginHtml.includes('id="login-senha"'), 'login-senha id present');
  assert.ok(loginHtml.includes('id="login-btn"'), 'login-btn id present');
  assert.ok(loginHtml.includes('id="login-toggle-senha"'), 'login-toggle-senha id present');
  assert.ok(loginHtml.includes('id="login-error"'), 'login-error id present');
  assert.ok(loginHtml.includes('id="login-form"'), 'login-form id present');
  assert.ok(loginHtml.includes('data-lucide="user"'), 'user icon present');
  assert.ok(loginHtml.includes('data-lucide="lock"'), 'lock icon present');
  assert.ok(loginHtml.includes('data-lucide="eye"'), 'eye icon present');
  assert.ok(loginHtml.includes('data-lucide="log-in"'), 'log-in icon present');
  assert.ok(loginHtml.includes('type="email"'), 'email input type preserved');
  assert.ok(loginHtml.includes('autocomplete="email"'), 'email autocomplete preserved');
  assert.ok(loginHtml.includes('autocomplete="current-password"'), 'password autocomplete preserved');
  assert.ok(loginHtml.includes('Sfera Multifranquias - 2026'), 'footer present');

  // ── Deep-link bootstrap preservation ─────────────────────────────
  var deepLinkSandbox = createSandbox();
  deepLinkSandbox.location.pathname = '/pedidos';
  deepLinkSandbox.location.href = 'http://localhost:3000/pedidos';
  loadModule(path.join('public', 'js', 'core', 'auth.js'), deepLinkSandbox);

  var historyReplaceCalls = [];
  var historyPushCalls = [];
  deepLinkSandbox.history.replaceState = function replaceState() {
    historyReplaceCalls.push(Array.prototype.slice.call(arguments));
  };
  deepLinkSandbox.history.pushState = function pushState() {
    historyPushCalls.push(Array.prototype.slice.call(arguments));
  };

  var deepLinkBootstrapResolved = await Promise.race([
    deepLinkSandbox.AuthModule.bootstrap({
      aplicarPermissoes() {},
      canAccess() { return true; },
      carregarPermissoes() { return Promise.resolve(); },
      checkBackend() { return Promise.resolve(); },
      getCurrentUser() { return null; },
      getSb() { return fakeSb; },
      hideBootstrapScreen() {},
      initSupabase() { return Promise.resolve(fakeSb); },
      isSupabaseReady() { return true; },
      iniciarApp() { return Promise.resolve(); },
      handleRouteChange() { return Promise.resolve(); },
      mapRole(role) { return String(role || 'USER').toLowerCase(); },
      papeis: { admin: { label: 'Administrador' } },
      setCurrentUser() { return Promise.resolve(); },
      showBootstrapError() {},
      showPage() {},
      navigateTo(path) {
        // capture redirect target
        deepLinkSandbox._redirectTarget = path;
        return Promise.resolve();
      },
    }).then(function done() { return true; }),
    delay(100).then(function timeout() { return false; }),
  ]);
  assert.equal(deepLinkBootstrapResolved, true);
  // no session → bootstrap redirects to login with original deep-link preserved
  assert.ok(
    String(deepLinkSandbox._redirectTarget || '').includes('redirect=' + encodeURIComponent('/pedidos')),
    'bootstrap redirect from /pedidos must preserve /pedidos in redirect param'
  );

  // ── Authenticated deep-link bootstrap ────────────────────────────
  var authDeepLinkSandbox = createSandbox();
  authDeepLinkSandbox.location.pathname = '/lojas';
  authDeepLinkSandbox.location.href = 'http://localhost:3000/lojas';
  loadModule(path.join('public', 'js', 'core', 'auth.js'), authDeepLinkSandbox);

  var authHistoryReplaceCalls = [];
  var authHistoryPushCalls = [];
  authDeepLinkSandbox.history.replaceState = function replaceState() {
    authHistoryReplaceCalls.push(Array.prototype.slice.call(arguments));
  };
  authDeepLinkSandbox.history.pushState = function pushState() {
    authHistoryPushCalls.push(Array.prototype.slice.call(arguments));
  };

  var authFakeSb = {
    auth: {
      getSession() {
        return Promise.resolve({
          data: { session: { access_token: 'tok', refresh_token: 'rtok', user: { id: 'uid1', email: 'a@b.com', app_metadata: { role: 'ADMIN' }, user_metadata: {} } } },
          error: null,
        });
      },
      onAuthStateChange() {},
      getUser() {
        return Promise.resolve({
          data: {
            user: { id: 'uid1', email: 'a@b.com', app_metadata: { role: 'ADMIN' }, user_metadata: {} },
          },
          error: null,
        });
      },
      signOut() { return Promise.resolve(); },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null });
                }
              };
            }
          };
        }
      };
    },
  };

  var routeChangedOnPath = null;
  var authDeepLinkBootstrapResolved = await Promise.race([
    authDeepLinkSandbox.AuthModule.bootstrap({
      aplicarPermissoes() {},
      canAccess() { return true; },
      carregarPermissoes() { return Promise.resolve(); },
      checkBackend() { return Promise.resolve(); },
      getCurrentUser() { return { id: 'uid1', nome: 'Admin', papel: 'admin' }; },
      getSb() { return authFakeSb; },
      hideBootstrapScreen() {},
      initSupabase() { return Promise.resolve(authFakeSb); },
      isSupabaseReady() { return true; },
      iniciarApp() { return Promise.resolve(); },
      handleRouteChange() {
        routeChangedOnPath = authDeepLinkSandbox.location.pathname;
        return Promise.resolve();
      },
      mapRole(role) { return String(role || 'USER').toLowerCase(); },
      papeis: { admin: { label: 'Administrador' } },
      setCurrentUser() { return Promise.resolve(); },
      showBootstrapError() {},
      showPage() {},
      navigateTo() { return Promise.resolve(); },
    }).then(function done() { return true; }),
    delay(200).then(function timeout() { return false; }),
  ]);
  assert.equal(authDeepLinkBootstrapResolved, true);
  assert.equal(routeChangedOnPath, '/lojas', 'handleRouteChange must be called with preserved /lojas path');

  var forgotPasswordMatch = loginHtml.match(/esqueci[-\s]?(minha)?[-\s]?(senha|password)/i);
  assert.equal(forgotPasswordMatch, null, 'No password recovery link');

  console.log('Login partial markup checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
