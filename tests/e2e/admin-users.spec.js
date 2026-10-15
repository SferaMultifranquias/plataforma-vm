const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { supabaseRest } = require('./helpers/disposable-user-fixtures');
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

function getBaseUrl() {
  return process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
}

function getHostname(baseUrl) {
  return new URL(baseUrl).hostname;
}

function assertLiveCrudEnabled() {
  if (process.env.E2E_ALLOW_LIVE_CRUD !== 'true') {
    throw new Error('E2E_ALLOW_LIVE_CRUD must be exactly true before live CRUD can run.');
  }
  assertMutationTarget();
}

function warnAboutTarget(baseUrl) {
  const hostname = getHostname(baseUrl);
  console.log(`E2E target host: ${hostname}`);
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    console.warn(`Warning: target host is not localhost: ${hostname}`);
  }
  return hostname;
}

function getAdminCredentials() {
  return {
    email: String(process.env.E2E_ADMIN_EMAIL || '').trim(),
    password: String(process.env.E2E_ADMIN_PASSWORD || ''),
  };
}

function getDisposablePassword() {
  const password = String(process.env.E2E_TEST_USER_PASSWORD || '');
  if (!password) {
    throw new Error('E2E_TEST_USER_PASSWORD is required.');
  }
  return password;
}

function getDisposableEmailDomain() {
  const domain = String(process.env.E2E_TEST_EMAIL_DOMAIN || '').trim().replace(/^@+/, '');
  if (!domain) {
    throw new Error('E2E_TEST_EMAIL_DOMAIN is required.');
  }
  return domain;
}

function buildDisposableEmail() {
  return `e2e-user-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@${getDisposableEmailDomain()}`;
}

async function openLogin(page) {
  await page.goto('/login');
  await page.locator('#login-form').waitFor({ state: 'visible' });
}

async function submitLogin(page, email, password) {
  await openLogin(page);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-senha').fill(password);
  await page.locator('#login-btn').click();
}

async function loginAsAdmin(page, credentials) {
  await submitLogin(page, credentials.email, credentials.password);
  await page.waitForURL(/\/dashboard/);
  await page.locator('#sidebar-username').waitFor({ state: 'visible' });
}

async function logout(page) {
  await page.locator('[title="Sair"]').click();
  await page.waitForURL(/\/login/);
}

async function openUsersPage(page) {
  await page.goto('/usuarios');
  await page.locator('#users-page').waitFor({ state: 'visible' });
  await page.locator('#users-create-open').waitFor({ state: 'visible' });
}

async function openCreateUserModal(page) {
  await page.locator('#users-create-open').click();
  await page.locator('#users-create-modal').waitFor({ state: 'visible' });
}

async function fillCreateUserForm(page, payload) {
  await page.locator('#users-create-name').fill(payload.name);
  await page.locator('#users-create-email').fill(payload.email);
  await page.locator('#users-create-password').fill(payload.password);
  await page.locator('#users-create-role').selectOption(payload.role);
  await page.locator('#users-create-active').setChecked(payload.active);

  if (payload.role === 'USER') {
    const storeCheckbox = page.locator('#users-create-store-list input[type="checkbox"]').first();
    await storeCheckbox.waitFor({ state: 'visible' });
    await storeCheckbox.check();
  }
}

async function submitCreateUser(page) {
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname === '/api/admin/users' && response.ok();
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === '/api/admin/users' && url.search.length > 0 && response.ok();
    }),
    page.locator('#users-create-form').evaluate((form) => form.requestSubmit()),
  ]);
}

async function searchUser(page, searchText) {
  await page.locator('#users-search').fill(searchText);
  await waitForUsersRefresh(page);
}

async function waitForUsersRefresh(page) {
  const loading = page.locator('#users-loading');
  const count = page.locator('#users-count');
  const timeout = 10000;

  try {
    await loading.waitFor({ state: 'hidden', timeout });
  } catch (error) {
    throw new Error(`Users loading state did not settle: ${error.message}`);
  }

  try {
    await expect(count).not.toContainText('Carregando usuários', { timeout });
  } catch (error) {
    throw new Error(`Users count did not refresh: ${error.message}`);
  }
}

async function getUserRow(page, email) {
  const row = page.locator('#users-table-body tr', { hasText: email }).first();
  await row.waitFor({ state: 'visible' });
  return row;
}

async function openEditUserModal(page, email) {
  const row = await getUserRow(page, email);
  await row.locator('[data-user-action="edit"]').click();
  await page.locator('#users-create-modal').waitFor({ state: 'visible' });
}

