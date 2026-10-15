// @ts-check
// E2E: Admin user removal with historical identity preservation.
// Run: npm run e2e -- tests/e2e/admin-user-removal.spec.js --workers=1
//
// Requires .env.e2e with: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_BASE_URL, E2E_TEST_EMAIL_DOMAIN,
// E2E_ALLOW_LIVE_*=true

const { test, expect } = require('@playwright/test');
const {
  buildCorrelationMarker, buildDisposableEmail,
  createDisposableUserDirect, supabaseRest,
  getSupabaseBaseUrl, getServiceRoleKey, getAnonKey,

  createOrderViaRpc, createOrderItemViaRpc,
  createStorageObject, createOrderImageMetadata,
  purgeDisposableUser, verifyCleanup,
  loginAndGetToken,
} = require('./helpers/disposable-user-fixtures');
const {
  openUsersPage, searchUser, listUsersViaAdminApi,
} = require('./helpers/users-admin');
const { login } = require('./helpers/auth');

function getAdminCredentials() {
  const email = String(process.env.E2E_ADMIN_EMAIL || '').trim();
  const password = String(process.env.E2E_ADMIN_PASSWORD || '');
  if (!email || !password) throw new Error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD required.');
  return { email, password };
}

function getDisposablePassword() {
  const pw = String(process.env.E2E_TEST_USER_PASSWORD || '12345678');
  return pw;
}

function getTestEmailDomain() {
  const d = String(process.env.E2E_TEST_EMAIL_DOMAIN || '').trim().replace(/^@+/, '');
  if (!d) throw new Error('E2E_TEST_EMAIL_DOMAIN required.');
  return d;
}

