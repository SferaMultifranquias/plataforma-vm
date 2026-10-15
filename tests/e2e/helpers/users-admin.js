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
    if (Array.isArray(payload.storeIndexes)) {
      await setCreateUserStores(page, payload.storeIndexes);
    } else {
      const storeCheckbox = page.locator('#users-create-store-list input[type="checkbox"]').first();
      await storeCheckbox.waitFor({ state: 'visible' });
      await storeCheckbox.check();
    }
  }
}

async function setCreateUserStores(page, storeIndexes) {
  const items = page.locator('#users-create-store-list .users-create-store-item');

  for (const index of Array.isArray(storeIndexes) ? storeIndexes : []) {
    const item = items.nth(index);
    await item.locator('input[type="checkbox"]').waitFor({ state: 'visible' });
    await item.locator('input[type="checkbox"]').check();
  }
}

async function getCreateUserStoreNames(page) {
  const names = await page.locator('#users-create-store-list .users-create-store-item span').allTextContents();
  return names.map((name) => String(name || '').trim()).filter(Boolean);
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
  await page.locator('#users-refresh').click();
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
  await page.locator('#users-create-title').waitFor({ state: 'visible' });
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

async function deleteUserFromUi(page, email) {
  const row = await getUserRow(page, email);
  await row.locator('[data-user-action="delete"]').click();
  await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
  await page.locator('#confirm-modal-confirm').click();
  await row.waitFor({ state: 'detached' });
}

async function setUserActive(page, active) {
  await page.locator('#users-create-active').setChecked(active);
}

async function ensureUserNotVisible(page, email) {
  await page.locator('#users-search').fill(email);
  await page.waitForFunction((targetEmail) => {
    return !Array.from(document.querySelectorAll('#users-table-body tr')).some((row) =>
      String(row.textContent || '').includes(targetEmail)
    );
  }, email);
  const stillVisible = await page.locator('#users-table-body tr', { hasText: email }).first().isVisible().catch(() => false);
  if (stillVisible) {
    throw new Error(`User still visible: ${email}`);
  }
}

async function readAdminAccessToken(page) {
  const baseOrigin = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').origin;

  function extractToken(value) {
    if (!value) return '';
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return String(
          parsed.access_token ||
          parsed?.currentSession?.access_token ||
          parsed?.session?.access_token ||
          parsed?.data?.session?.access_token ||
          ''
        );
      }
    } catch (_) {
      // ignore
    }

    const match = String(value).match(/"access_token"\s*:\s*"([^"]+)"/);
    return match ? match[1] : '';
  }

  const state = await page.context().storageState().catch(() => null);
  const originState = state && Array.isArray(state.origins)
    ? state.origins.find((item) => item.origin === baseOrigin)
    : null;

  if (originState && Array.isArray(originState.localStorage)) {
    for (const entry of originState.localStorage) {
      const token = extractToken(entry && entry.value);
      if (token) return token;
    }
  }

  return page.evaluate(async () => {
    const client = typeof sb !== 'undefined' ? sb : null;
    if (!client || !client.auth || typeof client.auth.getSession !== 'function') {
      throw new Error('Supabase client unavailable in browser session.');
    }

    const result = await client.auth.getSession();
    return result?.data?.session?.access_token || '';
  });
}

async function deleteUserViaAdminApi(page, userId, accessToken) {
  const token = accessToken || await readAdminAccessToken(page);
  if (!token) {
    throw new Error('ADMIN session token unavailable.');
  }

  const response = await page.request.delete(`/api/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`Admin API delete failed: HTTP ${response.status()}${body ? ` :: ${body.slice(0, 200)}` : ''}`);
  }

  return {
    status: response.status(),
  };
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

async function resolveUserIdByEmail(page, email, accessToken) {
  const payload = await listUsersViaAdminApi(page, email, accessToken);
  const match = Array.isArray(payload.items)
    ? payload.items.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase())
    : null;
  return match && match.id ? String(match.id) : '';
}

module.exports = {
  deleteUserFromUi,
  deleteUserViaAdminApi,
  ensureUserNotVisible,
  getCreateUserStoreNames,
  fillCreateUserForm,
  getUserRow,
  listUsersViaAdminApi,
  openCreateUserModal,
  openEditUserModal,
  openUsersPage,
  readAdminAccessToken,
  resolveUserIdByEmail,
  saveEditUser,
  searchUser,
  setCreateUserStores,
  setUserActive,
  submitCreateUser,
};