async function saveEditUser(page) {
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'PATCH' && url.pathname.startsWith('/api/admin/users/') && response.ok();
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET' && url.pathname === '/api/admin/users' && url.search.length > 0 && response.ok();
    }),
    page.locator('#users-create-form').evaluate((form) => form.requestSubmit()),
  ]);
  await page.locator('#users-create-modal').waitFor({ state: 'hidden' });
}

async function setUserActive(page, active) {
  await page.locator('#users-create-active').setChecked(active);
}

async function deleteUserFromUi(page, email) {
  const row = await getUserRow(page, email);
  await row.locator('[data-user-action="delete"]').click();
  await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
  await page.locator('#confirm-modal-confirm').click();
  await row.waitFor({ state: 'detached' });
}

async function ensureUserNotVisible(page, email) {
  await searchUser(page, email);
  await expect(page.locator('#users-table-body tr', { hasText: email })).toHaveCount(0);
}

async function resolveDisposableUserId(page, email, accessToken) {
  const payload = await listUsersViaAdminApi(page, email, accessToken);
  const match = Array.isArray(payload.items)
    ? payload.items.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase())
    : null;
  return match && match.id ? String(match.id) : '';
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
  if (!token) {
    throw new Error('ADMIN session token unavailable.');
  }

  const response = await page.request.get(`/api/admin/users?search=${encodeURIComponent(searchText)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`Admin API list failed: HTTP ${response.status()}${body ? ` :: ${body.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

test.describe('ADMIN user CRUD workflow', function () {
  var disposableEmail = '';
  var disposableUserId = '';
  var UI_DELETED = false;

  // Cleanup runs after ALL tests complete, even if some failed.
  // Uses service_role REST API directly — does NOT depend on page or browser.
  // FK deletion order (confirmed from migrations):
  //   1. audit_logs (user_id FK to profiles WITHOUT cascade — must delete first)
  //   2. auth.users (GoTrue admin API — cascades to profiles, then user_stores)
  //   3. Verify: profiles gone, user_stores gone, auth 404
  test.afterAll(async function () {
    if (!disposableEmail) return;

    var failures = [];

    // Resolve user ID by email if UI flow didn't capture it
    if (!disposableUserId) {
      try {
        var idRows = await supabaseRest('/rest/v1/profiles?select=id&email=eq.' + encodeURIComponent(disposableEmail), { method: 'GET' });
        if (Array.isArray(idRows) && idRows.length > 0 && idRows[0] && idRows[0].id) {
          disposableUserId = String(idRows[0].id);
        }
      } catch (_) {
        // user already fully deleted — nothing to clean up
      }
    }

    if (!disposableUserId) return;

    // 1. Delete audit_logs first — FK to profiles(id) WITHOUT ON DELETE CASCADE
    try {
      await supabaseRest('/rest/v1/audit_logs?user_id=eq.' + encodeURIComponent(disposableUserId), { method: 'DELETE' });
    } catch (err) {
      failures.push('audit_logs DELETE failed: ' + err.message);
    }

    // 2. Delete auth user via GoTrue admin API — cascades to profiles (CASCADE), then user_stores (CASCADE)
    try {
      await supabaseRest('/auth/v1/admin/users/' + encodeURIComponent(disposableUserId), { method: 'DELETE' });
    } catch (err) {
      if (!UI_DELETED || String(err.status) !== '404') {
        failures.push('auth DELETE failed: ' + err.message + ' (status=' + err.status + ')');
      }
      // 404 is acceptable when UI already deleted the user
    }

    // 3. Verify profiles row is gone
    try {
      var profileCheck = await supabaseRest('/rest/v1/profiles?select=id&id=eq.' + encodeURIComponent(disposableUserId), { method: 'GET' });
      if (Array.isArray(profileCheck) && profileCheck.length > 0) {
        failures.push('Profile still exists: id=' + disposableUserId);
      }
    } catch (err) {
      failures.push('profile VERIFY failed: ' + err.message);
    }

    // 4. Verify user_stores rows are gone
    try {
      var storesCheck = await supabaseRest('/rest/v1/user_stores?select=user_id&user_id=eq.' + encodeURIComponent(disposableUserId), { method: 'GET' });
      if (Array.isArray(storesCheck) && storesCheck.length > 0) {
        failures.push('user_stores still exist: user_id=' + disposableUserId + ' count=' + storesCheck.length);
      }
    } catch (err) {
      failures.push('user_stores VERIFY failed: ' + err.message);
    }

    // 5. Verify auth user is gone (404 = correctly deleted)
    try {
      await supabaseRest('/auth/v1/admin/users/' + encodeURIComponent(disposableUserId), { method: 'GET' });
      // no error = still exists
      failures.push('Auth user still exists: id=' + disposableUserId);
    } catch (err) {
      if (String(err.status) !== '404') {
        failures.push('Auth VERIFY unexpected error: ' + err.message + ' (status=' + err.status + ')');
      }
    }

    if (failures.length > 0) {
      throw new Error('Cleanup integrity failure for ' + disposableEmail + ':\n' + failures.join('\n'));
    }
  });

  test('ADMIN user CRUD workflow in /usuarios', async ({ page }, testInfo) => {
    const baseUrl = getBaseUrl();
    const hostname = warnAboutTarget(baseUrl);
    assertLiveCrudEnabled();

    const credentials = getAdminCredentials();
    const disposablePassword = getDisposablePassword();
    disposableEmail = buildDisposableEmail();
    const disposableNameBase = 'E2E User';
    const updatedName = `${disposableNameBase} Updated`;
    const consoleErrors = [];
    const networkFailures = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure();
      networkFailures.push(`${request.method()} ${request.url()} :: ${failure ? failure.errorText : 'failed'}`);
    });

    try {
      await loginAsAdmin(page, credentials);
      await openUsersPage(page);

      await test.step('create disposable USER', async () => {
        await openCreateUserModal(page);
        await fillCreateUserForm(page, {
          active: true,
          email: disposableEmail,
          name: disposableNameBase,
          password: disposablePassword,
          role: 'USER',
        });
        await submitCreateUser(page);
        await expect(page.locator('#users-create-success')).toBeVisible();
        await expect(page.locator('#users-create-success-email')).toHaveText(disposableEmail);
        await page.locator('#users-create-cancel').click();
        await page.reload();
        await openUsersPage(page);
        await searchUser(page, disposableEmail);
        await expect(page.locator('#users-table-body tr', { hasText: disposableEmail })).toHaveCount(1);
        disposableUserId = await resolveDisposableUserId(page, disposableEmail);
      });

      await test.step('edit disposable user', async () => {
        await openEditUserModal(page, disposableEmail);
        await expect(page.locator('#users-create-title')).toContainText('Editar usuário');
        await page.locator('#users-create-name').fill(updatedName);
        await setUserActive(page, true);
        await saveEditUser(page);
        await page.reload();
        await openUsersPage(page);
        await searchUser(page, disposableEmail);
        await expect(page.locator('#users-table-body tr', { hasText: updatedName })).toHaveCount(1);
      });

      await test.step('deactivate disposable user', async () => {
        await openEditUserModal(page, disposableEmail);
        await page.locator('#users-create-name').fill(updatedName);
        await setUserActive(page, false);
        await saveEditUser(page);
        await page.reload();
        await openUsersPage(page);
        await searchUser(page, disposableEmail);
        const userRow = page.locator('#users-table-body tr', {
          hasText: disposableEmail,
        });
        await expect(userRow).toBeVisible();
        await expect(userRow.locator('.users-status-badge--blocked')).toHaveText('Bloqueado');
      });

      await test.step('blocked user login fails', async () => {
        await logout(page);
        await submitLogin(page, disposableEmail, disposablePassword);
        await expect(page.locator('#login-error')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#login-error')).toContainText(/inativo|bloquead|invalid login credentials|credenciais/i);
      });

      await test.step('reactivate disposable user', async () => {
        await loginAsAdmin(page, credentials);
        await openUsersPage(page);
        await openEditUserModal(page, disposableEmail);
        await page.locator('#users-create-name').fill(updatedName);
        await setUserActive(page, true);
        await saveEditUser(page);
        await page.reload();
        await openUsersPage(page);
        await searchUser(page, disposableEmail);
        await expect(page.locator('#users-table-body tr', { hasText: 'Ativo' })).toHaveCount(1);
      });

      await test.step('delete disposable user', async () => {
        await logout(page);
        await loginAsAdmin(page, credentials);
        await openUsersPage(page);
        await deleteUserFromUi(page, disposableEmail);
        UI_DELETED = true;
        await page.reload();
        await openUsersPage(page);
        await ensureUserNotVisible(page, disposableEmail);
        await expect(page.locator('#users-empty')).toBeVisible();
      });
    } catch (error) {
      const body = [];
      if (consoleErrors.length) body.push(`Console errors:\n${consoleErrors.join('\n')}`);
      if (networkFailures.length) body.push(`Network failures:\n${networkFailures.join('\n')}`);
      body.push(`Target host: ${hostname}`);
      await testInfo.attach('e2e-debug.txt', {
        body: body.join('\n\n'),
        contentType: 'text/plain',
      });
      throw error;
    }
  });
});