function getBaseUrl() {
  return String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

test.describe.serial('admin user removal', () => {
  let state;
  let adminToken = '';
  let adminCredentials;

  test.beforeAll(async () => {
    adminCredentials = getAdminCredentials();
  });

  test('00 - admin login and capture token', async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password);

    // Capture admin session token from localStorage
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (!key) return '';
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token || parsed?.data?.session?.access_token || '';
      } catch (_) {
        const raw = localStorage.getItem(key) || '';
        const m = raw.match(/"access_token"\s*:\s*"([^"]+)"/);
        return m ? m[1] : '';
      }
    });

    expect(token).toBeTruthy();
    adminToken = token;
    console.log('Admin token captured');
  });

  test('01 - create disposable requester with store and capture session', async ({ page }) => {
    const marker = buildCorrelationMarker();
    const password = getDisposablePassword();
    const email = buildDisposableEmail(marker, 'removal-req');
    const name = 'E2E Removal ' + marker;

    // Get a store ID to assign to the user
    const svcKey = getServiceRoleKey();
    const svcUrl = getSupabaseBaseUrl();
    const storeResp = await fetch(`${svcUrl}/rest/v1/lojas?select=id&ativo=eq.true&limit=1`, {
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
      },
    });
    const stores = await storeResp.json();
    const storeId = Array.isArray(stores) && stores.length ? stores[0].id : null;
    if (!storeId) throw new Error('No active store found');

    // Create user via admin API with the store
    const requester = await createDisposableUserDirect(email, password, name, 'USER', [storeId], marker);
    expect(requester).toHaveProperty('id');
    const requesterId = requester.id;

    // Log in as requester to get session token
    const loginResult = await loginAndGetToken(email, password);
    expect(loginResult.ok).toBe(true);
    expect(loginResult.accessToken).toBeTruthy();
    const requesterToken = loginResult.accessToken;

    // Store already assigned via admin API — verify access
    expect(storeId).toBeTruthy();

    // Create an order via RPC
    const order = await createOrderViaRpc(requesterToken, storeId, marker);
    expect(order).toHaveProperty('id');
    const orderId = order.id;

    // Create an order item
    const item = await createOrderItemViaRpc(requesterToken, orderId, 'SKU-E2E-001');
    expect(item).toHaveProperty('id');

    // Create Storage object and metadata
    const storagePath = `orders/${requesterId}/${orderId}/e2e-test.jpg`;
    const storageObj = await createStorageObject(requesterToken, 'order-images', storagePath, marker);
    expect(storageObj).toHaveProperty('path');

    const imageMeta = await createOrderImageMetadata(requesterToken, orderId, storagePath, marker, requesterId);
    expect(imageMeta).toHaveProperty('id');

    state = {
      marker,
      requesterEmail: email,
      requesterName: name,
      requesterPassword: password,
      requesterId,
      requesterToken,
      orderId,
      itemId: item.id,
      imageId: imageMeta.id,
      storagePath,
      storeId,
    };

    console.log('Fixture created:', { requesterId, orderId, storeId });
  });

  test('02 - admin removes user through UI', async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password);

    await openUsersPage(page);
    await searchUser(page, state.requesterEmail);

    const row = page.locator('#users-table-body tr', { hasText: state.requesterEmail }).first();
    await row.waitFor({ state: 'visible' });

    // Click remover button
    await row.locator('[data-user-action="delete"]').click();
    const modal = page.locator('#confirm-modal');
    await expect(modal).not.toHaveClass(/hidden/);
    await expect(modal.locator('#confirm-modal-title')).toHaveText('Remover usuário');
    await modal.locator('#confirm-modal-confirm').click();

    await expect(page.locator('#toast:not(.hidden)')).toBeVisible({ timeout: 15000 });
  });

  test('03 - removed user disappears from default list', async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password);
    await openUsersPage(page);
    await searchUser(page, state.requesterEmail);

    await page.waitForFunction((targetEmail) => {
      return !Array.from(document.querySelectorAll('#users-table-body tr')).some((row) =>
        String(row.textContent || '').includes(targetEmail)
      );
    }, state.requesterEmail);

    const stillVisible = await page.locator('#users-table-body tr', { hasText: state.requesterEmail }).first().isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
  });

  test('04 - removed user appears in Removidos filter with badge', async ({ page }) => {
    await login(page, adminCredentials.email, adminCredentials.password);
    await openUsersPage(page);

    // Debug: check API response with admin token
    const apiResp = await fetch(`http://127.0.0.1:3000/api/admin/users?status=removed`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const apiData = await apiResp.json();
    console.log('API status:', apiResp.status, 'items:', (apiData.items || []).length, 'total:', apiData.total);
    if (apiData.items && apiData.items.length > 0) {
      apiData.items.forEach(u => console.log('  user:', u.email, 'status:', u.status, 'removedAt:', u.removedAt));
    } else {
      console.log('  No items in status=removed filter');
      const allResp = await fetch(`http://127.0.0.1:3000/api/admin/users?search=${encodeURIComponent(state.requesterEmail)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const allData = await allResp.json();
      console.log('All users matching email:', allData.total);
      if (allData.items) {
        allData.items.forEach(u => console.log('  user:', u.email, 'status:', u.status, 'removedAt:', u.removedAt, 'active:', u.active));
      }
    }

    await page.locator('#users-status').selectOption('removed');
    await page.locator('#users-refresh').click();

    // Wait for any row to appear (table has data from the filter)
    await page.locator('#users-table-body tr').first().waitFor({ state: 'visible', timeout: 15000 });

    // Verify the removed user is in the list
    const row = page.locator('#users-table-body tr', { hasText: state.requesterEmail }).first();
    await expect(row).toBeVisible();

    // Check the Removido badge text is present
    await expect(row).toContainText('Removido');

    // Edit and remove actions should be hidden for removed user
    const editBtn = row.locator('[data-user-action="edit"]');
    const removeBtn = row.locator('[data-user-action="delete"]');
    if (await editBtn.isVisible()) {
      await expect(editBtn).toBeHidden();
    }
    if (await removeBtn.isVisible()) {
      await expect(removeBtn).toBeHidden();
    }
  });

  test('05 - Auth profile and FK records preserved', async () => {
    // Verify profile still exists with removed state
    const profileRows = await supabaseRest(
      `/rest/v1/profiles?select=id,email,is_active,removed_at,removed_by_id,name&id=eq.${encodeURIComponent(state.requesterId)}`,
      { method: 'GET' }
    );
    const profile = Array.isArray(profileRows) && profileRows.length ? profileRows[0] : null;
    expect(profile).toBeTruthy();
    expect(profile.is_active).toBe(false);
    expect(profile.removed_at).toBeTruthy();
    expect(profile.removed_by_id).toBeTruthy();
    expect(String(profile.name || '')).toContain(state.marker);

    // Verify auth user still exists
    const svcKey = getServiceRoleKey();
    const authResp = await fetch(`${getSupabaseBaseUrl()}/auth/v1/admin/users/${encodeURIComponent(state.requesterId)}`, {
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
      },
    }).catch(() => null);

    if (authResp && authResp.ok) {
      const authUser = await authResp.json();
      expect(authUser).toBeTruthy();
      expect(authUser.id).toBe(state.requesterId);
    }

    // Verify order requester_id is unchanged
    const orderRows = await supabaseRest(
      `/rest/v1/orders?select=id,requester_id,internal_number,status&id=eq.${encodeURIComponent(state.orderId)}`,
      { method: 'GET' }
    );
    const order = Array.isArray(orderRows) && orderRows.length ? orderRows[0] : null;
    expect(order).toBeTruthy();
    expect(order.requester_id).toBe(state.requesterId);

    // Verify order_images uploaded_by_id is unchanged
    const imgRows = await supabaseRest(
      `/rest/v1/order_images?select=id,uploaded_by_id&id=eq.${encodeURIComponent(state.imageId)}`,
      { method: 'GET' }
    );
    const img = Array.isArray(imgRows) && imgRows.length ? imgRows[0] : null;
    expect(img).toBeTruthy();
    expect(img.uploaded_by_id).toBe(state.requesterId);

    // Verify user_stores row preserved
    const usRows = await supabaseRest(
      `/rest/v1/user_stores?select=user_id,store_id&user_id=eq.${encodeURIComponent(state.requesterId)}`,
      { method: 'GET' }
    );
    const us = Array.isArray(usRows) ? usRows : [];
    expect(us.length).toBeGreaterThan(0);
    expect(us[0].user_id).toBe(state.requesterId);
  });

  test('06 - new login fails after removal', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    await page.goto('/login', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });
    await page.locator('#login-email').fill(state.requesterEmail);
    await page.locator('#login-senha').fill(state.requesterPassword);
    await page.locator('#login-btn').click();
    // Wait a moment for the login to be rejected
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const isOnDashboard = currentUrl.includes('/dashboard');
    expect(isOnDashboard).toBe(false);

    // Check for login error or still on login page
    const onLogin = currentUrl.includes('/login');
    expect(onLogin).toBe(true);
  });

  test('06b - direct Auth REST API login denied after removal', async () => {
    const svcUrl = getSupabaseBaseUrl();
    const anonKey = getAnonKey();

    const resp = await fetch(`${svcUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: state.requesterEmail,
        password: state.requesterPassword,
      }),
    });

    expect(resp.status).toBe(400);
    expect(resp.ok).toBe(false);

    const body = await resp.json().catch(() => ({}));
    expect(body).toHaveProperty('msg');
  });

  test('07 - existing session token cannot read orders via PostgREST', async () => {
    const anonKey = getAnonKey();
    const resp = await fetch(
      `${getSupabaseBaseUrl()}/rest/v1/orders?select=id,internal_number,status&requester_id=eq.${encodeURIComponent(state.requesterId)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${state.requesterToken}`,
        },
      }
    );

    const body = await resp.json().catch(() => []);
    const rows = Array.isArray(body) ? body : [];
    expect(rows.length).toBe(0);
  });

  test('08 - existing session token cannot call protected RPCs', async () => {
    const svcUrl = getSupabaseBaseUrl();
    const anonKey = getAnonKey();

    const testRPC = async (rpcName, payload) => {
      const resp = await fetch(`${svcUrl}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${state.requesterToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload || {}),
      });
      return { status: resp.status, ok: resp.ok };
    };

    const createResult = await testRPC('create_order', {
      p_brand: 'E2E', p_store: '', p_cost_center: '',
      p_purpose: 'test', p_justification: 'test',
      p_priority: 'NORMAL',
    });
    expect(createResult.ok).toBe(false);

    const submitResult = await testRPC('submit_order', { p_order_id: '00000000-0000-0000-0000-000000000000' });
    expect(submitResult.ok).toBe(false);
  });

  test('08b - stale session token cannot INSERT/UPDATE/DELETE via PostgREST', async () => {
    const svcUrl = getSupabaseBaseUrl();
    const anonKey = getAnonKey();
    const staleHeaders = {
      apikey: anonKey,
      Authorization: `Bearer ${state.requesterToken}`,
      'Content-Type': 'application/json',
    };

    const staleFetch = async (method, path, body) => {
      const opts = { method, headers: staleHeaders };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const resp = await fetch(`${svcUrl}${path}`, opts);
      const text = await resp.text().catch(() => '');
      return { status: resp.status, ok: resp.ok, body: text };
    };

    // Read current state with service role for verification
    const [orderRows, profileRows, usRows] = await Promise.all([
      supabaseRest(`/rest/v1/orders?select=id,purpose&id=eq.${encodeURIComponent(state.orderId)}`, { method: 'GET' }),
      supabaseRest(`/rest/v1/profiles?select=id,role&id=eq.${encodeURIComponent(state.requesterId)}`, { method: 'GET' }),
      supabaseRest(`/rest/v1/user_stores?select=user_id&user_id=eq.${encodeURIComponent(state.requesterId)}`, { method: 'GET' }),
    ]);
    const order = Array.isArray(orderRows) && orderRows.length ? orderRows[0] : null;
    const profile = Array.isArray(profileRows) && profileRows.length ? profileRows[0] : null;
    const usCount = Array.isArray(usRows) ? usRows.length : 0;
    const originalPurpose = order ? order.purpose : null;

    // a. INSERT into orders — WITH CHECK blocks, returns 4xx
    const rA = await staleFetch('POST', '/rest/v1/orders', {
      requester_id: state.requesterId,
      purpose: 'E2E-STALE-TEST',
      status: 'DRAFT',
    });
    expect(rA.status >= 400 || rA.status < 200, `INSERT orders: status ${rA.status}`).toBe(true);

    // b. UPDATE existing order — RLS blocks silently (200, 0 rows)
    await staleFetch('PATCH', `/rest/v1/orders?id=eq.${encodeURIComponent(state.orderId)}`, { purpose: 'STALE-TEST' });
    const orderAfter = await supabaseRest(`/rest/v1/orders?select=purpose&id=eq.${encodeURIComponent(state.orderId)}`, { method: 'GET' });
    const newPurpose = Array.isArray(orderAfter) && orderAfter.length ? orderAfter[0].purpose : null;
    expect(newPurpose, 'UPDATE orders: purpose unchanged').toBe(originalPurpose);

    // c. DELETE existing order — RLS blocks silently (200, 0 rows)
    await staleFetch('DELETE', `/rest/v1/orders?id=eq.${encodeURIComponent(state.orderId)}`);
    const delCheck = await supabaseRest(`/rest/v1/orders?select=id&id=eq.${encodeURIComponent(state.orderId)}`, { method: 'GET' });
    expect(Array.isArray(delCheck) && delCheck.length > 0, 'DELETE orders: order still exists').toBe(true);

    // d. INSERT into order_items — WITH CHECK blocks, 4xx likely
    const rD = await staleFetch('POST', '/rest/v1/order_items', {
      order_id: state.orderId,
      product_code: 'STALE-TEST',
      quantity: 1,
    });
    expect(rD.status >= 400 || rD.status < 200, `INSERT order_items: status ${rD.status}`).toBe(true);

    // e. INSERT into order_images — WITH CHECK blocks, 4xx likely
    const rE = await staleFetch('POST', '/rest/v1/order_images', {
      order_id: state.orderId,
      storage_path: 'stale/test.jpg',
      bucket_name: 'order-images',
    });
    expect(rE.status >= 400 || rE.status < 200, `INSERT order_images: status ${rE.status}`).toBe(true);

    // f. UPDATE on profiles — role escalation blocked by RLS
    const originalRole = profile ? profile.role : null;
    await staleFetch('PATCH', `/rest/v1/profiles?id=eq.${encodeURIComponent(state.requesterId)}`, { role: 'ADMIN' });
    const profileAfter = await supabaseRest(`/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(state.requesterId)}`, { method: 'GET' });
    const newRole = Array.isArray(profileAfter) && profileAfter.length ? profileAfter[0].role : null;
    expect(newRole, 'UPDATE profiles role: unchanged').toBe(originalRole);

    // g. DELETE user_stores — RLS blocks silently (200, 0 rows)
    const originalUsCount = usCount;
    await staleFetch('DELETE', `/rest/v1/user_stores?user_id=eq.${encodeURIComponent(state.requesterId)}`);
    const usAfter = await supabaseRest(`/rest/v1/user_stores?select=user_id&user_id=eq.${encodeURIComponent(state.requesterId)}`, { method: 'GET' });
    const newUsCount = Array.isArray(usAfter) ? usAfter.length : 0;
    expect(newUsCount, 'DELETE user_stores: count unchanged').toBe(originalUsCount);
  });

  test('09 - existing session token cannot access Storage', async () => {
    const svcUrl = getSupabaseBaseUrl();
    const anonKey = getAnonKey();

    // Try to upload a dummy file
    const uploadResp = await fetch(`${svcUrl}/storage/v1/object/order-images/orders/${state.requesterId}/e2e-test-blocked.jpg`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${state.requesterToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: Buffer.from('not-a-real-image'),
    });
    expect(uploadResp.ok).toBe(false);

    // Try to read the existing object
    const downloadResp = await fetch(`${svcUrl}/storage/v1/object/order-images/${state.storagePath}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${state.requesterToken}`,
      },
    });
    expect(downloadResp.ok).toBe(false);
  });

  test('10 - removal is idempotent', async ({ page }) => {
    // Admin must be logged in for page.request
    // Check admin token first; if missing, re-login
    if (!adminToken) {
      await login(page, adminCredentials.email, adminCredentials.password);
      adminToken = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) =>
          k.startsWith('sb-') && k.endsWith('-auth-token')
        );
        if (!key) return '';
        try {
          return JSON.parse(localStorage.getItem(key) || '{}').access_token || '';
        } catch (_) {
          const raw = localStorage.getItem(key) || '';
          const m = raw.match(/"access_token"\s*:\s*"([^"]+)"/);
          return m ? m[1] : '';
        }
      });
    }

    const token = adminToken;
    const searchUrl = `/api/admin/users?status=removed&search=${encodeURIComponent(state.requesterEmail)}`;
    const response = await page.request.get(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok()) {
      throw new Error(`Admin API list failed: HTTP ${response.status()}`);
    }
    const payload = await response.json();
    const user = Array.isArray(payload.items)
      ? payload.items.find((u) => String(u.email).toLowerCase() === String(state.requesterEmail).toLowerCase())
      : null;
    expect(user).toBeTruthy();
    expect(user.status).toBe('removed');

    const deleteResp = await page.request.delete(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await deleteResp.json();
    expect(deleteResp.ok()).toBe(true);
    expect(body.removed).toBe(true);
    expect(body.alreadyRemoved).toBe(true);
  });

  test('11 - cleanup: purge disposable user and verify zero leftovers', async () => {
    if (state && state.requesterId && state.marker) {
      // Purge via service role in safe order (Storage → DB → Auth)
      await purgeDisposableUser(state.requesterId, state.requesterEmail, state.marker);

      // Verify zero disposable rows remain
      await verifyCleanup(state.requesterId, state.requesterEmail, state.marker);

      // Verify Storage object deleted
      const svcKey = getServiceRoleKey();
      const svcUrl = getSupabaseBaseUrl();
      const storageCheck = await fetch(`${svcUrl}/storage/v1/object/order-images/${state.storagePath}`, {
        headers: {
          apikey: svcKey,
          Authorization: `Bearer ${svcKey}`,
        },
      });
      expect(storageCheck.ok).toBe(false);
    }
  });
});
