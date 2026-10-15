const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP_MODULE = path.join(ROOT, 'src', 'server', 'app.js');
const SERVICE_MODULE = path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service.js');

function rememberEnv(keys) {
  const snapshot = {};
  keys.forEach((key) => {
    snapshot[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
  });
  return snapshot;
}

function restoreEnv(snapshot) {
  Object.keys(snapshot).forEach((key) => {
    const value = snapshot[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function parseJsonBody(responseText) {
  try {
    return JSON.parse(responseText);
  } catch (_) {
    return null;
  }
}

function startServer(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve(server));
    server.on('error', reject);
  });
}

async function request(server, pathname) {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`Startup test timeout fetching ${pathname}`)), 5000);
  try {
    const response = await fetch(new URL(pathname, baseUrl), { signal: ac.signal });
    const text = await response.text();
    return {
      body: text,
      json: parseJsonBody(text),
      response,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const envKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const snapshot = rememberEnv(envKeys);

  try {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;

    clearModule(APP_MODULE);
    clearModule(SERVICE_MODULE);

    const app = require(APP_MODULE);
    assert.equal(typeof app.listen, 'function');

    const serviceModule = require(SERVICE_MODULE);
    const lazyFetchCalls = [];
    const lazyService = serviceModule.createSupabaseAdminService({
      env: {
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_URL: 'https://project.supabase.co',
      },
      fetch: async function fetchStub(url, init) {
        lazyFetchCalls.push({ init, url: String(url) });
        return {
          ok: true,
          text() {
            return Promise.resolve('{}');
          },
        };
      },
    });

    assert.equal(typeof lazyService.assertConfigured, 'function');
    assert.throws(
      () => lazyService.assertConfigured(),
      (error) => error && error.status === 503 && error.code === 'ADMIN_SERVICE_NOT_CONFIGURED'
    );
    assert.equal(lazyFetchCalls.length, 0);

    const server = await startServer(app);
    try {
      const health = await request(server, '/api/health');
      assert.equal(health.response.status, 200);
      assert.equal(health.json.ok, true);

      const index = await request(server, '/');
      assert.equal(index.response.status, 200);
      assert.match(index.body, /Sfera VM - Sistema de Controle de Pedidos/);

      const estoque = await request(server, '/estoque');
      assert.equal(estoque.response.status, 200);
      assert.match(estoque.body, /Sfera VM - Sistema de Controle de Pedidos/);

      const admin = await request(server, '/api/admin/users');
      assert.equal(admin.response.status, 503);
      assert.equal(admin.json.code, 'ADMIN_SERVICE_NOT_CONFIGURED');
      assert.match(admin.json.error, /serviço administrativo não está configurado/i);
      assert.equal(JSON.stringify(admin.json).includes('SUPABASE_SERVICE_ROLE_KEY'), false);
      assert.equal(JSON.stringify(admin.json).includes('anon-key'), false);
      assert.equal(JSON.stringify(admin.json).includes('service-role-key'), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    console.log('Startup checks ok.');
  } finally {
    restoreEnv(snapshot);
    clearModule(APP_MODULE);
    clearModule(SERVICE_MODULE);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
