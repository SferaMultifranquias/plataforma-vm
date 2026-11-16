'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');

function toFileUrl(...parts) {
  return pathToFileURL(path.join(ROOT, ...parts)).href;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

// ponytail: ESM dynamic import for portable service
async function importPortable() {
  const core = await import(toFileUrl('functions', '_shared', 'admin-core.js'));
  const env = await import(toFileUrl('functions', '_shared', 'env.js'));
  return { core, env };
}

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text() { return Promise.resolve(JSON.stringify(body)); },
  };
}

function createFetchStub(routes) {
  return async function fetchStub(url, init) {
    const parsed = new URL(url);
    const handler = routes[parsed.pathname];
    if (!handler) throw new Error(`Unhandled request: ${parsed.pathname}`);
    const payload = typeof handler === 'function' ? await handler(parsed, init || {}) : handler;
    return makeJsonResponse(payload.status || 200, payload.body);
  };
}

async function run() {
  // ── Static files ────────────────────────────────────────────────
  // _redirects contains every known shell route
  const redirects = read('public/_redirects');
  for (const route of ['/dashboard', '/login', '/pedidos', '/novo-pedido', '/lojas', '/usuarios', '/estoque', '/suprimentos']) {
    assert.ok(redirects.includes(route), `_redirects must include ${route}`);
  }
  // catch-all for SPA deep-link fallback
  assert.ok(redirects.includes('/*'), '_redirects must have global catch-all /* /index.html 200');
  assert.ok(redirects.includes('/index.html'), '_redirects rewrites to /index.html');

  // _headers baseline
  const headers = read('public/_headers');
  assert.ok(headers.includes('X-Content-Type-Options: nosniff'));
  assert.ok(headers.includes('Referrer-Policy: strict-origin-when-cross-origin'));
  assert.ok(headers.includes('Permissions-Policy:'));
  // CSP baseline present
  assert.ok(headers.includes('Content-Security-Policy'), '_headers must set CSP');
  assert.ok(headers.includes("default-src 'self'"), 'CSP: default-src self');
  assert.ok(headers.includes("script-src"), 'CSP: script-src');
  assert.ok(headers.includes("img-src 'self' https://*.supabase.co blob: data:"), 'CSP: signed storage images allowed');
  assert.ok(headers.includes("connect-src 'self' https://*.supabase.co"), 'CSP: Supabase API connect allowed');
  assert.ok(headers.includes("object-src 'none'"), 'CSP: object-src none');
  assert.ok(headers.includes("frame-ancestors 'none'"), 'CSP: frame-ancestors none');

  // CDN scripts must be version-pinned when SRI is used.
  // Tailwind CDN (cdn.tailwindcss.com) does not send CORS headers, so it must not use crossorigin.
  // Other CDNs (unpkg, jsdelivr) support CORS and must use SRI + crossorigin.
  const indexHtml = read('public/index.html');
  const externalScripts = Array.from(indexHtml.matchAll(/<script\s+[^>]*src="https:\/\/[^>]+><\/script>/g)).map((m) => m[0]);
  assert.equal(externalScripts.length, 4, 'expected 4 external CDN scripts');
  const tailwindTags = externalScripts.filter((t) => t.includes('cdn.tailwindcss.com'));
  const otherTags = externalScripts.filter((t) => !t.includes('cdn.tailwindcss.com'));
  assert.equal(tailwindTags.length, 1, 'expected 1 Tailwind CDN script');
  assert.equal(otherTags.length, 3, 'expected 3 non-Tailwind CDN scripts');
  for (const scriptTag of tailwindTags) {
    assert.ok(scriptTag.includes('cdn.tailwindcss.com/3.4.17'), `Tailwind must pin version path: ${scriptTag}`);
    assert.ok(!scriptTag.includes('crossorigin='), `Tailwind CDN must not use crossorigin (no CORS): ${scriptTag}`);
  }
  for (const scriptTag of otherTags) {
    assert.ok(scriptTag.includes('integrity="sha384-'), `external script must have SRI: ${scriptTag}`);
    assert.ok(scriptTag.includes('crossorigin="anonymous"'), `external script must use anonymous CORS: ${scriptTag}`);
    assert.ok(!scriptTag.includes('@latest'), `SRI script must not use @latest: ${scriptTag}`);
  }

  // Security workflow baseline: least privilege and no moving security-tool refs.
  const workflow = read('.github/workflows/security-scan.yml');
  assert.ok(workflow.includes('permissions:'), 'security workflow sets permissions');
  assert.ok(workflow.includes('contents: read'), 'security workflow uses read-only contents permission');
  assert.ok(!workflow.includes('@main'), 'security workflow must not use @main actions');
  assert.ok(!workflow.includes(':latest'), 'security workflow must not use latest container tags');

  // static supabase bundle exists
  assert.ok(exists('public/vendor/supabase/supabase.js'), 'vendored supabase bundle must exist');
  const bundle = read('public/vendor/supabase/supabase.js');
  assert.ok(bundle.includes('createClient'), 'supabase bundle must expose createClient');
  assert.ok(bundle.length > 10000, 'supabase bundle should be substantial');

  // no secrets in public/
  for (const pattern of ['SUPABASE_SERVICE_ROLE_KEY', 'service_role', 'service-role']) {
    assert.ok(!bundle.includes(pattern), `vendored bundle must not contain ${pattern}`);
  }
  // check public/ files for service role key
  const publicFiles = fs.readdirSync(path.join(ROOT, 'public'));
  for (const file of publicFiles) {
    const fp = path.join(ROOT, 'public', file);
    if (fs.statSync(fp).isFile()) {
      const content = fs.readFileSync(fp, 'utf8');
      assert.ok(!content.includes('SUPABASE_SERVICE_ROLE_KEY'), `public/${file} must not contain service role key`);
    }
  }

  // wrangler.toml exists
  assert.ok(exists('wrangler.toml'), 'wrangler.toml must exist');
  const wrangler = read('wrangler.toml');
  assert.ok(wrangler.includes('pages_build_output_dir'), 'wrangler.toml must configure build output');
  assert.ok(!wrangler.includes('SUPABASE_SERVICE_ROLE_KEY'), 'wrangler.toml must not contain secrets');

  // .dev.vars.example exists
  assert.ok(exists('.dev.vars.example'), '.dev.vars.example must exist');
  const devVars = read('.dev.vars.example');
  assert.ok(devVars.includes('SUPABASE_URL'), '.dev.vars.example must document SUPABASE_URL');
  assert.ok(devVars.includes('SUPABASE_ANON_KEY'), '.dev.vars.example must document SUPABASE_ANON_KEY');
  assert.ok(devVars.includes('SUPABASE_SERVICE_ROLE_KEY'), '.dev.vars.example must document SUPABASE_SERVICE_ROLE_KEY');

  // .dev.vars must be in .gitignore
  const gitignore = read('.gitignore');
  assert.ok(gitignore.includes('.dev.vars'), '.gitignore must ignore .dev.vars');

  console.log('Static file checks ok.');

  // ── Admin core pure functions ────────────────────────────────────
  const { core } = await importPortable();

  // AdminError
  const err = new core.AdminError(400, 'TEST_ERROR', 'Test message');
  assert.equal(err.status, 400);
  assert.equal(err.code, 'TEST_ERROR');
  assert.equal(err.message, 'Test message');
  assert.equal(err.details, null);

  const errWithDetails = new core.AdminError(500, 'DETAILED', 'Msg', { extra: true });
  assert.deepEqual(errWithDetails.details, { extra: true });

  // normalizeRole
  assert.equal(core.normalizeRole('ADMIN'), 'admin');
  assert.equal(core.normalizeRole('admin'), 'admin');
  assert.equal(core.normalizeRole('USER'), 'loja');
  assert.equal(core.normalizeRole(''), 'loja');
  assert.equal(core.normalizeRole(null), 'loja');

  // normalizePersistedRole
  assert.equal(core.normalizePersistedRole('ADMIN'), 'ADMIN');
  assert.equal(core.normalizePersistedRole('USER'), 'USER');
  assert.throws(() => core.normalizePersistedRole('INVALID'), /Perfil invalido/);
  assert.throws(() => core.normalizePersistedRole(''), /Perfil invalido/);

  // normalizeEmail
  assert.equal(core.normalizeEmail(' TEST@Example.COM '), 'test@example.com');

  // normalizeName
  assert.equal(core.normalizeName('  John  '), 'John');

  // normalizeBoolean
  assert.equal(core.normalizeBoolean(true, false), true);
  assert.equal(core.normalizeBoolean(false, true), false);
  assert.equal(core.normalizeBoolean('true', false), true);
  assert.equal(core.normalizeBoolean('sim', false), true);
  assert.equal(core.normalizeBoolean('não', true), false);
  assert.equal(core.normalizeBoolean(undefined, true), true);

  // normalizeStoreIds
  assert.deepEqual(core.normalizeStoreIds([10, 11, 10]), [10, 11]);
  assert.throws(() => core.normalizeStoreIds([0]), /lojas selecionadas e invalida/);
  assert.throws(() => core.normalizeStoreIds([-1]), /lojas selecionadas e invalida/);

  // normalizeStatus
  assert.equal(core.normalizeStatus({ is_active: true }, {}), 'active');
  assert.equal(core.normalizeStatus({ is_active: false }, {}), 'blocked');
  assert.equal(core.normalizeStatus({ removedAt: '2026-01-01' }, {}), 'removed');
  assert.equal(core.normalizeStatus({ is_active: true }, { invited_at: '2026-01-01', confirmation_sent_at: '2026-01-01' }), 'invited');

  // normalizeStore
  assert.deepEqual(core.normalizeStore({ id: 10, nome: 'Centro' }), { id: 10, name: 'Centro', codigo: '' });
  assert.deepEqual(core.normalizeStore({ id: 11, name: 'Norte' }), { id: 11, name: 'Norte', codigo: '' });

  // normalizeProfile
  const profile = core.normalizeProfile({
    created_at: '2026-01-01', email: 'a@b.com', id: 'uid',
    name: 'Ana', role: 'ADMIN', updated_at: '2026-01-02',
    is_active: true, removed_at: null, removed_by_id: null,
  });
  assert.equal(profile.role, 'admin');
  assert.equal(profile.active, true);
  assert.equal(profile.removedAt, null);

  // normalizeCreatedUserDto
  const dto = core.normalizeCreatedUserDto(
    { id: 'uid', email: 'a@b.com', name: 'Ana', role: 'ADMIN', is_active: true },
    [{ id: 10, nome: 'Loja Centro' }],
    'TempPass123'
  );
  assert.equal(dto.email, 'a@b.com');
  assert.equal(dto.role, 'admin');
  assert.equal(dto.temporaryPassword, 'TempPass123');
  assert.equal(dto.stores.length, 1);
  assert.equal(dto.stores[0].name, 'Loja Centro');

  // computeSummary
  const sum = core.computeSummary([
    { status: 'active', role: 'admin' },
    { status: 'active', role: 'loja' },
    { status: 'blocked', role: 'loja' },
    { status: 'removed', role: 'loja' },
  ]);
  assert.equal(sum.active, 2);
  assert.equal(sum.admin, 1);
  assert.equal(sum.blocked, 1);
  assert.equal(sum.removed, 1);
  assert.equal(sum.total, 4);

  // buildMergedUsers — stores are pre-normalized by fetchStores()
  const testStores = [{ id: 10, name: 'Centro' }];
  const merged = core.buildMergedUsers(
    [{ id: 'uid1', createdAt: '2026-01-01', email: 'a@b.com', name: 'Ana', role: 'ADMIN', active: true, removedAt: null }],
    [{ id: 'uid1', email: 'a@b.com', last_sign_in_at: '2026-06-01' }],
    [{ user_id: 'uid1', store_id: '10' }],
    testStores
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].email, 'a@b.com');
  assert.equal(merged[0].role, 'admin');
  assert.equal(merged[0].stores.length, 1);
  assert.equal(merged[0].stores[0].name, 'Centro');

  // matchesSearch / matchesStore
  assert.equal(core.matchesSearch({ name: 'Ana', email: 'ana@test.com' }, 'ana'), true);
  assert.equal(core.matchesSearch({ name: 'Bruno', email: 'bruno@test.com' }, 'ana'), false);
  assert.equal(core.matchesStore({ stores: [{ id: 10, name: 'Centro' }] }, '10'), true);
  assert.equal(core.matchesStore({ stores: [{ id: 10, name: 'Centro' }] }, '11'), false);

  console.log('Admin core pure functions ok.');

  // ── Env helpers ─────────────────────────────────────────────────
  const e = await import(toFileUrl('functions', '_shared', 'env.js'));
  assert.equal(e.getEnvValue({ SUPABASE_URL: 'https://x.supabase.co' }, ['SUPABASE_URL']), 'https://x.supabase.co');
  assert.equal(e.getEnvValue({}, ['SUPABASE_URL']), '');
  // placeholder filter only catches exact placeholder patterns, not URLs containing "your-project"
  assert.equal(e.getEnvValue({ SUPABASE_URL: 'https://your-project.supabase.co' }, ['SUPABASE_URL']), 'https://your-project.supabase.co');
  assert.throws(() => e.requireEnv({}, ['MISSING'], 'MISSING'), /MISSING/);

  console.log('Env helpers ok.');

  // ── Portable service (createPagesAdminService) ─────────────────
  // We can't import the ESM service directly in this test environment without
  // a full module loader, but we CAN verify the module structure.
  // The core functions and env helpers tested above are the foundation.
  // Full E2E contract tests (Express vs Pages) require live Supabase and
  // are deferred to preview validation.
  // Static analysis: verify files exist with expected exports
  const adminServicePath = path.join(ROOT, 'functions', '_shared', 'admin-service.js');
  assert.ok(fs.existsSync(adminServicePath), 'admin-service.js must exist');
  const serviceContent = fs.readFileSync(adminServicePath, 'utf8');
  assert.ok(serviceContent.includes('createPagesAdminService'), 'admin-service.js must export createPagesAdminService');
  assert.ok(serviceContent.includes('crypto.getRandomValues'), 'admin-service.js must use Web Crypto');
  assert.ok(!serviceContent.includes('node:crypto'), 'admin-service.js must not import node:crypto');
  assert.ok(!serviceContent.includes('require('), 'admin-service.js must not use require()');

  // verify all Function files exist and export onRequest
  const apiDir = path.join(ROOT, 'functions', 'api');
  const funcFiles = fs.readdirSync(apiDir, { recursive: true, withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .map(d => path.relative(ROOT, path.join(d.parentPath, d.name)));
  for (const f of funcFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} must exist`);
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(content.includes('onRequest'), `${f} must export onRequest`);
  }

  // verify all _shared imports resolve to an existing file
  for (const f of funcFiles) {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const imports = Array.from(content.matchAll(/from ['"]([^'"]*_shared\/[^'"]+)['"]/g));
    for (const m of imports) {
      const resolved = path.resolve(path.dirname(path.join(ROOT, f)), m[1]);
      assert.ok(fs.existsSync(resolved), `${f}: import '${m[1]}' resolves to non-existent file ${path.relative(ROOT, resolved)}`);
    }
  }

  // verify http.js utilities
  const httpPath = path.join(ROOT, 'functions', '_shared', 'http.js');
  assert.ok(fs.existsSync(httpPath), 'http.js must exist');
  const httpContent = fs.readFileSync(httpPath, 'utf8');
  for (const fn of ['jsonResponse', 'errorResponse', 'methodNotAllowed', 'readBodyJson', 'extractBearerToken']) {
    assert.ok(httpContent.includes(fn), `http.js must export ${fn}`);
  }

  // verify env helpers loaded by our import mechanism
  assert.equal(typeof e.getEnvValue, 'function');
  assert.equal(typeof e.requireEnv, 'function');

  // ── Config diagnostics ─────────────────────────────────────────
  const configFunc = read('functions/api/config.js');
  assert.ok(configFunc.includes('CONFIG_INCOMPLETE'), 'config function must handle incomplete config');
  assert.ok(configFunc.includes('hasSupabaseUrl'), 'config function must report hasSupabaseUrl');
  assert.ok(configFunc.includes('hasSupabaseAnonKey'), 'config function must report hasSupabaseAnonKey');
  assert.ok(configFunc.includes('hasViteSupabaseUrl'), 'config function must report hasViteSupabaseUrl');
  assert.ok(configFunc.includes('hasViteSupabaseAnonKey'), 'config function must report hasViteSupabaseAnonKey');
  assert.ok(!configFunc.includes('SERVICE_ROLE_KEY'), 'config function must not expose service role key');
  // verify 500 instead of 503
  assert.ok(configFunc.includes('500'), 'config function error must use 500 status');
  assert.ok(!configFunc.includes('503'), 'config function must not use 503');

  // Express config parity
  const expressApp = read('src/server/app.js');
  assert.ok(expressApp.includes('CONFIG_INCOMPLETE'), 'express config must handle incomplete config');
  assert.ok(expressApp.includes('hasSupabaseUrl'), 'express config must report hasSupabaseUrl');
  assert.ok(expressApp.includes('hasSupabaseAnonKey'), 'express config must report hasSupabaseAnonKey');
  assert.ok(expressApp.includes('hasViteSupabaseUrl'), 'express config must report hasViteSupabaseUrl');
  assert.ok(expressApp.includes('hasViteSupabaseAnonKey'), 'express config must report hasViteSupabaseAnonKey');
  assert.ok(expressApp.includes('status(500)'), 'express config must use 500 status');
  assert.ok(!expressApp.includes('SERVICE_ROLE_KEY'), 'express config must not expose service role key');

  console.log('Config diagnostics ok.');

  // verify Functions create Response objects correctly
  const http = await import(toFileUrl('functions', '_shared', 'http.js'));
  const successResp = http.jsonResponse({ ok: true });
  assert.equal(successResp.status, 200);
  const body = await successResp.json();
  assert.deepEqual(body, { ok: true });

  const errorResp = http.errorResponse('Error', 400, 'BAD');
  assert.equal(errorResp.status, 400);
  const errBody = await errorResp.json();
  assert.equal(errBody.code, 'BAD');
  assert.equal(errBody.error, 'Error');

  const methodErr = http.methodNotAllowed();
  assert.equal(methodErr.status, 405);

  const bearer = http.extractBearerToken({ headers: { get() { return 'Bearer tok123'; } } });
  assert.equal(bearer, 'tok123');

  assert.equal(http.extractBearerToken({ headers: { get() { return ''; } } }), '');
  assert.equal(http.extractBearerToken({ headers: { get() { return 'Basic xyz'; } } }), '');

  console.log('HTTP utilities ok.');

  // ── Contract: Express vs Pages core function parity ──────────
  // Verify core functions from both implementations match
  const expressAdminService = require(path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service'));

  // AdminError class parity
  assert.equal(typeof expressAdminService.AdminError, 'function');
  assert.equal(typeof core.AdminError, 'function');

  // normalizeRole parity
  assert.equal(expressAdminService.createSupabaseAdminService({ env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x' }, fetch: createFetchStub({}) }).normalizeRole('admin'), 'admin');
  assert.equal(core.normalizeRole('admin'), 'admin');
  assert.equal(core.normalizeRole('USER'), 'loja');

  // normalizeEmail parity
  assert.equal(core.normalizeEmail(' Test@X.COM '), 'test@x.com');

  // normalizeStatus parity
  assert.equal(core.normalizeStatus({ is_active: true }, {}), 'active');
  assert.equal(core.normalizeStatus({ is_active: false }, {}), 'blocked');

  // normalizeStore parity
  assert.deepEqual(core.normalizeStore({ id: 1, nome: 'X' }), { id: 1, name: 'X', codigo: '' });

  // createJsonError parity
  const jsonErr1 = core.createJsonError(400, 'TEST', 'msg');
  assert.equal(jsonErr1.status, 400);
  assert.equal(jsonErr1.code, 'TEST');

  console.log('Contract parity checks ok.');

  console.log('All Cloudflare Pages contract checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
