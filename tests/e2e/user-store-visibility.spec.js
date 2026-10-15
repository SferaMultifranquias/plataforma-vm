const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { assertMutationTarget } = require('./helpers/runtime');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key) || !String(process.env[key] || '').trim()) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env');
loadEnvFile('.env.e2e');

const liveEnabled = process.env.E2E_ALLOW_LIVE_READS === 'true'
  && process.env.E2E_ALLOW_LIVE_WRITES === 'true'
  && process.env.E2E_ALLOW_LIVE_CRUD === 'true';

const state = {
  admin: null,
  fixtures: {},
  marker: buildCorrelationMarker(),
  oneStoreOrderMarker: '',
  stores: {},
};

function getAdminCredentials() {
  return {
    email: String(process.env.E2E_ADMIN_EMAIL || '').trim(),
    password: String(process.env.E2E_ADMIN_PASSWORD || ''),
  };
}

function getBaseUrl() {
  return String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

function getDisposablePassword() {
  const password = String(process.env.E2E_TEST_USER_PASSWORD || '');
  if (!password) throw new Error('E2E_TEST_USER_PASSWORD is required.');
  return password;
}

function warnAboutTarget(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  console.log(`E2E target host: ${hostname}`);
  return hostname;
}

function readMarkerText(text, marker) {
  return String(text || '').includes(marker);
}

function sanitizeList(list) {
  return Array.isArray(list)
    ? list.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

async function isVisible(page, selector, timeout) {
  return page.locator(selector).isVisible({ timeout }).catch(() => false);
}

async function openLogin(page, options) {
  const timeout = options && Number.isFinite(options.timeout) ? options.timeout : 10000;
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout });

  const path = new URL(page.url()).pathname;
  if (path !== '/login') return { redirected: true, path };

  const formVisible = await isVisible(page, '#login-form', Math.min(5000, timeout));
  if (!formVisible) {
    throw new Error(`Login form unavailable at ${page.url()}.`);
  }

  return { redirected: false, path };
}

async function submitLogin(page, email, password, options) {
  await openLogin(page, options);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-senha').fill(password);
  await page.locator('#login-btn').click();
}

async function loginAsAdmin(page, credentials, options) {
  await submitLogin(page, credentials.email, credentials.password, options);
  const timeout = options && Number.isFinite(options.timeout) ? options.timeout : 15000;
  const settled = await Promise.race([
    page.locator('#sidebar-username').waitFor({ state: 'visible', timeout }).then(() => 'ready'),
    page.locator('#login-error').waitFor({ state: 'visible', timeout }).then(() => 'login-error'),
    page.locator('#bootstrap-screen[data-state="error"]').waitFor({ state: 'visible', timeout }).then(() => 'bootstrap-error'),
  ]).catch((error) => {
    throw new Error(`Login did not settle within ${timeout}ms: ${error.message}`);
  });

  if (settled === 'login-error') {
    throw new Error(String(await page.locator('#login-error').textContent().catch(() => '') || 'Login rejected.').trim());
  }

  if (settled === 'bootstrap-error') {
    throw new Error('Login bootstrap failed.');
  }
}

async function loginAsDisposableUser(page, email, password, options) {
  await submitLogin(page, email, password, options);
  const timeout = options && Number.isFinite(options.timeout) ? options.timeout : 15000;
  const settled = await Promise.race([
    page.locator('#sidebar-username').waitFor({ state: 'visible', timeout }).then(() => 'ready'),
    page.locator('#login-error').waitFor({ state: 'visible', timeout }).then(() => 'login-error'),
    page.locator('#bootstrap-screen[data-state="error"]').waitFor({ state: 'visible', timeout }).then(() => 'bootstrap-error'),
  ]).catch((error) => {
    throw new Error(`Login did not settle within ${timeout}ms: ${error.message}`);
  });

  if (settled === 'login-error') {
    throw new Error(String(await page.locator('#login-error').textContent().catch(() => '') || 'Login rejected.').trim());
  }

  if (settled === 'bootstrap-error') {
    throw new Error('Login bootstrap failed.');
  }
}

