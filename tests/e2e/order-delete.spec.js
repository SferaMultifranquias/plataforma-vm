const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

const {
  loginAsAdmin,
  loginWithCleanSession,
  logout,
} = require('./helpers/auth');
const {
  assertLiveCrudEnabled,
  buildDisposableEmail,
  getAdminCredentials,
  getDisposablePassword,
  warnAboutTarget,
} = require('./helpers/runtime');
const {
  createDisposableUser,
  deleteOrderArtifactsByOrderId,
  fetchActiveStores,
  supabaseRest,
  updateDisposableUser,
} = require('./helpers/disposable-user-fixtures');
const {
  deleteUserViaAdminApi,
  listUsersViaAdminApi,
  readAdminAccessToken,
} = require('./helpers/users-admin');

function buildMarker() {
  return `odel-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

async function openOrdersPage(page) {
  await page.goto('/pedidos', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#orders-page-shell')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#orders-results')).toBeVisible({ timeout: 30000 });
}

async function openOrderDrawerByNumber(page, internalNumber) {
  await page.locator('#orders-search').fill(String(internalNumber));
  await expect(
    page.locator('#orders-table-body tr', { hasText: String(internalNumber) }).first()
  ).toBeVisible({ timeout: 30000 });

  const row = page.locator('#orders-table-body tr', { hasText: String(internalNumber) }).first();
  await row.locator('button[aria-label="Visualizar pedido"]').click();
  await expect(page.locator('#drawer-overlay')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#drawer')).toBeVisible({ timeout: 30000 });
}

async function createDraftOrderForStore(page, storeId, storeName, marker) {
  return page.evaluate(async ({ storeId, storeName, marker }) => {
    const result = await sb.rpc('create_order', {
      p_brand: 'O Boticario',
      p_store: storeName,
      p_cost_center: '',
      p_purpose: marker,
      p_justification: '',
      p_priority: 'NORMAL',
      p_notes: marker,
      p_store_id: Number(storeId),
    });
    if (result.error) throw new Error(result.error.message);
    if (!result.data || !result.data.id) throw new Error('create_order returned no id');
    return { id: String(result.data.id), internalNumber: String(result.data.internal_number || result.data.id) };
  }, { storeId, storeName, marker });
}

async function loadAuditLog(orderId, action) {
  const audit = await supabaseRest(
    `/rest/v1/audit_logs?select=id,action,entity_id,previous_data,created_at&entity=eq.orders&entity_id=eq.${orderId}`,
    { method: 'GET' }
  );
  return Array.isArray(audit) ? audit : [];
}

async function findOrderArtifacts(orderId) {
  const [items, images, history] = await Promise.all([
    supabaseRest(`/rest/v1/order_items?select=id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/order_images?select=id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/status_history?select=id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
  ]);
  return {
    items: Array.isArray(items) ? items : [],
    images: Array.isArray(images) ? images : [],
    history: Array.isArray(history) ? history : [],
  };
}

async function verifyOrderExists(orderId) {
  const check = await supabaseRest(
    `/rest/v1/orders?select=id,status&id=eq.${orderId}`,
    { method: 'GET' }
  );
  return Array.isArray(check) && check.length > 0;
}

