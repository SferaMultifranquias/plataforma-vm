const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');

const {
  loginAsAdmin,
  loginAsDisposableUser,
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
  readAdminAccessToken,
} = require('./helpers/users-admin');

function makePhotoBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

function buildMarker() {
  return `uiol-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

async function openOrdersPage(page) {
  await page.goto('/pedidos', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#orders-page-shell')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#orders-results')).toBeVisible({ timeout: 30000 });
}

async function openOrderDrawerByNumber(page, internalNumber) {
  await page.locator('#orders-search').fill(String(internalNumber));
  await expect(page.locator('#orders-table-body tr', { hasText: String(internalNumber) }).first()).toBeVisible({ timeout: 30000 });

  const row = page.locator('#orders-table-body tr', { hasText: String(internalNumber) }).first();
  await row.locator('button[aria-label="Visualizar pedido"]').click();
  await expect(page.locator('#drawer-overlay')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#drawer')).toBeVisible({ timeout: 30000 });
}

async function selectAndFillOrderForm(page, storeId, marker) {
  await expect(page.locator('#form-pedido')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#f-loja')).toBeEnabled({ timeout: 30000 });

  await page.locator('#f-loja').selectOption(String(storeId));
  await page.locator('#f-tipo').selectOption('Produto de Ciclo');
  await page.locator('#f-motivo').selectOption('Falta de estoque');

  const itemRow = page.locator('#items-container [data-order-item="true"]').first();
  await expect(itemRow).toBeVisible({ timeout: 30000 });
  await itemRow.locator('[data-field="customerCode"]').fill('E2E-UI-001');
  await itemRow.locator('[data-field="description"]').fill(`UI lifecycle ${marker}`);
  await itemRow.locator('[data-field="quantity"]').fill('3');
  await itemRow.locator('[data-field="notes"]').fill('primeiro envio');

  await page.locator('#foto-input').setInputFiles({
    name: 'order.jpg',
    mimeType: 'image/jpeg',
    buffer: makePhotoBuffer(),
  });

  await expect(page.locator('#image-gallery')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#image-gallery-count')).toContainText(/imagem|imagens/i);
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    var overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.classList.add('hidden');
  });
  await page.waitForTimeout(200);
}

async function loadLatestOrderForUser(userId, marker) {
  const rows = await supabaseRest(
    `/rest/v1/orders?select=id,internal_number,status,created_at,notes,delivery_protocol,delivery_date,placed_at,received_at&requester_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1`,
    { method: 'GET' }
  );

  const order = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!order) {
    throw new Error(`Order not found for marker ${marker}`);
  }

    return {
      id: String(order.id),
      internalNumber: String(order.internal_number || order.id),
      deliveryDate: String(order.delivery_date || ''),
      deliveryProtocol: String(order.delivery_protocol || ''),
      status: String(order.status || ''),
    };
  }

if (process.env.E2E_ALLOW_LIVE_READS === 'true'
  && process.env.E2E_ALLOW_LIVE_WRITES === 'true'
  && process.env.E2E_ALLOW_LIVE_CRUD === 'true') {
  test.describe.serial('order lifecycle ui', () => {
    const state = {
      admin: null,
      marker: buildMarker(),
      order: null,
      store: null,
      user: null,
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
        const adminToken = await readAdminAccessToken(page);
        if (!adminToken) {
          throw new Error('ADMIN session token unavailable.');
        }

        const stores = await fetchActiveStores();
        const halfeld = stores.find((store) => store.name === 'HALFELD');
        if (!halfeld) {
          throw new Error('Expected active store HALFELD not available.');
        }
        state.store = halfeld;

        const email = buildDisposableEmail(state.marker, 'ui');
        const password = getDisposablePassword();
        const created = await createDisposableUser(page, adminToken, {
          email,
          isActive: true,
          name: `UI ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [halfeld.id],
        });

        await updateDisposableUser(page, adminToken, created.id, {
          email,
          isActive: true,
          name: `UI ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [halfeld.id],
        });

        state.user = {
          email,
          id: String(created.id),
          password,
        };
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
          if (state.order?.id) {
            await deleteOrderArtifactsByOrderId(state.order.id).catch((error) => {
              console.warn(`Order cleanup warning: ${error.message}`);
            });
          }
          if (state.user?.id) {
            await deleteUserViaAdminApi(page, state.user.id, token);
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
    });

    test('full order lifecycle through UI', async ({ page }, testInfo) => {
      const consoleErrors = [];
      const networkFailures = [];

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(String(message.text() || '').slice(0, 500));
        }
      });

      page.on('requestfailed', (request) => {
        const failure = request.failure();
        networkFailures.push(`${request.method()} ${request.url()} :: ${failure ? String(failure.errorText || '') : 'failed'}`.slice(0, 500));
      });

      try {
        await test.step('USER creates and submits order through UI', async () => {
          await loginAsDisposableUser(page, state.user.email, state.user.password, { timeout: 20000 });
          await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });
          await selectAndFillOrderForm(page, state.store.id, state.marker);
          await expect(page.locator('#btn-submit-form')).toBeEnabled();
          await page.locator('#btn-submit-form').click();

          await expect(async () => {
            state.order = await loadLatestOrderForUser(state.user.id, state.marker);
            expect(state.order.status).toBe('PENDING_APPROVAL');
          }).toPass({ timeout: 30000, intervals: [2000, 2000, 2000, 2000, 2000] });
        });

        await test.step('ADMIN requests changes via drawer UI', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.order.internalNumber);

          const changeButton = page.locator('#drawer-footer button', { hasText: 'Solicitar Edição' });
          await expect(changeButton).toBeVisible({ timeout: 30000 });
          await page.locator('#drawer-justificativa').fill(`UI change request ${state.marker}`);
          await changeButton.click();
          await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 10000 });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await openOrdersPage(page);
          await page.locator('#orders-search').fill(state.order.internalNumber);
          await expect(page.locator('#orders-table-body tr', { hasText: state.order.internalNumber }).first()).toBeVisible({ timeout: 30000 });
          await expect(page.locator('#orders-table-body tr', { hasText: state.order.internalNumber }).first().locator('.status-badge')).toContainText('Alterações solicitadas');

          state.order = await loadLatestOrderForUser(state.user.id, state.marker);
          expect(state.order.status).toBe('CHANGES_REQUESTED');
        });

        await test.step('USER edits same order and resubmits', async () => {
          await logout(page);
          await loginAsDisposableUser(page, state.user.email, state.user.password, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.order.internalNumber);

          const editButton = page.locator('#drawer-footer button', { hasText: 'Editar e reenviar' });
          await expect(editButton).toBeVisible({ timeout: 30000 });
          await editButton.click();
          await expect(page.locator('#order-edit-banner')).toBeVisible({ timeout: 30000 });
          await expect(page.locator('#btn-submit-label')).toContainText('Reenviar alterações');

          const itemRow = page.locator('#items-container [data-order-item="true"]').first();
          await expect(itemRow).toBeVisible({ timeout: 30000 });
          await itemRow.locator('[data-field="quantity"]').fill('4');
          await itemRow.locator('[data-field="notes"]').fill(`atualizado ${state.marker}`);

          await page.locator('#btn-submit-form').click();

          await expect(page.locator('#order-edit-banner')).toBeHidden({ timeout: 30000 });
          await expect(page.locator('#btn-submit-label')).toContainText('Enviar Pedido');

          state.order = await loadLatestOrderForUser(state.user.id, state.marker);
          expect(state.order.status).toBe('PENDING_APPROVAL');
        });

        await test.step('Verify final UI state and artifacts', async () => {
          await page.goto('/pedidos', { waitUntil: 'domcontentloaded' });
          await page.locator('#orders-search').fill(state.order.internalNumber);
          const row = page.locator('#orders-table-body tr', { hasText: state.order.internalNumber }).first();
          await expect(row).toBeVisible({ timeout: 30000 });
          await expect(row.locator('.status-badge')).toContainText('Aguardando aprovação');

          const [items, images, history] = await Promise.all([
            supabaseRest(`/rest/v1/order_items?select=id&order_id=eq.${encodeURIComponent(state.order.id)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/order_images?select=id&order_id=eq.${encodeURIComponent(state.order.id)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/status_history?select=id,previous_status,new_status&order_id=eq.${encodeURIComponent(state.order.id)}`, { method: 'GET' }),
          ]);

          expect(Array.isArray(items) ? items.length : 0).toBe(1);
          expect(Array.isArray(images) ? images.length : 0).toBe(1);

          const resubmitEntries = Array.isArray(history)
            ? history.filter((entry) => entry.previous_status === 'CHANGES_REQUESTED' && entry.new_status === 'PENDING_APPROVAL')
            : [];
          expect(resubmitEntries).toHaveLength(1);
        });

        await test.step('ADMIN approves order through drawer UI', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.order.internalNumber);

          const approveBtn = page.locator('#drawer-footer button', { hasText: 'Aprovar' });
          await expect(approveBtn).toBeVisible({ timeout: 30000 });
          await approveBtn.click();
          await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 10000 });

          state.order = await loadLatestOrderForUser(state.user.id, state.marker);
          expect(state.order.status).toBe('APPROVED');
        });

        await test.step('ADMIN marks order as placed', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.order.internalNumber);

          await expect(page.locator('#drawer-footer')).toContainText('Pedido realizado', { timeout: 30000 });
          await page.locator('#drawer-order-protocol').fill(`PR-${state.marker}`);
          await page.locator('#drawer-order-delivery-date').fill('2026-06-26');

          await page.locator('#drawer-order-placed-submit').click();

          await expect(page.locator('#drawer-footer')).toContainText('Aguardando confirmação do recebimento', { timeout: 30000 });
          state.order = await loadLatestOrderForUser(state.user.id, state.marker);
          expect(state.order.status).toBe('ORDER_PLACED');
          expect(state.order.deliveryProtocol).toBe(`PR-${state.marker}`);
          expect(state.order.deliveryDate).toBe('2026-06-26');
        });

        await test.step('USER confirms receipt with invoice and values', async () => {
          await closeDrawer(page);
          await logout(page);
          await loginAsDisposableUser(page, state.user.email, state.user.password, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.order.internalNumber);

          await expect(page.locator('#drawer-delivery-info')).toContainText(`PR-${state.marker}`, { timeout: 30000 });
          await expect(page.locator('#drawer-delivery-info')).toContainText('26/06/2026', { timeout: 30000 });
          await expect(page.locator('#drawer-receipt-invoice')).toBeVisible({ timeout: 30000 });
          await page.locator('#drawer-receipt-invoice').fill(`NF-${state.marker}`);

          const valueInputs = page.locator('.receipt-item-value');
          const count = await valueInputs.count();
          expect(count).toBeGreaterThan(0);
          for (let i = 0; i < count; i++) {
            await valueInputs.nth(i).fill('25.50');
          }

          await page.locator('#drawer-receipt-confirm-btn').click();
          await expect(page.locator('#drawer-footer')).toContainText('Entrega confirmada - nenhuma ação necessária', { timeout: 30000 });
          state.order = await loadLatestOrderForUser(state.user.id, state.marker);
          expect(state.order.status).toBe('RECEIVED');
        });

        await test.step('Verify placed and received backend state', async () => {
          const [placedHistory, placedAudit, receivedAudit, orderRows] = await Promise.all([
            supabaseRest(`/rest/v1/status_history?select=id,previous_status,new_status,comment&order_id=eq.${encodeURIComponent(state.order.id)}&order=created_at.asc`, { method: 'GET' }),
            supabaseRest(`/rest/v1/audit_logs?select=id,action,entity_id&entity=eq.orders&entity_id=eq.${encodeURIComponent(state.order.id)}&action=eq.ORDER_PLACED`, { method: 'GET' }),
            supabaseRest(`/rest/v1/audit_logs?select=id,action,entity_id&entity=eq.orders&entity_id=eq.${encodeURIComponent(state.order.id)}&action=eq.ORDER_RECEIVED`, { method: 'GET' }),
            supabaseRest(`/rest/v1/orders?select=id,status,delivery_protocol,delivery_date,placed_at,placed_by_id,received_at,received_by_id&id=eq.${encodeURIComponent(state.order.id)}`, { method: 'GET' }),
          ]);

          const order = Array.isArray(orderRows) && orderRows.length ? orderRows[0] : null;
          expect(order).toBeTruthy();
          expect(String(order.status)).toBe('RECEIVED');
          expect(String(order.delivery_protocol)).toBe(`PR-${state.marker}`);
          expect(String(order.delivery_date)).toBe('2026-06-26');
          expect(order.placed_at).toBeTruthy();
          expect(order.placed_by_id).toBeTruthy();
          expect(order.received_at).toBeTruthy();
          expect(order.received_by_id).toBeTruthy();

          const placedEntries = Array.isArray(placedHistory)
            ? placedHistory.filter((entry) => entry.previous_status === 'APPROVED' && entry.new_status === 'ORDER_PLACED')
            : [];
          const receivedEntries = Array.isArray(placedHistory)
            ? placedHistory.filter((entry) => entry.previous_status === 'ORDER_PLACED' && entry.new_status === 'RECEIVED')
            : [];
          expect(placedEntries).toHaveLength(1);
          expect(receivedEntries).toHaveLength(1);
          expect(Array.isArray(placedAudit) ? placedAudit.length : 0).toBe(1);
          expect(Array.isArray(receivedAudit) ? receivedAudit.length : 0).toBe(1);
        });
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
  });
}