function assertLiveCrudEnabled() {
  if (process.env.E2E_ALLOW_LIVE_READS !== 'true' || process.env.E2E_ALLOW_LIVE_WRITES !== 'true' || process.env.E2E_ALLOW_LIVE_CRUD !== 'true') {
    throw new Error('Live E2E gates must all be true.');
  }
  assertMutationTarget();
}

function buildCorrelationMarker() {
  return `usv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getTestEmailDomain() {
  const domain = String(process.env.E2E_TEST_EMAIL_DOMAIN || '').trim().replace(/^@+/, '');
  if (!domain) throw new Error('E2E_TEST_EMAIL_DOMAIN is required.');
  return domain;
}

function buildDisposableEmail(marker, suffix) {
  return `e2e-user-${marker}-${suffix}@${getTestEmailDomain()}`;
}

function getSupabaseBaseUrl() {
  const value = String(process.env.SUPABASE_URL || '').trim();
  if (!value) throw new Error('SUPABASE_URL is required.');
  return value.replace(/\/$/, '');
}

function getServiceRoleKey() {
  const value = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  return value;
}

async function supabaseRest(path, options) {
  const response = await fetch(`${getSupabaseBaseUrl()}${path}`, {
    ...options,
    headers: {
      apikey: getServiceRoleKey(),
      Authorization: `Bearer ${getServiceRoleKey()}`,
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    },
  });

  const text = await response.text().catch(() => '');
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = { raw: text };
    }
  }

  if (!response.ok) {
    const message = json && (json.message || json.error || json.raw) ? String(json.message || json.error || json.raw) : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = json;
    throw error;
  }

  return json;
}

async function readAdminAccessToken(page) {
  return page.evaluate(async () => {
    const client = typeof sb !== 'undefined' ? sb : null;
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') {
      throw new Error('Supabase client unavailable in browser session.');
    }

    const result = await client.auth.getSession();
    return result?.data?.session?.access_token || '';
  });
}

async function listUsersViaAdminApi(page, searchText, accessToken) {
  const token = accessToken || await readAdminAccessToken(page);
  if (!token) throw new Error('ADMIN session token unavailable.');

  const response = await page.request.get(`/api/admin/users?search=${encodeURIComponent(searchText)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Admin API list failed: HTTP ${response.status()}${body ? ` :: ${body.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

async function fetchActiveStores() {
  const rows = await supabaseRest('/rest/v1/lojas?select=id,nome,ativo&order=id.asc', { method: 'GET' });
  return Array.isArray(rows)
    ? rows.filter((row) => row && row.ativo !== false).map((row) => ({ id: String(row.id), name: String(row.nome || ''), active: row.ativo !== false }))
    : [];
}

async function createDisposableUser(page, accessToken, payload) {
  const response = await page.request.post('/api/admin/users', {
    data: {
      email: payload.email,
      isActive: payload.isActive,
      name: payload.name,
      password: payload.password,
      role: payload.role,
      storeIds: Array.isArray(payload.storeIds) ? payload.storeIds : [],
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text().catch(() => '');
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || `create user failed (HTTP ${response.status()}).`);
    error.code = data.code || '';
    error.status = response.status();
    throw error;
  }

  return data;
}

async function updateDisposableUser(page, accessToken, userId, payload) {
  const response = await page.request.patch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    data: {
      email: payload.email,
      isActive: payload.isActive,
      name: payload.name,
      password: payload.password || '',
      role: payload.role,
      storeIds: Array.isArray(payload.storeIds) ? payload.storeIds : [],
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text().catch(() => '');
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || `update user failed (HTTP ${response.status()}).`);
    error.code = data.code || '';
    error.status = response.status();
    throw error;
  }

  return data;
}

async function deleteDisposableUser(page, accessToken, userId) {
  const response = await page.request.delete(`/api/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text().catch(() => '');
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || `delete user failed (HTTP ${response.status()}).`);
    error.code = data.code || '';
    error.status = response.status();
    throw error;
  }

  return data;
}

function hasMarker(value, marker) {
  return String(value || '').includes(marker);
}