if (process.env.E2E_ALLOW_LIVE_READS === 'true'
  && process.env.E2E_ALLOW_LIVE_WRITES === 'true'
  && process.env.E2E_ALLOW_LIVE_CRUD === 'true') {

  test.describe.serial('order admin delete', () => {
    const state = {
      marker: buildMarker(),
      admin: null,
      store: null,
      draftOrder: null,
      user: null,
      pendingOrder: null,
      leftoverOrders: [],
    };

    test.beforeAll(async ({ browser }) => {
      const baseUrl = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000');
      warnAboutTarget(baseUrl);
      assertLiveCrudEnabled();

      const admin = getAdminCredentials();
      state.admin = admin;

      const context = await browser.newContext({ baseURL: baseUrl });
      const page = await context.newPage();
      try {
        await loginAsAdmin(page, admin, { timeout: 20000 });

        const stores = await fetchActiveStores();
        const firstStore = stores[0];
        if (!firstStore) throw new Error('No active store available.');
        state.store = firstStore;

        const email = buildDisposableEmail(state.marker, 'user');
        const password = getDisposablePassword();
        const adminToken = await readAdminAccessToken(page);
        const created = await createDisposableUser(page, adminToken, {
          email,
          isActive: true,
          name: `ODEL ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [firstStore.id],
        });

        await updateDisposableUser(page, adminToken, created.id, {
          email,
          isActive: true,
          name: `ODEL ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [firstStore.id],
        });

        state.user = { email, id: String(created.id), password };
      } finally {
        await context.close().catch(() => {});
      }
    });

    test.afterAll(async ({ browser }) => {
      const baseUrl = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000');
      const context = await browser.newContext({ baseURL: baseUrl });
      const page = await context.newPage();
      try {
        if (state.admin) {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          const token = await readAdminAccessToken(page);

          for (const orderId of state.leftoverOrders) {
            const remaining = await verifyOrderExists(orderId);
            if (remaining) {
              await supabaseRest(
                `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${orderId}`,
                { method: 'DELETE' }
              ).catch(() => {});
              await deleteOrderArtifactsByOrderId(orderId).catch(() => {});
            }
          }

          if (state.user?.id) {
            await deleteUserViaAdminApi(page, state.user.id, token);
            const userCheck = await listUsersViaAdminApi(page, state.user.email, token).catch(() => ({}));
            const items = Array.isArray(userCheck.items) ? userCheck.items : [];
            if (items.some((u) => String(u.email || '').toLowerCase() === state.user.email.toLowerCase())) {
              console.warn(`User ${state.user.email} still exists after cleanup`);
            }
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
    });

    test('ADMIN deletes DRAFT order through drawer UI with correct password', async ({ page }, testInfo) => {
      const consoleErrors = [];
      const networkFailures = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(String(message.text() || '').slice(0, 500));
        }
      });

      page.on('requestfailed', (request) => {
        const failure = request.failure();
        networkFailures.push(
          `${request.method()} ${request.url()} :: ${failure ? String(failure.errorText || '') : 'failed'}`.slice(0, 500)
        );
      });

      try {
        let createdOrder;

        await test.step('ADMIN creates DRAFT order via RPC', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, state.marker);
          state.draftOrder = createdOrder;

          const verify = await supabaseRest(
            `/rest/v1/orders?select=id,status&id=eq.${createdOrder.id}`,
            { method: 'GET' }
          );
          const order = Array.isArray(verify) && verify.length ? verify[0] : null;
          expect(order).toBeTruthy();
          expect(String(order.status)).toBe('DRAFT');
        });

        await test.step('Drawer shows delete button for DRAFT order', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          const deleteBlock = page.locator('#drawer-delete-block');
          await expect(deleteBlock).toBeVisible({ timeout: 10000 });
          await expect(deleteBlock.locator('button', { hasText: 'Excluir Pedido' })).toBeVisible();
        });

        await test.step('ADMIN enters password and confirms deletion', async () => {
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();

          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await expect(page.locator('#confirm-modal-password-block')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await expect(page.locator('#confirm-modal-password-input')).toBeVisible();

          await page.locator('#confirm-modal-password-input').fill(state.admin.password);
          await page.locator('#confirm-modal-confirm').click();

          await expect(page.locator('#toast-msg')).toHaveText(
            'Pedido excluído com sucesso. A exclusão foi registrada no histórico de auditoria.',
            { timeout: 10000 }
          );
          await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 5000 });
        });

        await test.step('Verify backend cleanup', async () => {
          const orderCheck = await supabaseRest(
            `/rest/v1/orders?select=id&id=eq.${createdOrder.id}`,
            { method: 'GET' }
          );
          expect(Array.isArray(orderCheck) && orderCheck.length).toBe(0);

          const artifacts = await findOrderArtifacts(createdOrder.id);
          expect(artifacts.items).toHaveLength(0);
          expect(artifacts.images).toHaveLength(0);
          expect(artifacts.history).toHaveLength(0);
        });

        await test.step('Verify audit_log entry for deletion', async () => {
          const audit = await loadAuditLog(createdOrder.id, 'ORDER_DELETED');
          expect(audit.length).toBeGreaterThanOrEqual(1);

          const deleteEntry = audit.find((a) => String(a.action || '') === 'ORDER_DELETED');
          expect(deleteEntry).toBeTruthy();
          if (deleteEntry.previous_data) {
            const data = typeof deleteEntry.previous_data === 'string'
              ? JSON.parse(deleteEntry.previous_data)
              : deleteEntry.previous_data;
            expect(data).toHaveProperty('internal_number');
            expect(data).toHaveProperty('status', 'DRAFT');
            expect(data).toHaveProperty('deleted_by');
            expect(data).toHaveProperty('deleted_at');
          }
        });

        state.draftOrder = null;
      } catch (error) {
        const body = [];
        if (consoleErrors.length) body.push(`Console errors:\n${consoleErrors.join('\n')}`);
        if (networkFailures.length) body.push(`Network failures:\n${networkFailures.join('\n')}`);
        await testInfo.attach('e2e-debug.txt', {
          body: body.join('\n\n'),
          contentType: 'text/plain',
        });
        throw error;
      }
    });

    test('ADMIN deletes non-DRAFT (PENDING_APPROVAL) order with correct password', async ({ page }, testInfo) => {
      const consoleErrors = [];
      const networkFailures = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(String(message.text() || '').slice(0, 500));
        }
      });

      page.on('requestfailed', (request) => {
        const failure = request.failure();
        networkFailures.push(
          `${request.method()} ${request.url()} :: ${failure ? String(failure.errorText || '') : 'failed'}`.slice(0, 500)
        );
      });

      let createdOrder;

      try {
        await test.step('ADMIN creates DRAFT order and submits to PENDING_APPROVAL', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, `${state.marker}-submit`);
          state.pendingOrder = createdOrder;
          state.leftoverOrders.push(createdOrder.id);

          const submitResult = await page.evaluate(async (orderId) => {
            const r = await sb.rpc('submit_order', { p_order_id: orderId });
            if (r.error) return { error: r.error.message };
            return { ok: true };
          }, createdOrder.id);

          expect(submitResult.ok).toBe(true);

          const verify = await supabaseRest(
            `/rest/v1/orders?select=id,status&id=eq.${createdOrder.id}`,
            { method: 'GET' }
          );
          const order = Array.isArray(verify) && verify.length ? verify[0] : null;
          expect(String(order.status)).toBe('PENDING_APPROVAL');
        });

        await test.step('Delete button visible for PENDING_APPROVAL', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          const deleteBlock = page.locator('#drawer-delete-block');
          await expect(deleteBlock).toBeVisible({ timeout: 10000 });
          await expect(deleteBlock.locator('button', { hasText: 'Excluir Pedido' })).toBeVisible();
        });

        await test.step('ADMIN enters correct password and deletes PENDING_APPROVAL order', async () => {
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();

          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-password-input').fill(state.admin.password);
          await page.locator('#confirm-modal-confirm').click();

          await expect(page.locator('#toast-msg')).toHaveText(
            'Pedido excluído com sucesso. A exclusão foi registrada no histórico de auditoria.',
            { timeout: 10000 }
          );
        });

        await test.step('Verify backend cleanup and audit with previous status', async () => {
          const orderCheck = await supabaseRest(
            `/rest/v1/orders?select=id&id=eq.${createdOrder.id}`,
            { method: 'GET' }
          );
          expect(Array.isArray(orderCheck) && orderCheck.length).toBe(0);

          const artifacts = await findOrderArtifacts(createdOrder.id);
          expect(artifacts.items).toHaveLength(0);
          expect(artifacts.images).toHaveLength(0);
          expect(artifacts.history).toHaveLength(0);

          const audit = await loadAuditLog(createdOrder.id, 'ORDER_DELETED');
          const deleteEntry = audit.find((a) => String(a.action || '') === 'ORDER_DELETED');
          expect(deleteEntry).toBeTruthy();
          if (deleteEntry.previous_data) {
            const data = typeof deleteEntry.previous_data === 'string'
              ? JSON.parse(deleteEntry.previous_data)
              : deleteEntry.previous_data;
            expect(data).toHaveProperty('status', 'PENDING_APPROVAL');
          }
        });

        state.pendingOrder = null;
        state.leftoverOrders = state.leftoverOrders.filter((id) => id !== createdOrder.id);
      } catch (error) {
        const body = [];
        if (consoleErrors.length) body.push(`Console errors:\n${consoleErrors.join('\n')}`);
        if (networkFailures.length) body.push(`Network failures:\n${networkFailures.join('\n')}`);
        await testInfo.attach('e2e-debug.txt', {
          body: body.join('\n\n'),
          contentType: 'text/plain',
        });
        throw error;
      }
    });

    test('USER cannot delete order through UI', async ({ page }) => {
      let createdOrder;

      try {
        await test.step('ADMIN creates DRAFT order', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, `${state.marker}-user`);
          state.leftoverOrders.push(createdOrder.id);
        });

        await test.step('USER views order — no delete button', async () => {
          await logout(page);
          await page.evaluate(function () { localStorage.clear(); }).catch(function () {});
          await page.context().clearCookies();

          await page.goto('/login', { waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });
          await page.locator('#login-email').fill(state.user.email);
          await page.locator('#login-senha').fill(state.user.password);
          await page.locator('#login-btn').click();
          await page.waitForURL(/\/(dashboard|pedidos)(\?.*)?$/, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          const deleteBlock = page.locator('#drawer-delete-block');
          await expect(deleteBlock).toBeHidden({ timeout: 10000 });
        });

        await test.step('USER direct DELETE endpoint is rejected', async () => {
          const adminToken = await page.evaluate(async function () {
            const session = await sb.auth.getSession();
            return session && session.data && session.data.session ? session.data.session.access_token : '';
          });
          const response = await page.evaluate(async function (token) {
            const r = await fetch('/api/admin/orders/some-id', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
              },
              body: JSON.stringify({ password: 'irrelevant' }),
            });
            return { status: r.status };
          }, adminToken);
          expect(response.status).toBe(403);
        });
      } finally {
        if (createdOrder?.id) {
          await supabaseRest(
            `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${createdOrder.id}`,
            { method: 'DELETE' }
          ).catch(() => {});
          await deleteOrderArtifactsByOrderId(createdOrder.id).catch(() => {});
          state.leftoverOrders = state.leftoverOrders.filter((id) => id !== createdOrder.id);
        }
      }
    });

    test('Wrong password leaves database and storage untouched', async ({ page }) => {
      let createdOrder;

      try {
        await test.step('ADMIN creates DRAFT order', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, `${state.marker}-wrongpw`);
          state.leftoverOrders.push(createdOrder.id);
        });

        await test.step('Drawer shows delete button', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          await expect(page.locator('#drawer-delete-block')).toBeVisible({ timeout: 10000 });
        });

        await test.step('Wrong password shows error and does not delete', async () => {
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-password-input').fill('wrong-password-for-test');
          await page.locator('#confirm-modal-confirm').click();

          await expect(page.locator('#toast-msg')).toHaveText(
            'Senha incorreta. O pedido não foi excluído.',
            { timeout: 10000 }
          );
        });

        await test.step('Order still exists in database', async () => {
          const exists = await verifyOrderExists(createdOrder.id);
          expect(exists).toBe(true);
        });

        await test.step('Password input cleared after error', async () => {
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          const inputValue = await page.locator('#confirm-modal-password-input').inputValue();
          expect(inputValue).toBe('');
          await page.locator('#confirm-modal-cancel').click();
        });
      } finally {
        if (createdOrder?.id) {
          const exists = await verifyOrderExists(createdOrder.id);
          if (exists) {
            await supabaseRest(
              `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${createdOrder.id}`,
              { method: 'DELETE' }
            ).catch(() => {});
            await deleteOrderArtifactsByOrderId(createdOrder.id).catch(() => {});
            state.leftoverOrders = state.leftoverOrders.filter((id) => id !== createdOrder.id);
          }
        }
      }
    });

    test('Cancel leaves order untouched', async ({ page }) => {
      let createdOrder;

      try {
        await test.step('ADMIN creates DRAFT order', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, `${state.marker}-cancel`);
          state.leftoverOrders.push(createdOrder.id);
        });

        await test.step('Open drawer and cancel delete modal', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-cancel').click();
          await expect(page.locator('#confirm-modal')).toHaveClass(/hidden/, { timeout: 5000 });
        });

        await test.step('Order still exists', async () => {
          const exists = await verifyOrderExists(createdOrder.id);
          expect(exists).toBe(true);
        });

        await test.step('Drawer still open, delete button still visible', async () => {
          await expect(page.locator('#drawer')).toBeVisible({ timeout: 5000 });
          await expect(page.locator('#drawer-delete-block')).toBeVisible({ timeout: 5000 });
        });
      } finally {
        if (createdOrder?.id) {
          const exists = await verifyOrderExists(createdOrder.id);
          if (exists) {
            await supabaseRest(
              `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${createdOrder.id}`,
              { method: 'DELETE' }
            ).catch(() => {});
            await deleteOrderArtifactsByOrderId(createdOrder.id).catch(() => {});
            state.leftoverOrders = state.leftoverOrders.filter((id) => id !== createdOrder.id);
          }
        }
      }
    });

    test('Duplicate confirm sends one deletion request', async ({ page }) => {
      let createdOrder;

      try {
        await test.step('ADMIN creates DRAFT order', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          createdOrder = await createDraftOrderForStore(page, state.store.id, state.store.name, `${state.marker}-dup`);
        });

        await test.step('Open drawer and click confirm rapidly twice', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, createdOrder.internalNumber);
          await page.locator('#drawer-delete-block button', { hasText: 'Excluir Pedido' }).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-password-input').fill(state.admin.password);

          await page.locator('#confirm-modal-confirm').click();
          await page.locator('#confirm-modal-confirm').click({ force: true }).catch(() => {});

          await expect(page.locator('#toast-msg')).toHaveText(
            'Pedido excluído com sucesso. A exclusão foi registrada no histórico de auditoria.',
            { timeout: 10000 }
          );
        });

        await test.step('Order was deleted exactly once', async () => {
          const check = await supabaseRest(
            `/rest/v1/orders?select=id&id=eq.${createdOrder.id}`,
            { method: 'GET' }
          );
          expect(Array.isArray(check) && check.length).toBe(0);
        });
      } finally {
        if (createdOrder?.id) {
          const exists = await verifyOrderExists(createdOrder.id);
          if (exists) {
            await supabaseRest(
              `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${createdOrder.id}`,
              { method: 'DELETE' }
            ).catch(() => {});
            await deleteOrderArtifactsByOrderId(createdOrder.id).catch(() => {});
          }
        }
      }
    });
  });
}
