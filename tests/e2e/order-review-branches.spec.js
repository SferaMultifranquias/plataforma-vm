const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');

const {
  loginAsAdmin,
  loginAsDisposableUser,
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
  readAdminAccessToken,
  listUsersViaAdminApi,
} = require('./helpers/users-admin');

function makePhotoBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

function buildMarker() {
  return `orb-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
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

async function selectAndFillOrderForm(page, storeId, marker) {
  await expect(page.locator('#form-pedido')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#f-loja')).toBeEnabled({ timeout: 30000 });

  await page.locator('#f-loja').selectOption(String(storeId));
  await page.locator('#f-tipo').selectOption('Produto de Ciclo');
  await page.locator('#f-motivo').selectOption('Falta de estoque');

  const itemRow = page.locator('#items-container [data-order-item="true"]').first();
  await expect(itemRow).toBeVisible({ timeout: 30000 });
  await itemRow.locator('[data-field="customerCode"]').fill('E2E-ORB-001');
  await itemRow.locator('[data-field="description"]').fill(`ORB review ${marker}`);
  await itemRow.locator('[data-field="quantity"]').fill('3');
  await itemRow.locator('[data-field="notes"]').fill(marker);

  await page.locator('#foto-input').setInputFiles({
    name: 'order.jpg',
    mimeType: 'image/jpeg',
    buffer: makePhotoBuffer(),
  });

  await expect(page.locator('#image-gallery')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#image-gallery-count')).toContainText(/imagem|imagens/i);
}

async function loadLatestOrderForUser(userId, marker) {
  const rows = await supabaseRest(
    `/rest/v1/orders?select=id,internal_number,status,created_at&requester_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1`,
    { method: 'GET' }
  );

  const order = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!order) throw new Error(`Order not found for user ${userId} marker ${marker}`);

  return {
    id: String(order.id),
    internalNumber: String(order.internal_number || order.id),
    status: String(order.status || ''),
  };
}

  async function loadOrder(orderId) {
    const orderRows = await supabaseRest(
      `/rest/v1/orders?select=id,status,rejection_reason,approved_at,rejected_at,delivery_protocol,delivery_date,placed_at,placed_by_id,received_at,received_by_id&id=eq.${orderId}`,
      { method: 'GET' }
    );

  const order = Array.isArray(orderRows) && orderRows.length ? orderRows[0] : null;
  if (!order) throw new Error(`Order not found: ${orderId}`);

  const history = await supabaseRest(
    `/rest/v1/status_history?select=id,previous_status,new_status,comment,created_at&order_id=eq.${orderId}&order=created_at.asc`,
    { method: 'GET' }
  );

  return { order, history: Array.isArray(history) ? history : [] };
}

async function loadAuditLog(orderId, action) {
  const audit = await supabaseRest(
    `/rest/v1/audit_logs?select=id,action,entity_id,created_at&entity=eq.orders&entity_id=eq.${orderId}&action=eq.${action}`,
    { method: 'GET' }
  );
  return Array.isArray(audit) ? audit : [];
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    var overlay = document.getElementById('drawer-overlay');
    if (overlay) overlay.classList.add('hidden');
  });
  await page.waitForTimeout(200);
}

async function approveOrderViaDrawer(page, internalNumber) {
  await openOrderDrawerByNumber(page, internalNumber);
  await assertDrawerSummaryUI(page);
  const approveBtn = page.locator('#drawer-footer button', { hasText: 'Aprovar' });
  await expect(approveBtn).toBeVisible({ timeout: 30000 });
  await approveBtn.click();
  await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 10000 });
  await expect(page.locator('#toast-msg')).toHaveText('Pedido aprovado.', { timeout: 5000 });
}

async function rejectOrderViaDrawer(page, internalNumber, reason) {
  await openOrderDrawerByNumber(page, internalNumber);
  await assertDrawerSummaryUI(page);
  await page.locator('#drawer-justificativa').fill(reason);
  const rejectBtn = page.locator('#drawer-footer button', { hasText: 'Rejeitar' });
  await expect(rejectBtn).toBeVisible({ timeout: 30000 });
  await rejectBtn.click();
  await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 10000 });
  await expect(page.locator('#toast-msg')).toHaveText('Pedido rejeitado.', { timeout: 5000 });
}

async function assertDrawerSummaryUI(page) {
  await expect(page.locator('#drawer-loja')).toBeVisible();
  await expect(page.locator('#drawer-data')).toBeVisible();
  await expect(page.locator('text=Referência Externa')).toHaveCount(0);
  await expect(page.locator('text=Valor Total')).toHaveCount(0);
  await expect(page.locator('#drawer-justificativa')).toBeVisible();

  var summaryGridCols = await page.locator('.orders-drawer-summary-grid').evaluate(function getGridCols(el) {
    return window.getComputedStyle(el).gridTemplateColumns;
  });
  var parsedCols = summaryGridCols.split(/\s+/).filter(Boolean);
  expect(parsedCols.length).toBe(2);

  const textareaWidth = await page.locator('#drawer-justificativa').evaluate(function getWidth(el) {
    return el.offsetWidth;
  });
  const parentWidth = await page.locator('#drawer-justificativa').evaluate(function getParentWidth(el) {
    return el.parentElement ? el.parentElement.offsetWidth : 0;
  });
  expect(textareaWidth).toBeGreaterThan(0);
  if (parentWidth > 0) {
    expect(textareaWidth / parentWidth).toBeGreaterThan(0.85);
  }
  var cs = await page.locator('#drawer-justificativa').evaluate(function getComputed(el) {
    var s = window.getComputedStyle(el);
    return {
      width: s.width,
      boxSizing: s.boxSizing,
      minHeight: s.minHeight,
      borderWidth: s.borderWidth,
      borderStyle: s.borderStyle,
      borderColor: s.borderColor,
      padding: s.padding,
      resize: s.resize,
    };
  });
  console.log('Textarea computed styles:', JSON.stringify(cs, null, 2));
  expect(cs.boxSizing).toBe('border-box');
  expect(parseFloat(cs.minHeight)).toBeGreaterThanOrEqual(100);
  expect(cs.borderStyle).toBe('solid');
  expect(['1px', '1.5px'].some(function (t) { return parseFloat(cs.borderWidth) > 0; })).toBe(true);
  expect(cs.resize).toBe('vertical');

  await page.locator('#drawer-justificativa').focus();
  var focusBorderColor = await page.locator('#drawer-justificativa').evaluate(function getFocusBorder(el) {
    return window.getComputedStyle(el).borderColor;
  });
  var focusBoxShadow = await page.locator('#drawer-justificativa').evaluate(function getFocusShadow(el) {
    return window.getComputedStyle(el).boxShadow;
  });
  var focusOutline = await page.locator('#drawer-justificativa').evaluate(function getFocusOutline(el) {
    return window.getComputedStyle(el).outline;
  });
  var hasFocusStyle = (focusBorderColor && focusBorderColor !== 'rgb(203, 213, 225)')
    || (focusBoxShadow && focusBoxShadow !== 'none')
    || (focusOutline && focusOutline !== '0px none');
  expect(hasFocusStyle).toBe(true);
  console.log('Focus borderColor:', focusBorderColor, 'boxShadow:', focusBoxShadow, 'outline:', focusOutline);
}

async function assertOrderImmutable(page, internalNumber, expectedLabel) {
  await openOrderDrawerByNumber(page, internalNumber);
  const buttons = page.locator('#drawer-footer button');
  await expect(buttons).toHaveCount(0);
  await expect(page.locator('#drawer-justificativa-bloco')).toHaveClass(/hidden/);
  await expect(page.locator('.status-badge').first()).toContainText(expectedLabel);
  await closeDrawer(page);
}

if (process.env.E2E_ALLOW_LIVE_READS === 'true'
  && process.env.E2E_ALLOW_LIVE_WRITES === 'true'
  && process.env.E2E_ALLOW_LIVE_CRUD === 'true') {

  test.describe.serial('order review branches', () => {
    const state = {
      marker: buildMarker(),
      admin: null,
      store: null,
      user: null,
      approveOrder: null,
      rejectOrder: null,
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
        if (!adminToken) throw new Error('ADMIN session token unavailable.');

        const stores = await fetchActiveStores();
        const firstStore = stores[0];
        if (!firstStore) throw new Error('No active store available.');
        state.store = firstStore;

        const email = buildDisposableEmail(state.marker, 'orb');
        const password = getDisposablePassword();
        const created = await createDisposableUser(page, adminToken, {
          email,
          isActive: true,
          name: `ORB ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [firstStore.id],
        });

        await updateDisposableUser(page, adminToken, created.id, {
          email,
          isActive: true,
          name: `ORB ${state.marker} requester`,
          password,
          role: 'USER',
          storeIds: [firstStore.id],
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

          for (const order of [state.approveOrder, state.rejectOrder]) {
            if (order?.id) {
              await supabaseRest(
                `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${order.id}`,
                { method: 'DELETE' }
              ).catch(() => {});
              await deleteOrderArtifactsByOrderId(order.id).catch((error) => {
                console.warn(`Order cleanup warning: ${error.message}`);
              });
            }
          }

          for (const order of [state.approveOrder, state.rejectOrder]) {
            if (order?.id) {
              const remaining = await supabaseRest(
                `/rest/v1/orders?select=id&id=eq.${order.id}`,
                { method: 'GET' }
              ).catch(() => []);
              if (Array.isArray(remaining) && remaining.length) {
                console.warn(`Order ${order.id} still exists after cleanup`);
              }
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

    test('ADMIN approves order -> APPROVED with placement action', async ({ page }, testInfo) => {
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
        await test.step('USER creates and submits order', async () => {
          await loginWithCleanSession(page, state.user.email, state.user.password, { timeout: 20000 });
          await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });
          await selectAndFillOrderForm(page, state.store.id, `${state.marker}-approve`);
          await expect(page.locator('#btn-submit-form')).toBeEnabled();
          await page.locator('#btn-submit-form').click();

          await expect(async () => {
            const result = await loadLatestOrderForUser(state.user.id, `${state.marker}-approve`);
            expect(result.status).toBe('PENDING_APPROVAL');
            state.approveOrder = result;
          }).toPass({ timeout: 30000, intervals: [2000, 2000, 2000, 2000, 2000] });
        });

        await test.step('ADMIN approves through drawer UI', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.approveOrder.internalNumber);
          await assertDrawerSummaryUI(page);
          const approveBtn = page.locator('#drawer-footer button', { hasText: 'Aprovar' });
          await expect(approveBtn).toBeVisible({ timeout: 30000 });
          await approveBtn.click();
          await expect(page.locator('#drawer-overlay')).not.toBeVisible({ timeout: 10000 });
          await expect(page.locator('#toast-msg')).toHaveText('Pedido aprovado.', { timeout: 5000 });
        });

        await test.step('Responsive: narrow (768px) drawer layout', async () => {
          await page.setViewportSize({ width: 768, height: 800 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.approveOrder.internalNumber);
          await assertDrawerSummaryUI(page);

          var narrowGrid = await page.locator('.orders-drawer-summary-grid').evaluate(function getGridCols(el) {
            return window.getComputedStyle(el).gridTemplateColumns;
          });
          var narrowCols = narrowGrid.split(/\s+/).filter(Boolean);
          expect(narrowCols.length).toBe(2);

          var narrowHScroll = await page.evaluate(function () {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth;
          });
          expect(narrowHScroll).toBe(false);

          var drawerCanScroll = await page.locator('#drawer').evaluate(function (el) {
            return el.scrollHeight > el.clientHeight;
          });
          if (drawerCanScroll) {
            var drawerBodyScroll = await page.locator('#drawer').evaluate(function (el) {
              el.scrollTop = el.scrollHeight;
              return el.scrollTop;
            });
            expect(drawerBodyScroll).toBeGreaterThan(0);
          }

          await closeDrawer(page);
        });

        await test.step('Responsive: mobile (375px) drawer layout', async () => {
          await page.setViewportSize({ width: 375, height: 667 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.approveOrder.internalNumber);

          await expect(page.locator('#drawer-loja')).toBeVisible();
          await expect(page.locator('#drawer-data')).toBeVisible();
          await expect(page.locator('text=Referência Externa')).toHaveCount(0);
          await expect(page.locator('text=Valor Total')).toHaveCount(0);

          var mobileGrid = await page.locator('.orders-drawer-summary-grid').evaluate(function getGridCols(el) {
            return window.getComputedStyle(el).gridTemplateColumns;
          });
          var mobileCols = mobileGrid.split(/\s+/).filter(Boolean);
          expect(mobileCols.length).toBe(1);

          var mobileRect = await page.locator('.orders-drawer-summary-grid').evaluate(function getRect(el) {
            var first = el.children[0];
            var second = el.children[1];
            var fb = first ? first.getBoundingClientRect() : null;
            var sb = second ? second.getBoundingClientRect() : null;
            return {
              firstTop: fb ? fb.top : 0,
              firstBottom: fb ? fb.bottom : 0,
              secondTop: sb ? sb.top : 0,
            };
          });
          expect(mobileRect.secondTop).toBeGreaterThanOrEqual(mobileRect.firstBottom);

          var mobileHScroll = await page.evaluate(function () {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth;
          });
          expect(mobileHScroll).toBe(false);

          var textareaInDrawer = await page.locator('#drawer-justificativa').evaluate(function (el) {
            var drawer = document.querySelector('#drawer');
            if (!drawer) return false;
            var tb = el.getBoundingClientRect();
            var db = drawer.getBoundingClientRect();
            return tb.right <= db.right + 1;
          });
          expect(textareaInDrawer).toBe(true);

          var mobileCanScroll = await page.locator('#drawer').evaluate(function (el) {
            return el.scrollHeight > el.clientHeight;
          });
          if (mobileCanScroll) {
            var mobileDrawerScroll = await page.locator('#drawer').evaluate(function (el) {
              el.scrollTop = el.scrollHeight;
              return el.scrollTop;
            });
            expect(mobileDrawerScroll).toBeGreaterThan(0);
          }

          await closeDrawer(page);
        });

        await page.setViewportSize({ width: 1280, height: 800 });

        await test.step('Verify backend state for APPROVED', async () => {
          const { order, history } = await loadOrder(state.approveOrder.id);
          expect(String(order.status)).toBe('APPROVED');
          expect(order.approved_at).toBeTruthy();
          expect(order.rejection_reason).toBeNull();

          const approveEntries = history.filter(
            (h) => String(h.previous_status || '').toUpperCase() === 'PENDING_APPROVAL'
              && String(h.new_status || '').toUpperCase() === 'APPROVED'
          );
          expect(approveEntries).toHaveLength(1);

          const audit = await loadAuditLog(state.approveOrder.id, 'ORDER_APPROVED');
          expect(audit).toHaveLength(1);
        });

        await test.step('USER sees approved status badge', async () => {
          await logout(page);
          await loginWithCleanSession(page, state.user.email, state.user.password, { timeout: 20000 });
          await openOrdersPage(page);
          await page.locator('#orders-search').fill(state.approveOrder.internalNumber);
          const row = page.locator('#orders-table-body tr', { hasText: state.approveOrder.internalNumber }).first();
          await expect(row).toBeVisible({ timeout: 30000 });
          await expect(row.locator('.status-badge')).toContainText('Aprovado');
        });

        await test.step('USER cannot edit or resubmit approved order', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.approveOrder.internalNumber);
          const editButton = page.locator('#drawer-footer button', { hasText: 'Editar e reenviar' });
          await expect(editButton).toHaveCount(0);
          await closeDrawer(page);
          await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('ADMIN sees placement action on approved order', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.approveOrder.internalNumber);

          const placedButton = page.locator('#drawer-footer button', { hasText: 'Pedido realizado' });
          await expect(placedButton).toBeVisible({ timeout: 30000 });
          await expect(page.locator('#drawer-footer')).toContainText('Protocolo');
          await expect(page.locator('#drawer-footer')).toContainText('Data de entrega');
          await expect(page.locator('#drawer-footer')).not.toContainText('Entrega confirmada - nenhuma ação necessária');
          await expect(page.locator('#drawer-delete-block')).toContainText('Excluir Pedido');
          await closeDrawer(page);
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

    test('ADMIN rejects order with reason -> REJECTED (immutable)', async ({ page }, testInfo) => {
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

      const rejectionReason = `ORB reject ${state.marker}`;

      try {
        await test.step('USER creates and submits order for rejection', async () => {
          await loginWithCleanSession(page, state.user.email, state.user.password, { timeout: 20000 });
          await page.goto('/novo-pedido', { waitUntil: 'domcontentloaded' });
          await selectAndFillOrderForm(page, state.store.id, `${state.marker}-reject`);
          await expect(page.locator('#btn-submit-form')).toBeEnabled();
          await page.locator('#btn-submit-form').click();

          await expect(async () => {
            const result = await loadLatestOrderForUser(state.user.id, `${state.marker}-reject`);
            expect(result.status).toBe('PENDING_APPROVAL');
            state.rejectOrder = result;
          }).toPass({ timeout: 30000, intervals: [2000, 2000, 2000, 2000, 2000] });
        });

        await test.step('ADMIN rejects through drawer UI with reason', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await rejectOrderViaDrawer(page, state.rejectOrder.internalNumber, rejectionReason);
        });

        await test.step('Verify backend state for REJECTED', async () => {
          const { order, history } = await loadOrder(state.rejectOrder.id);
          expect(String(order.status)).toBe('REJECTED');
          expect(order.rejected_at).toBeTruthy();
          expect(String(order.rejection_reason || '')).toBe(rejectionReason);

          const rejectEntries = history.filter(
            (h) => String(h.previous_status || '').toUpperCase() === 'PENDING_APPROVAL'
              && String(h.new_status || '').toUpperCase() === 'REJECTED'
          );
          expect(rejectEntries).toHaveLength(1);
          expect(String(rejectEntries[0].comment || '')).toBe(rejectionReason);

          const audit = await loadAuditLog(state.rejectOrder.id, 'ORDER_REJECTED');
          expect(audit).toHaveLength(1);
        });

        await test.step('USER sees rejected status badge', async () => {
          await logout(page);
          await loginWithCleanSession(page, state.user.email, state.user.password, { timeout: 20000 });
          await openOrdersPage(page);
          await page.locator('#orders-search').fill(state.rejectOrder.internalNumber);
          const row = page.locator('#orders-table-body tr', { hasText: state.rejectOrder.internalNumber }).first();
          await expect(row).toBeVisible({ timeout: 30000 });
          await expect(row.locator('.status-badge')).toContainText('Rejeitado');
        });

        await test.step('USER sees rejection reason in drawer history', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.rejectOrder.internalNumber);
          await expect(page.locator('#drawer-historico')).toContainText(rejectionReason);
          await closeDrawer(page);
        });

        await test.step('USER cannot edit or resubmit rejected order', async () => {
          await openOrdersPage(page);
          await openOrderDrawerByNumber(page, state.rejectOrder.internalNumber);
          const editButton = page.locator('#drawer-footer button', { hasText: 'Editar e reenviar' });
          await expect(editButton).toHaveCount(0);
          await closeDrawer(page);
          await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('ADMIN cannot act on rejected order', async () => {
          await logout(page);
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openOrdersPage(page);
          await assertOrderImmutable(page, state.rejectOrder.internalNumber, 'Rejeitado');
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