function assertDisposableIdentity(record, marker, expectedEmail) {
  if (!record || !record.id) {
    throw new Error('Disposable user record missing.');
  }

  if (!hasMarker(record.email, marker) || (expectedEmail && String(record.email || '').toLowerCase() !== String(expectedEmail).toLowerCase())) {
    throw new Error('Disposable user email mismatch.');
  }

  if (String(record.role || '').toLowerCase() === 'admin') {
    throw new Error('Refusing ADMIN disposable user.');
  }

  if (!hasMarker(record.name, marker) && !hasMarker(record.email, marker)) {
    throw new Error('Disposable user missing E2E marker.');
  }

  return record;
}

async function getDisposableUserRecord(page, accessToken, email, marker) {
  const payload = await listUsersViaAdminApi(page, email, accessToken);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const record = items.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase()) || null;
  if (!record) {
    throw new Error(`Disposable user not found: ${email}`);
  }

  return assertDisposableIdentity(record, marker, email);
}

async function getUserStoreAssignments(userId) {
  const rows = await supabaseRest(`/rest/v1/user_stores?select=user_id,store_id&user_id=eq.${encodeURIComponent(userId)}&order=store_id.asc`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows.map((row) => ({ userId: String(row.user_id), storeId: String(row.store_id) })) : [];
}

async function unlinkDisposableUserStores({ userId, email, marker }) {
  assertLiveCrudEnabled();
  if (!userId) throw new Error('Disposable user id required.');
  if (!email || !hasMarker(email, marker)) throw new Error('Disposable user email missing marker.');
  if (!marker) throw new Error('Correlation marker required.');

  const record = await supabaseRest(`/rest/v1/profiles?select=id,email,role,name,is_active&id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET',
  });

  const profile = Array.isArray(record) && record.length ? record[0] : null;
  if (!profile) {
    throw new Error('Disposable profile not found.');
  }
  if (String(profile.role || '').toLowerCase() === 'admin') {
    throw new Error('Refusing ADMIN disposable user.');
  }
  if (!hasMarker(profile.email, marker)) {
    throw new Error('Disposable profile missing E2E marker.');
  }

  await supabaseRest(`/rest/v1/user_stores?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  return getUserStoreAssignments(userId);
}

async function findOrdersByMarker(marker) {
  const rows = await supabaseRest(`/rest/v1/orders?select=id,requester_id,store_id,notes,purpose&notes=ilike.*${encodeURIComponent(marker)}*`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows.map((row) => ({ id: String(row.id), requesterId: String(row.requester_id || ''), storeId: String(row.store_id || ''), notes: String(row.notes || ''), purpose: String(row.purpose || '') })) : [];
}

async function findOrderArtifactsByOrderId(orderId) {
  const [items, images, history] = await Promise.all([
    supabaseRest(`/rest/v1/order_items?select=id,order_id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/order_images?select=id,order_id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/status_history?select=id,order_id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
  ]);

  return {
    items: Array.isArray(items) ? items.map((row) => String(row.id)) : [],
    images: Array.isArray(images) ? images.map((row) => String(row.id)) : [],
    history: Array.isArray(history) ? history.map((row) => String(row.id)) : [],
  };
}

async function deleteOrderArtifactsByOrderId(orderId) {
  await Promise.all([
    supabaseRest(`/rest/v1/status_history?order_id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
    supabaseRest(`/rest/v1/order_images?order_id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
    supabaseRest(`/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
    supabaseRest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
  ]);
}

async function cleanupMarkerOrders(marker) {
  const orders = await findOrdersByMarker(marker);
  for (const order of orders) {
    await deleteOrderArtifactsByOrderId(order.id);
  }
  return orders;
}

function findMarkerUsers(items, marker) {
  return Array.isArray(items)
    ? items.filter((item) => readMarkerText(item && item.email, marker))
    : [];
}

async function withDiagnostics(page, testInfo, fn) {
  const consoleErrors = [];
  const networkFailures = [];

  const onConsole = (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(String(message.text() || '').slice(0, 400));
    }
  };

  const onRequestFailed = (request) => {
    const failure = request.failure();
    networkFailures.push(`${request.method()} ${request.url()} :: ${failure ? String(failure.errorText || '') : 'failed'}`.slice(0, 400));
  };

  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);

  try {
    return await fn({ consoleErrors, networkFailures });
  } catch (error) {
    const body = [];
    if (consoleErrors.length) body.push(`Console errors:\n${consoleErrors.join('\n')}`);
    if (networkFailures.length) body.push(`Network failures:\n${networkFailures.join('\n')}`);
    body.push(`Target host: ${new URL(getBaseUrl()).hostname}`);
    await testInfo.attach('e2e-debug.txt', {
      body: body.join('\n\n'),
      contentType: 'text/plain',
    });
    throw error;
  } finally {
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
  }
}

async function getStoreSelectOptionTexts(page) {
  return sanitizeList(await page.locator('#f-loja option').allTextContents());
}

async function expectStoreOptions(page, expectedNames) {
  const texts = await getStoreSelectOptionTexts(page);
  const filtered = texts.filter((value) => value !== 'Selecione a loja...');
  expect(filtered.sort()).toEqual([...expectedNames].sort());
}

async function openOrderFormAs(page, email, password) {
  await loginAsDisposableUser(page, email, password, { timeout: 20000 });
  await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#form-pedido')).toBeVisible();
}

async function createFixtures(page, token) {
  const stores = await fetchActiveStores();
  const rodo = stores.find((store) => store.name === 'RODO');
  const halfeld = stores.find((store) => store.name === 'HALFELD');

  if (!rodo || !halfeld) {
    throw new Error('Expected active stores RODO and HALFELD not available.');
  }

  state.stores = { rodo, halfeld };

  const activeUsers = await listUsersViaAdminApi(page, state.marker, token);
  const existingMarkerUsers = findMarkerUsers(activeUsers.items, state.marker);
  if (existingMarkerUsers.length) {
    throw new Error('Pre-existing disposable fixtures found for current marker.');
  }

  const password = getDisposablePassword();
  const oneStoreEmail = buildDisposableEmail(state.marker, 'one');
  const multiStoreEmail = buildDisposableEmail(state.marker, 'multi');
  const noStoreEmail = buildDisposableEmail(state.marker, 'nostore');
  const inactiveEmail = buildDisposableEmail(state.marker, 'inactive');

  const oneStoreSeed = await createDisposableUser(page, token, {
    email: oneStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} one-store`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  const oneStore = await updateDisposableUser(page, token, oneStoreSeed.id, {
    email: oneStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} one-store`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  const multiStoreSeed = await createDisposableUser(page, token, {
    email: multiStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} multi-store`,
    password,
    role: 'USER',
    storeIds: [rodo.id, halfeld.id],
  });

  const multiStore = await updateDisposableUser(page, token, multiStoreSeed.id, {
    email: multiStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} multi-store`,
    password,
    role: 'USER',
    storeIds: [rodo.id, halfeld.id],
  });

  const noStoreSeedCreated = await createDisposableUser(page, token, {
    email: noStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} no-store`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  const noStoreSeed = await updateDisposableUser(page, token, noStoreSeedCreated.id, {
    email: noStoreEmail,
    isActive: true,
    name: `E2E ${state.marker} no-store`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  await unlinkDisposableUserStores({
    email: noStoreEmail,
    marker: state.marker,
    userId: noStoreSeed.id,
  });

  const noStore = await getDisposableUserRecord(page, token, noStoreEmail, state.marker);
  const noStoreAssignments = await getUserStoreAssignments(noStore.id);
  if (noStoreAssignments.length !== 0) {
    throw new Error('No-store fixture still has assignments.');
  }

  const inactiveSeedCreated = await createDisposableUser(page, token, {
    email: inactiveEmail,
    isActive: true,
    name: `E2E ${state.marker} inactive`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  const inactive = await updateDisposableUser(page, token, inactiveSeedCreated.id, {
    email: inactiveEmail,
    isActive: false,
    name: `E2E ${state.marker} inactive`,
    password,
    role: 'USER',
    storeIds: [halfeld.id],
  });

  state.fixtures = {
    inactive: {
      email: inactive.email,
      id: inactive.id,
      password,
    },
    multiStore: {
      email: multiStore.email,
      id: multiStore.id,
      password,
    },
    noStore: {
      email: noStore.email,
      id: noStore.id,
      password,
    },
    oneStore: {
      email: oneStore.email,
      id: oneStore.id,
      password,
    },
  };

  const oneStoreRecord = await getDisposableUserRecord(page, token, oneStoreEmail, state.marker);
  const multiStoreRecord = await getDisposableUserRecord(page, token, multiStoreEmail, state.marker);
  const inactiveRecord = await getDisposableUserRecord(page, token, inactiveEmail, state.marker);

  expect(oneStoreRecord.role).toBe('loja');
  expect(oneStoreRecord.active).toBe(true);
  expect(sanitizeList(oneStoreRecord.stores?.map((store) => store.name))).toEqual(['HALFELD']);

  expect(multiStoreRecord.role).toBe('loja');
  expect(multiStoreRecord.active).toBe(true);
  expect(sanitizeList(multiStoreRecord.stores?.map((store) => store.name)).sort()).toEqual(['HALFELD', 'RODO']);

  expect(noStore.role).toBe('loja');
  expect(noStore.active).toBe(true);
  expect(Array.isArray(noStore.stores) ? noStore.stores : []).toHaveLength(0);

  expect(inactiveRecord.role).toBe('loja');
  expect(inactiveRecord.active).toBe(false);
  expect(sanitizeList(inactiveRecord.stores?.map((store) => store.name))).toEqual(['HALFELD']);

  return state.fixtures;
}

async function cleanupFixtures(page, token) {
  try {
    await cleanupMarkerOrders(state.marker);
  } catch (error) {
    console.warn(`Order cleanup warning: ${String(error.message || error)}`);
  }

  for (const key of ['inactive', 'multiStore', 'noStore', 'oneStore']) {
    const fixture = state.fixtures[key];
    if (!fixture || !fixture.id) continue;
    try {
      await deleteDisposableUser(page, token, fixture.id);
    } catch (error) {
      console.warn(`User cleanup warning for ${key}: ${String(error.message || error)}`);
    }
  }

  const remainingUsers = await listUsersViaAdminApi(page, state.marker, token);
  const remainingMarkerUsers = (Array.isArray(remainingUsers.items) ? remainingUsers.items : []).filter((item) => readMarkerText(item.email, state.marker));
  if (remainingMarkerUsers.length) {
    throw new Error(`Cleanup failed. Remaining disposable users: ${remainingMarkerUsers.length}`);
  }

  for (const fixture of Object.values(state.fixtures)) {
    if (!fixture || !fixture.id) continue;
    const assignments = await getUserStoreAssignments(fixture.id);
    if (assignments.length) {
      throw new Error(`Cleanup failed. Remaining assignments for ${fixture.email}`);
    }
  }

  const remainingOrders = await findOrdersByMarker(state.marker);
  if (remainingOrders.length) {
    throw new Error(`Cleanup failed. Remaining orders: ${remainingOrders.length}`);
  }
}

if (liveEnabled) {
  test.describe.serial('user store visibility', () => {
    test.beforeAll(async ({ browser }) => {
      assertLiveCrudEnabled();

      const baseUrl = getBaseUrl();
      warnAboutTarget(baseUrl);

      const admin = getAdminCredentials();
      state.admin = admin;

      const context = await browser.newContext({ baseURL: baseUrl });
      const page = await context.newPage();
      try {
        await loginAsAdmin(page, admin, { timeout: 20000 });
        const token = await readAdminAccessToken(page);
        if (!token) {
          throw new Error('ADMIN session token unavailable.');
        }

        state.fixtures = await createFixtures(page, token);
      } catch (error) {
        try {
          const token = await readAdminAccessToken(page).catch(() => '');
          if (token) {
            await cleanupFixtures(page, token).catch(() => {});
          }
        } catch (_) {
          // ignore
        }
        throw error;
      } finally {
        await context.close().catch(() => {});
      }
    });

    test.afterAll(async ({ browser }) => {
      const context = await browser.newContext({ baseURL: getBaseUrl() });
      const page = await context.newPage();
      try {
        await loginAsAdmin(page, state.admin, { timeout: 20000 });
        const token = await readAdminAccessToken(page);
        await cleanupFixtures(page, token);
      } finally {
        await context.close().catch(() => {});
      }
    });

    test('ADMIN sees all expected active stores', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      await loginAsAdmin(page, state.admin, { timeout: 20000 });
      await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });

      await expect(page.locator('#form-pedido')).toBeVisible();
      await expect(page.locator('#f-loja')).toBeEnabled();
      await expect(page.locator('#f-loja option').and(page.locator(':not([value=""])'))).toContainText(['HALFELD', 'RODO']);
    }));

    test('One-store USER sees only HALFELD', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.oneStore;
      await openOrderFormAs(page, fixture.email, fixture.password);

      await expect(page.locator('#store-status-message')).toHaveText('1 loja(s) carregada(s).');
      await expect(page.locator('#f-loja option')).toHaveCount(2);
      await expectStoreOptions(page, ['HALFELD']);
    }));

    test('Multi-store USER sees exactly RODO and HALFELD', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.multiStore;
      await openOrderFormAs(page, fixture.email, fixture.password);

      await expect(page.locator('#store-status-message')).toHaveText('2 loja(s) carregada(s).');
      await expect(page.locator('#f-loja option')).toHaveCount(3);
      await expectStoreOptions(page, ['HALFELD', 'RODO']);
    }));

    test('No-store USER sees disabled selector and empty-state message', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.noStore;
      await openOrderFormAs(page, fixture.email, fixture.password);

      await expect(page.locator('#store-status-message')).toHaveText('Nenhuma loja vinculada ao seu usuário');
      await expect(page.locator('#f-loja')).toBeDisabled();
      await expect(page.locator('#btn-submit-form')).toBeDisabled();
      await expect(page.locator('#f-loja option')).toHaveCount(1);
    }));

    test('Inactive USER cannot access order form', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.inactive;
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.locator('#login-email').fill(fixture.email);
      await page.locator('#login-senha').fill(fixture.password);
      await page.locator('#login-btn').click();

      await expect(page.locator('#login-error')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('#login-error')).toContainText(/inativo|bloquead|credenciais/i);

      await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#login-form')).toBeVisible();
    }));

    test('Browser tampering clears unauthorized loja_id', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.oneStore;
      const rodo = state.stores.rodo;

      await openOrderFormAs(page, fixture.email, fixture.password);

      await page.evaluate((storeId) => {
        const select = document.getElementById('f-loja');
        if (!select) return;
        const option = document.createElement('option');
        option.value = String(storeId);
        option.textContent = 'TAMPERED';
        select.appendChild(option);
        select.value = String(storeId);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, rodo.id);

      await expect(page.locator('#f-loja')).toHaveValue('');
      await expect(page.locator('#btn-submit-form')).toBeDisabled();
    }));

    test('Unauthorized create_order rejects RODO for one-store USER', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const fixture = state.fixtures.oneStore;
      const rodo = state.stores.rodo;
      state.oneStoreOrderMarker = `${state.marker}-unauthorized-order`;

      await openOrderFormAs(page, fixture.email, fixture.password);

      const result = await page.evaluate(async ({ storeId, marker }) => {
        const response = await sb.rpc('create_order', {
          p_brand: 'E2E',
          p_cost_center: 'E2E',
          p_justification: `E2E ${marker}`,
          p_notes: `E2E ${marker}`,
          p_priority: 'NORMAL',
          p_purpose: 'Pedido VM',
          p_store: 'RODO',
          p_store_id: Number(storeId),
        });

        return {
          data: response.data || null,
          error: response.error ? {
            code: response.error.code || '',
            message: response.error.message || '',
          } : null,
        };
      }, { marker: state.oneStoreOrderMarker, storeId: rodo.id });

      expect(result.error).toBeTruthy();
      expect(result.data).toBeNull();
    }));

    test('No unauthorized order persists after rejected RPC', async ({ page }, testInfo) => withDiagnostics(page, testInfo, async () => {
      const orders = await findOrdersByMarker(state.oneStoreOrderMarker);
      const artifacts = await Promise.all(orders.map((order) => findOrderArtifactsByOrderId(order.id)));
      expect(orders).toHaveLength(0);
      expect(artifacts.flatMap((artifact) => artifact.items)).toHaveLength(0);
      expect(artifacts.flatMap((artifact) => artifact.images)).toHaveLength(0);
      expect(artifacts.flatMap((artifact) => artifact.history)).toHaveLength(0);
    }));
  });
}
