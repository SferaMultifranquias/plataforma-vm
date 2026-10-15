const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { assertMutationTarget } = require('./helpers/runtime');

function createTestImageBuffer(size, ext) {
  const header = {
    jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
    webp: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]),
  };
  const h = header[ext] || header.jpg;
  const buf = Buffer.alloc(Math.max(size, h.length));
  h.copy(buf);
  return buf;
}

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

const STATE = { marker: '', orderId: null, storeId: '', uiOrderId: null };

function getBaseUrl() {
  return String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
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

function getAdminCredentials() {
  return {
    email: String(process.env.E2E_ADMIN_EMAIL || '').trim(),
    password: String(process.env.E2E_ADMIN_PASSWORD || ''),
  };
}

function warnAboutTarget(baseUrl) {
  const hostname = new URL(baseUrl).hostname;
  console.log(`E2E target host: ${hostname}`);
  return hostname;
}

function buildMarker() {
  return `eor-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
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
  if (text) { try { json = JSON.parse(text); } catch (_) { json = { raw: text }; } }
  if (!response.ok) {
    const message = json && (json.message || json.error || json.raw) ? String(json.message || json.error || json.raw) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function login(page, email, password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const input = page.locator('#login-email');
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await input.fill(email);
  await page.locator('#login-senha').fill(password);
  await page.locator('#login-btn').click();
  await page.locator('#sidebar-username').waitFor({ state: 'visible', timeout: 30000 });
}

async function evalRpc(page, fnName, args) {
  return page.evaluate(async ({ fnName, args }) => {
    if (typeof sb === 'undefined') throw new Error('Supabase client unavailable');
    const res = await sb.rpc(fnName, args);
    if (res.error) throw new Error(`${fnName}: ${res.error.message}`);
    return res.data;
  }, { fnName, args });
}

async function fetchActiveStores() {
  const rows = await supabaseRest('/rest/v1/lojas?select=id,nome,ativo&order=id.asc', { method: 'GET' });
  return Array.isArray(rows)
    ? rows.filter((r) => r && r.ativo !== false).map((r) => ({ id: String(r.id), name: String(r.nome || '') }))
    : [];
}

if (liveEnabled) {
  test.describe.serial('order resubmit flow', () => {
    test.beforeAll(async () => {
      assertMutationTarget();
      warnAboutTarget(getBaseUrl());
      STATE.marker = buildMarker();
      console.log(`Correlation marker: ${STATE.marker}`);

      const stores = await fetchActiveStores();
      const halfeld = stores.find((s) => s.name === 'HALFELD');
      if (!halfeld) throw new Error('Expected HALFELD store not found.');
      STATE.storeId = halfeld.id;
      console.log(`Using store: ${halfeld.name} (${halfeld.id})`);
    });

    test.afterAll(async () => {
      for (const oid of [STATE.orderId, STATE.uiOrderId].filter(Boolean)) {
        try {
          await supabaseRest(`/rest/v1/status_history?order_id=eq.${encodeURIComponent(oid)}`, { method: 'DELETE' });
          await supabaseRest(`/rest/v1/order_images?order_id=eq.${encodeURIComponent(oid)}`, { method: 'DELETE' });
          await supabaseRest(`/rest/v1/order_items?order_id=eq.${encodeURIComponent(oid)}`, { method: 'DELETE' });
          await supabaseRest(`/rest/v1/orders?id=eq.${encodeURIComponent(oid)}`, { method: 'DELETE' });
          console.log(`Cleanup completed for order ${oid}`);
        } catch (e) {
          console.warn(`Cleanup warning for ${oid}: ${e.message}`);
        }
      }
    });

    test('complete resubmit lifecycle', async ({ page }, testInfo) => {
      test.setTimeout(120000);
      const admin = getAdminCredentials();
      const marker = STATE.marker;
      const storeId = STATE.storeId;
      const consErrors = [];
      const netErrs = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consErrors.push(msg.text()); });
      page.on('requestfailed', (req) => {
        const f = req.failure();
        netErrs.push(`${req.method()} ${req.url()} :: ${f ? f.errorText : 'failed'}`);
      });

      try {
        // Step 1: Admin creates + submits order (bypassing UI)
        await test.step('admin creates and submits order', async () => {
          await login(page, admin.email, admin.password);

          const result = await evalRpc(page, 'create_order', {
            p_brand: 'E2E',
            p_cost_center: 'E2E',
            p_justification: marker,
            p_notes: marker,
            p_priority: 'NORMAL',
            p_purpose: 'Produto de Ciclo',
            p_store: 'HALFELD',
            p_store_id: Number(storeId),
          });
          const orderId = String(result.id);

          const submitRes = await evalRpc(page, 'submit_order', { p_order_id: orderId });
          expect(String(submitRes.id)).toBe(orderId);
          expect(submitRes.status).toBe('PENDING_APPROVAL');
          STATE.orderId = orderId;
          console.log(`Order created and submitted: ${orderId}`);
        });

        // Step 2: Admin requests changes (via browser as admin)
        await test.step('admin requests changes', async () => {
          const result = await evalRpc(page, 'request_order_changes', {
            p_order_id: STATE.orderId,
            p_comment: `E2E: revise ${marker}`,
          });
          expect(String(result.id)).toBe(STATE.orderId);
          expect(result.status).toBe('CHANGES_REQUESTED');
          console.log(`Order status: CHANGES_REQUESTED`);
        });

        // Step 3: Admin calls resubmit_changed_order (same browser, same user)
        await test.step('resubmit_changed_order', async () => {
          const newItems = [
            { productCode: 'E2E-RESUBMIT', description: 'E2E resubmit product', quantity: 5 },
          ];

          const result = await evalRpc(page, 'resubmit_changed_order', {
            p_order_id: STATE.orderId,
            p_items: newItems,
            p_image: null,
            p_justification: marker,
            p_notes: marker,
            p_priority: 'NORMAL',
            p_purpose: 'Produto de Ciclo',
          });

          expect(String(result.id)).toBe(STATE.orderId);
          expect(result.status).toBe('PENDING_APPROVAL');
          console.log(`Resubmit confirmed: ${STATE.orderId} -> PENDING_APPROVAL`);
        });

        // Step 4: Verify no duplicate artifacts
        await test.step('verify no duplicate artifacts', async () => {
          const [items, images, history] = await Promise.all([
            supabaseRest(`/rest/v1/order_items?select=id&order_id=eq.${encodeURIComponent(STATE.orderId)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/order_images?select=id&order_id=eq.${encodeURIComponent(STATE.orderId)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/status_history?select=id,previous_status,new_status&order_id=eq.${encodeURIComponent(STATE.orderId)}`, { method: 'GET' }),
          ]);
          const itemCount = Array.isArray(items) ? items.length : 0;
          const imageCount = Array.isArray(images) ? images.length : 0;
          const historyCount = Array.isArray(history) ? history.length : 0;
          console.log(`Artifacts: ${itemCount} items, ${imageCount} images, ${historyCount} history entries`);
          expect(itemCount).toBeGreaterThan(0);
          expect(historyCount).toBeGreaterThan(0);
          const resubmitEntries = Array.isArray(history)
            ? history.filter((h) => h.new_status === 'PENDING_APPROVAL' && h.previous_status === 'CHANGES_REQUESTED')
            : [];
          expect(resubmitEntries).toHaveLength(1);
          console.log('Duplicate artifact check PASSED');
        });

        // Step 5: Retry idempotency test
        await test.step('retry fails (idempotency)', async () => {
          try {
            await evalRpc(page, 'resubmit_changed_order', {
              p_order_id: STATE.orderId,
              p_items: [{ productCode: 'RETRY', description: 'Should fail', quantity: 1 }],
              p_image: null,
              p_justification: marker,
              p_notes: marker,
              p_priority: 'NORMAL',
              p_purpose: 'Produto de Ciclo',
            });
            throw new Error('Retry should have been rejected');
          } catch (err) {
            expect(err.message).toMatch(/Only orders with requested changes|CHANGES_REQUESTED|not.*CHANGES_REQUESTED/i);
            console.log('Retry correctly rejected:', err.message.slice(0, 80));
          }
        });
      } catch (error) {
        const body = [];
        if (consErrors.length) body.push(`Console errors:\n${consErrors.join('\n')}`);
        if (netErrs.length) body.push(`Network failures:\n${netErrs.join('\n')}`);
        await testInfo.attach('e2e-debug.txt', { body: body.join('\n\n'), contentType: 'text/plain' });
        throw error;
      }
    });

    test('UI resubmit lifecycle — no false error toast', async ({ page }, testInfo) => {
      test.setTimeout(120000);
      const admin = getAdminCredentials();
      const marker = STATE.marker;
      const storeId = STATE.storeId;
      var toastMessages = [];
      var toastSeen = [];

      page.on('console', (msg) => {
        if (msg.text && msg.text().includes('loadExistingOrderForEdit')) {
          toastMessages.push('warn:' + msg.text().slice(0, 80));
        }
      });

      try {
        // Step 1: Create + submit order via RPC
        await test.step('create and submit order', async () => {
          await login(page, admin.email, admin.password);

          const result = await evalRpc(page, 'create_order', {
            p_brand: 'E2E', p_cost_center: 'E2E',
            p_justification: marker, p_notes: marker,
            p_priority: 'NORMAL', p_purpose: 'Produto de Ciclo',
            p_store: 'HALFELD', p_store_id: Number(storeId),
          });
          const orderId = String(result.id);

          const submitRes = await evalRpc(page, 'submit_order', { p_order_id: orderId });
          expect(String(submitRes.id)).toBe(orderId);
          expect(submitRes.status).toBe('PENDING_APPROVAL');
          STATE.uiOrderId = orderId;
          console.log(`UI test order created: ${orderId}`);
        });

        // Step 2: Request changes via RPC
        await test.step('request changes', async () => {
          const result = await evalRpc(page, 'request_order_changes', {
            p_order_id: STATE.uiOrderId,
            p_comment: `E2E UI: revise ${marker}`,
          });
          expect(String(result.id)).toBe(STATE.uiOrderId);
          expect(result.status).toBe('CHANGES_REQUESTED');
          console.log(`UI order is CHANGES_REQUESTED`);
        });

        // Step 3: Insert persisted image for edit-mode UI regression
        await test.step('insert persisted image for edit-ui test', async () => {
          const userId = await page.evaluate(async () => {
            const { data: { user } } = await sb.auth.getUser();
            return user.id;
          });
          await supabaseRest('/rest/v1/order_images', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              order_id: STATE.uiOrderId,
              uploaded_by_id: userId,
              original_filename: 'persisted-edit.jpg',
              storage_path: `orders/${userId}/${STATE.uiOrderId}/persisted-edit.jpg`,
              bucket_name: 'order-images',
              mime_type: 'image/jpeg',
              file_size: 1024,
              file_hash: crypto.createHash('sha256').update('persisted-edit').digest('hex'),
            }),
          });
          console.log(`Persisted image inserted for order ${STATE.uiOrderId}`);
        });

        // Step 4: Open edit form via UI
        await test.step('open edit form via /novo-pedido?orderId=X', async () => {
          await page.goto(`/novo-pedido?orderId=${STATE.uiOrderId}`, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('#form-pedido')).toBeVisible({ timeout: 15000 });
          await expect(page.locator('#store-status-message')).not.toBeEmpty({ timeout: 10000 });
          await expect(page.locator('#order-edit-banner')).toBeVisible();
          await expect(page.locator('#order-edit-banner')).toContainText(/Editando pedido/i);
          await expect(page.locator('#btn-submit-label')).toHaveText('Reenviar alterações');
          // Edit-mode upload control assertions
          await expect(page.locator('#edit-images-section')).toBeVisible();
          await expect(page.locator('#edit-images-container [data-action="toggle-existing-image"]')).toHaveCount(1);
          await expect(page.locator('#upload-area')).toBeVisible();
          await expect(page.locator('#upload-area')).not.toHaveClass(/hidden/);
          await expect(page.locator('#image-upload-label')).toContainText(/Adicionar imagens|Arraste/i);
          console.log('Edit form loaded successfully — persisted image visible, upload area visible');
        });

        // Step 5: Add new image and mark persisted for removal — verify UI
        await test.step('add new image and mark persisted for removal — verify UI', async () => {
          await page.locator('#foto-input').setInputFiles([
            { name: 'new-in-edit.jpg', mimeType: 'image/jpeg', buffer: createTestImageBuffer(1024, 'jpg') },
          ]);
          await page.waitForTimeout(300);
          await expect(page.locator('#image-gallery')).toBeVisible();
          await expect(page.locator('#image-gallery-container [data-action="remove-new-image"]')).toHaveCount(1);
          await expect(page.locator('#upload-area')).toBeVisible();
          await expect(page.locator('#upload-area')).not.toHaveClass(/hidden/);
          await expect(page.locator('#image-upload-label')).toHaveText('Adicionar mais imagens');
          // Mark persisted image for removal
          await page.locator('#edit-images-container [data-action="toggle-existing-image"]').click();
          await page.waitForTimeout(200);
          // Upload area still visible after marking removal
          await expect(page.locator('#upload-area')).toBeVisible();
          await expect(page.locator('#upload-area')).not.toHaveClass(/hidden/);
          await expect(page.locator('#image-upload-label')).toHaveText('Adicionar mais imagens');
          console.log('Edit-mode image UI verified — local image added, persisted marked for removal');
        });

        // Step 6: Submit via UI and verify
        await test.step('submit edit via UI — verify no false error toast', async () => {
          // Fill in item fields (order may have no items loaded via RPC)
          await expect(page.locator('#items-container [data-order-item="true"]')).toBeVisible({ timeout: 5000 });
          await page.locator('#items-container [data-order-item="true"] [data-field="customerCode"]').fill('E2E-UI-RESUBMIT');
          await page.locator('#items-container [data-order-item="true"] [data-field="description"]').fill('E2E UI resubmit product');
          await page.locator('#items-container [data-order-item="true"] [data-field="quantity"]').fill('3');

          await page.locator('#btn-submit-form').click();

          // Check for validation errors before expecting success
          var errorFields = await page.locator('[data-error-for]').allTextContents();
          for (var i = 0; i < errorFields.length; i++) {
            if (errorFields[i].trim()) {
              console.log('Validation error:', errorFields[i].trim());
            }
          }

          // Wait for success toast
          await expect(page.locator('#toast-msg')).toContainText(/Pedido enviado|Protocolo/i, { timeout: 15000 });
          var successText = await page.locator('#toast-msg').textContent();
          console.log('Success toast:', successText);

          // Wait for form re-initialization (stores loading)
          await expect(page.locator('#store-status-message')).not.toBeEmpty({ timeout: 10000 });

          // Check the toast message does NOT contain the false error
          var currentToast = (await page.locator('#toast-msg').textContent()) || '';
          expect(currentToast).not.toContain('Nao foi possivel abrir pedido para edicao');

          // Verify no console warnings about failed edit load
          expect(toastMessages.filter(function(m) { return m.includes('loadExistingOrderForEdit'); })).toHaveLength(0);

          // Verify URL no longer has orderId
          var currentUrl = decodeURIComponent(page.url());
          expect(currentUrl).not.toContain('orderId=');

          // Verify edit banner hidden
          await expect(page.locator('#order-edit-banner')).toHaveClass(/hidden/);
          await expect(page.locator('#btn-submit-label')).toHaveText('Enviar Pedido');

          // Verify via RPC that order is PENDING_APPROVAL
          const orders = await supabaseRest(
            `/rest/v1/orders?select=id,status,requester_id&id=eq.${encodeURIComponent(STATE.uiOrderId)}`,
            { method: 'GET' }
          );
          var orderRecord = Array.isArray(orders) && orders[0];
          expect(orderRecord).toBeTruthy();
          expect(String(orderRecord.id)).toBe(STATE.uiOrderId);
          expect(orderRecord.status).toBe('PENDING_APPROVAL');
          console.log('Order status confirmed PENDING_APPROVAL via RPC');
        });

        // Step 7: Verify no replacement order exists
        await test.step('verify no replacement order', async () => {
          const [items, images, history] = await Promise.all([
            supabaseRest(`/rest/v1/order_items?select=id&order_id=eq.${encodeURIComponent(STATE.uiOrderId)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/order_images?select=id&order_id=eq.${encodeURIComponent(STATE.uiOrderId)}`, { method: 'GET' }),
            supabaseRest(`/rest/v1/status_history?select=id,previous_status,new_status&order_id=eq.${encodeURIComponent(STATE.uiOrderId)}&order=created_at.asc`, { method: 'GET' }),
          ]);
          expect(Array.isArray(items) ? items.length : 0).toBeGreaterThan(0);
          var entries = Array.isArray(history) ? history : [];
          var resubmitEntries = entries.filter(function(h) {
            return h.new_status === 'PENDING_APPROVAL' && h.previous_status === 'CHANGES_REQUESTED';
          });
          expect(resubmitEntries).toHaveLength(1);
          expect(entries.length).toBeGreaterThanOrEqual(3);
          console.log(`History entries: ${entries.length}, resubmit entries: ${resubmitEntries.length}`);
        });

        // Step 8: Verify reopening PENDING_APPROVAL order blocked
        await test.step('reopening PENDING_APPROVAL order is blocked', async () => {
          toastMessages = [];
          await page.goto(`/novo-pedido?orderId=${STATE.uiOrderId}`, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('#form-pedido')).toBeVisible({ timeout: 15000 });

          var errorToast = await page.locator('#toast-msg');
          await expect(errorToast).toContainText(/Nao foi possivel abrir pedido/i, { timeout: 10000 });
          console.log('Edit blocked toast confirmed');

          // Form is in CREATE mode (not edit mode)
          await expect(page.locator('#btn-submit-label')).toHaveText('Enviar Pedido');
        });
      } catch (error) {
        const body = [];
        body.push(`Toast messages: ${JSON.stringify(toastSeen)}`);
        body.push(`Console warnings: ${JSON.stringify(toastMessages)}`);
        await testInfo.attach('e2e-debug.txt', { body: body.join('\n\n'), contentType: 'text/plain' });
        throw error;
      }
    });
  });
}
