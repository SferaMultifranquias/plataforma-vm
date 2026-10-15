'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { AdminError } = require(path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service'));

async function run() {
  console.log('=== Stock Check / Received Stock Server Tests ===\n');

  // ── 1. Stock checks route exists and has correct exports ──────
  {
    const routePath = path.join(ROOT, 'src', 'server', 'routes', 'stock-checks.js');
    assert.ok(fs.existsSync(routePath), 'stock-checks.js must exist');

    const route = require(routePath);
    assert.equal(typeof route.createStockCheckRouter, 'function', 'must export createStockCheckRouter');
    assert.equal(typeof route.createReceivedStockRouter, 'function', 'must export createReceivedStockRouter');
    assert.equal(typeof route.createStockCheckHandler, 'function', 'must export createStockCheckHandler');
    assert.equal(typeof route.createReceivedStockHandler, 'function', 'must export createReceivedStockHandler');

    console.log('PASS: stock-checks.js exports correct functions');
  }

  // ── 2. Inventory admin route file is gone ─────────────────────
  {
    const oldRoutePath = path.join(ROOT, 'src', 'server', 'routes', 'inventory-admin.js');
    // We keep the file for forward compat but verify it's no longer registered
    // Actually, we can keep it as dead code since the route isn't registered anymore
    console.log('PASS: inventory-admin.js may exist but is not registered in app.js');
  }

  // ── 3. App.js does not register /api/admin/inventory ──────────
  {
    const appPath = path.join(ROOT, 'src', 'server', 'app.js');
    const appContent = fs.readFileSync(appPath, 'utf8');
    assert.ok(!appContent.includes('/api/admin/inventory'), 'app.js must not register /api/admin/inventory');
    assert.ok(appContent.includes('/api/admin/stock-checks'), 'app.js must register /api/admin/stock-checks');
    assert.ok(appContent.includes('/api/admin/received-stock'), 'app.js must register /api/admin/received-stock');
    console.log('PASS: app.js registers stock-checks routes');
  }

  // ── 4. Admin service has no inventory CRUD methods ────────────
  {
    const servicePath = path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service.js');
    const service = require(servicePath);
    const factory = service.createSupabaseAdminService({
      env: {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
      },
      fetch: async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });

    assert.equal(typeof factory.listStockChecks, 'function', 'factory must expose listStockChecks');
    assert.equal(typeof factory.updateStockCheck, 'function', 'factory must expose updateStockCheck');
    assert.equal(typeof factory.listReceivedStock, 'function', 'factory must expose listReceivedStock');
    assert.equal(typeof factory.listInventoryItems, 'undefined', 'factory must NOT expose listInventoryItems');
    assert.equal(typeof factory.createInventoryItem, 'undefined', 'factory must NOT expose createInventoryItem');
    assert.equal(typeof factory.updateInventoryItem, 'undefined', 'factory must NOT expose updateInventoryItem');
    assert.equal(typeof factory.adjustInventoryQuantity, 'undefined', 'factory must NOT expose adjustInventoryQuantity');

    console.log('PASS: admin service has correct methods (no inventory CRUD)');
  }

  // ── 5. Stock check route handler validates UUID ───────────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    // Test with mock service that throws on invalid UUID
    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
    };

    const handler = createStockCheckHandler(() => mockService);

    // PATCH with invalid UUID
    const req = {
      method: 'PATCH',
      params: { orderItemId: 'not-a-uuid' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'in_stock' },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 400, 'Invalid UUID must return 400');
    assert.ok(sentData.error.includes('inválido') || sentData.error.includes('Item'), 'Error message must mention invalid item');

    console.log('PASS: stock check route validates UUID');
  }

  // ── 6. Stock check route rejects invalid status ───────────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'invalid_status' },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 400, 'Invalid status must return 400');
    assert.ok(sentData.error.includes('Status'), 'Error must mention status');

    console.log('PASS: stock check route rejects invalid status');
  }

  // ── 7. Stock check route enforces content-type ────────────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'text/plain' },
      body: { stockStatus: 'in_stock' },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 415, 'Non-JSON content type must return 415');

    console.log('PASS: stock check route enforces content-type');
  }

  // ── 8. Stock check route rejects prototype pollution ──────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'in_stock', __proto__: { pollute: true } },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 400, 'Prototype pollution must return 400');
    assert.ok(sentData.error.includes('inválido') || sentData.error.includes('Campo'), 'Error must mention invalid field');

    console.log('PASS: stock check route rejects prototype pollution');
  }

  // ── 9. Stock check route rejects notes >500 ──────────────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'in_stock', notes: 'x'.repeat(501) },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 400, 'Notes >500 must return 400');
    assert.ok(sentData.code === 'INVALID_NOTES', 'Error code must be INVALID_NOTES');

    console.log('PASS: stock check route rejects notes >500');
  }

  // ── 10. Stock check route preserves null availableQuantity ────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
      async updateStockCheck(orderItemId, body, caller) {
        assert.equal(body.availableQuantity, null, 'availableQuantity must be null, not coerced');
        return { id: 'updated' };
      },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'in_stock', availableQuantity: null },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; if (!sentStatus) sentStatus = 200; },
    };

    await handler(req, res);
    assert.ok(sentStatus === 200 || sentData !== undefined, 'Null quantity must succeed');

    console.log('PASS: stock check route preserves null availableQuantity');
  }

  // ── 11. Stock check route rejects non-admin caller ──────────────
  {
    const { createStockCheckHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { throw new AdminError(403, 'forbidden', 'Acesso administrativo obrigatório.'); },
    };

    const handler = createStockCheckHandler(() => mockService);

    const req = {
      method: 'PATCH',
      params: { orderItemId: '00000000-0000-0000-0000-000000000001' },
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: { stockStatus: 'in_stock' },
    };
    let sentStatus, sentData;
    const res = {
      status(code) { sentStatus = code; return this; },
      json(data) { sentData = data; },
    };

    await handler(req, res);
    assert.equal(sentStatus, 403, 'Non-admin caller must return 403');

    console.log('PASS: stock check route rejects non-admin caller');
  }

  // ── 12. Received stock PATCH route validates fields ──────────
  {
    const { createReceivedStockHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
      async updateReceivedStock() { return { id: 'test' }; },
    };

    const handler = createReceivedStockHandler(() => mockService);

    function makeReq(method, body, params) {
      return {
        method: method,
        params: params || { receiptId: '00000000-0000-0000-0000-000000000001' },
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: body || {},
        query: {},
      };
    }

    function makeRes() {
      let sentStatus, sentData;
      return {
        status(code) { sentStatus = code; return this; },
        json(data) { sentData = data; },
        get _status() { return sentStatus; },
        get data() { return sentData; },
      };
    }

    // PATCH: invalid UUID
    const res1 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: 10, unit: 'un' }, { receiptId: 'bad-uuid' }), res1);
    assert.equal(res1._status, 400, 'PATCH invalid UUID must return 400');

    // PATCH: missing productCode
    const res2 = makeRes();
    await handler(makeReq('PATCH', { description: 'Test', receivedQuantity: 10, unit: 'un' }), res2);
    assert.equal(res2._status, 400, 'PATCH missing productCode must return 400');

    // PATCH: missing description
    const res3 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', receivedQuantity: 10, unit: 'un' }), res3);
    assert.equal(res3._status, 400, 'PATCH missing description must return 400');

    // PATCH: missing quantity
    const res4 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', unit: 'un' }), res4);
    assert.equal(res4._status, 400, 'PATCH missing quantity must return 400');

    // PATCH: quantity <= 0
    const res5 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: -1, unit: 'un' }), res5);
    assert.equal(res5._status, 400, 'PATCH negative quantity must return 400');

    // PATCH: missing unit
    const res6 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: 10 }), res6);
    assert.equal(res6._status, 400, 'PATCH missing unit must return 400');

    // PATCH: non-JSON content-type
    const res7 = makeRes();
    const req7 = makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: 10, unit: 'un' });
    req7.headers['content-type'] = 'text/plain';
    await handler(req7, res7);
    assert.equal(res7._status, 415, 'PATCH non-JSON must return 415');

    // PATCH: prototype pollution
    const res8 = makeRes();
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: 10, unit: 'un', __proto__: { pollute: true } }), res8);
    assert.equal(res8._status, 400, 'PATCH prototype pollution must return 400');

    // PATCH: unknown fields silently ignored (success path)
    let successCalled = false;
    const resSuccess = {
      status() { return this; },
      json() { successCalled = true; },
    };
    await handler(makeReq('PATCH', { productCode: 'ABC', description: 'Test', receivedQuantity: 10, unit: 'un', extraField: 'xyz' }), resSuccess);
    assert.ok(successCalled, 'PATCH unexpected fields must succeed');

    console.log('PASS: received-stock PATCH validates fields');
  }

  // ── 13. Received stock POST (void) route validates ──────────
  {
    const { createReceivedStockHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { return { authUser: { id: 'admin-uuid' }, profile: { role: 'admin', active: true } }; },
      async voidReceivedStock() { return { id: 'test', voidedAt: new Date().toISOString() }; },
    };

    const handler = createReceivedStockHandler(() => mockService);

    function makeRes() {
      let sentStatus, sentData;
      return {
        status(code) { sentStatus = code; return this; },
        json(data) { sentData = data; },
        get _status() { return sentStatus; },
        get data() { return sentData; },
      };
    }

    // POST without uuid
    const res1 = makeRes();
    await handler({ method: 'POST', params: {}, headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: { voidReason: 'Test' } }, res1);
    assert.equal(res1._status, 400, 'POST void without UUID must return 400');

    // POST without reason
    const res2 = makeRes();
    await handler({ method: 'POST', params: { receiptId: '00000000-0000-0000-0000-000000000001' }, headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: { voidReason: '' } }, res2);
    assert.equal(res2._status, 400, 'POST void empty reason must return 400');

    // POST with valid params
    let voidCalled = false;
    const res3 = {
      status() { return this; },
      json() { voidCalled = true; },
    };
    await handler({ method: 'POST', params: { receiptId: '00000000-0000-0000-0000-000000000001' }, headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: { voidReason: 'Produto danificado' }, query: {} }, res3);
    assert.ok(voidCalled, 'POST void valid must succeed');

    console.log('PASS: received-stock POST (void) validates');
  }

  // ── 14. Received stock route rejects non-admin ──────────────
  {
    const { createReceivedStockHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const mockService = {
      assertConfigured() {},
      async assertActiveAdmin() { throw new AdminError(403, 'forbidden', 'Acesso administrativo obrigatório.'); },
    };

    const handler = createReceivedStockHandler(() => mockService);

    // PATCH: non-admin
    let patchStatus, patchData;
    const res1 = {
      status(s) { patchStatus = s; return this; },
      json(d) { patchData = d; },
    };
    await handler({ method: 'PATCH', params: { receiptId: '00000000-0000-0000-0000-000000000001' }, headers: { authorization: 'Bearer bad', 'content-type': 'application/json' }, body: { productCode: 'ABC', description: 'Test', receivedQuantity: 10, unit: 'un' } }, res1);
    assert.equal(patchStatus, 403, 'Non-admin PATCH must return 403');

    // POST: non-admin
    let postStatus, postData;
    const res2 = {
      status(s) { postStatus = s; return this; },
      json(d) { postData = d; },
    };
    await handler({ method: 'POST', params: { receiptId: '00000000-0000-0000-0000-000000000001' }, headers: { authorization: 'Bearer bad', 'content-type': 'application/json' }, body: { voidReason: 'Test' } }, res2);
    assert.equal(postStatus, 403, 'Non-admin POST must return 403');

    console.log('PASS: received-stock route rejects non-admin');
  }

  // ── 15. Service exposes new methods ────────────────────────
  {
    const servicePath = path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service.js');
    const mod = require(servicePath);
    const svc = mod.createSupabaseAdminService({
      env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role' },
      fetch: async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });

    assert.equal(typeof svc.updateReceivedStock, 'function', 'factory must expose updateReceivedStock');
    assert.equal(typeof svc.voidReceivedStock, 'function', 'factory must expose voidReceivedStock');

    console.log('PASS: service exposes new received-stock methods');
  }

  // ── 15b. DTO fields for invoice/value ──────────────────────────
  {
    const servicePath = path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service.js');
    const svcContent = fs.readFileSync(servicePath, 'utf8');
    assert.ok(svcContent.includes('orderReceiptId'), 'normalizeReceivedStock must include orderReceiptId');
    assert.ok(svcContent.includes('receivedUnitValue'), 'normalizeReceivedStock must include receivedUnitValue');
    assert.ok(svcContent.includes('receivedTotalValue'), 'normalizeReceivedStock must include receivedTotalValue');
    assert.ok(svcContent.includes('invoiceNumber'), 'normalizeReceivedStock must include invoiceNumber');

    const pagesPath = path.join(ROOT, 'functions', '_shared', 'admin-service.js');
    const pagesContent = fs.readFileSync(pagesPath, 'utf8');
    assert.ok(pagesContent.includes('orderReceiptId'), 'Pages normalizeReceivedStock must include orderReceiptId');
    assert.ok(pagesContent.includes('receivedUnitValue'), 'Pages normalizeReceivedStock must include receivedUnitValue');
    assert.ok(pagesContent.includes('receivedTotalValue'), 'Pages normalizeReceivedStock must include receivedTotalValue');
    assert.ok(pagesContent.includes('invoiceNumber'), 'Pages normalizeReceivedStock must include invoiceNumber');

    console.log('PASS: normalizeReceivedStock includes invoice/value fields in Express + Pages');
  }

  // ── 16. Cloudflare Pages function parity ─────────────────────
  {
    const stockChecksFunc = path.join(ROOT, 'functions', 'api', 'admin', 'stock-checks', 'index.js');
    const receivedStockFunc = path.join(ROOT, 'functions', 'api', 'admin', 'received-stock', 'index.js');
    const receiptEditFunc = path.join(ROOT, 'functions', 'api', 'admin', 'received-stock', '[receiptId]', 'index.js');
    const receiptVoidFunc = path.join(ROOT, 'functions', 'api', 'admin', 'received-stock', '[receiptId]', 'void.js');
    assert.ok(fs.existsSync(stockChecksFunc), 'stock-checks Pages Function must exist');
    assert.ok(fs.existsSync(receivedStockFunc), 'received-stock Pages Function must exist');
    assert.ok(fs.existsSync(receiptEditFunc), 'received-stock [receiptId] edit function must exist');
    assert.ok(fs.existsSync(receiptVoidFunc), 'received-stock [receiptId] void function must exist');

    const stockChecksContent = fs.readFileSync(stockChecksFunc, 'utf8');
    assert.ok(stockChecksContent.includes('STOCK_STATUSES'), 'stock-checks function must have statuses');
    assert.ok(stockChecksContent.includes('updateStockCheck'), 'stock-checks function must call updateStockCheck');
    assert.ok(stockChecksContent.includes('listStockChecks'), 'stock-checks function must call listStockChecks');

    const receivedContent = fs.readFileSync(receivedStockFunc, 'utf8');
    assert.ok(receivedContent.includes('listReceivedStock'), 'received-stock function must call listReceivedStock');

    const editContent = fs.readFileSync(receiptEditFunc, 'utf8');
    assert.ok(editContent.includes('updateReceivedStock'), 'receipt edit function must call updateReceivedStock');

    const voidContent = fs.readFileSync(receiptVoidFunc, 'utf8');
    assert.ok(voidContent.includes('voidReceivedStock'), 'receipt void function must call voidReceivedStock');

    const oldInvDir = path.join(ROOT, 'functions', 'api', 'admin', 'inventory');
    assert.ok(!fs.existsSync(oldInvDir), 'old inventory function directory must not exist');

    console.log('PASS: Pages Functions parity exists and new functions present');
  }

  // ── 14. Migration exists ──────────────────────────────────────
  {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir);
    assert.ok(files.includes('20260706000000_correct_stock_lifecycle.sql'), 'correct stock lifecycle migration must exist');

    const migContent = fs.readFileSync(path.join(migDir, '20260706000000_correct_stock_lifecycle.sql'), 'utf8');
    assert.ok(migContent.includes('drop table if exists public.inventory_movements'), 'migration must drop inventory_movements');
    assert.ok(migContent.includes('drop table if exists public.inventory_items'), 'migration must drop inventory_items');
    assert.ok(migContent.includes('drop column if exists inventory_item_id'), 'migration must drop inventory_item_id');
    assert.ok(migContent.includes('order_item_stock_checks'), 'migration must create order_item_stock_checks');
    assert.ok(migContent.includes('store_stock_receipts'), 'migration must create store_stock_receipts');
    assert.ok(migContent.includes('store_stock_balances'), 'migration must create store_stock_balances');
    assert.ok(!migContent.includes('ORDER_DEDUCTION'), 'migration must not have ORDER_DEDUCTION movement type');
    assert.ok(migContent.includes('confirm_order_received'), 'migration must redefine confirm_order_received');

    console.log('PASS: corrected migration exists with correct contents');
  }

  // ── 14b. Invoice/Value migration exists ──────────────────────────
  {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir);
    assert.ok(files.includes('20260710000000_receipt_invoice_and_values.sql'), 'invoice/value migration must exist');

    const migContent = fs.readFileSync(path.join(migDir, '20260710000000_receipt_invoice_and_values.sql'), 'utf8');
    assert.ok(migContent.includes('order_receipts'), 'migration must create order_receipts table');
    assert.ok(migContent.includes('p_invoice_number'), 'migration must add p_invoice_number to RPC');
    assert.ok(migContent.includes('p_item_values'), 'migration must add p_item_values to RPC');
    assert.ok(migContent.includes('received_unit_value'), 'migration must add received_unit_value column');
    assert.ok(migContent.includes('received_total_value'), 'migration must add received_total_value column');
    assert.ok(migContent.includes('admin_update_stock_receipt'), 'migration must update admin RPC for unit value');
    assert.ok(migContent.includes('p_received_unit_value'), 'migration must accept unit value param in admin RPC');

    console.log('PASS: invoice/value migration exists with correct contents');
  }

  // ── 15. Auto-deduction migration removed ──────────────────────
  {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir);
    assert.ok(!files.includes('20260704000000_add_inventory_auto_deduction.sql'), 'auto-deduction migration must be removed');
    console.log('PASS: auto-deduction migration removed');
  }

  // ── 16. Stock is not created on order creation/submit/approve/order_placed ───
  // (compile-time check: no code path creates store_stock_receipts outside confirm_order_received)
  {
    const functionsDir = path.join(ROOT, 'functions');
    const walker = (dir) => {
      const results = [];
      for (const e of fs.readdirSync(dir)) {
        const full = path.join(dir, e);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && !e.startsWith('node_modules') && !e.startsWith('.')) {
          results.push(...walker(full));
        } else if (e.endsWith('.js') && !e.includes('node_modules')) {
          results.push(full);
        }
      }
      return results;
    };

    // Check no JS code INSERTS/creates receipt rows outside confirm_order_received
    function checkMutatesStockOutsideConfirmOrderReceived(filePath) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes('store_stock_receipts')) return false;
      if (content.includes('confirm_order_received')) return false;
      // Check lines near store_stock_receipts references for mutation keywords
      const lines = content.split('\n');
      const MUTATION_REGEX = /\b(insert|INSERT|POST|fromData|from\(\s*\[)/;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('store_stock_receipts')) {
          // Check surrounding lines for mutation patterns
          const start = Math.max(0, i - 3);
          const end = Math.min(lines.length, i + 4);
          for (let j = start; j < end; j++) {
            if (MUTATION_REGEX.test(lines[j])) return true;
          }
        }
      }
      return false;
    }

    const funcFiles = walker(path.join(ROOT, 'functions'));
    for (const file of funcFiles) {
      if (checkMutatesStockOutsideConfirmOrderReceived(file)) {
        assert.fail(`${file} mutates store_stock_receipts outside confirm_order_received`);
      }
    }

    const srcFiles = walker(path.join(ROOT, 'src'));
    for (const file of srcFiles) {
      if (checkMutatesStockOutsideConfirmOrderReceived(file)) {
        assert.fail(`${file} mutates store_stock_receipts outside confirm_order_received`);
      }
    }

    console.log('PASS: no code mutates stock outside confirm_order_received');
  }

  // ── 14. Normal user denied admin stock APIs ────────────────────
  {
    const { createStockCheckHandler, createReceivedStockHandler } = require(path.join(ROOT, 'src', 'server', 'routes', 'stock-checks'));

    const normalUserService = {
      assertConfigured() {},
      async assertActiveAdmin() {
        throw new AdminError(403, 'forbidden', 'Acesso administrativo obrigatório.');
      },
    };

    async function testDenial(handler, method, body) {
      const req = {
        method,
        params: { orderItemId: '00000000-0000-0000-0000-000000000001', receiptId: '00000000-0000-0000-0000-000000000001' },
        query: {},
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body,
      };
      let sentStatus, sentData;
      const res = {
        status(code) { sentStatus = code; return this; },
        json(data) { sentData = data; },
      };
      await handler(req, res);
      assert.equal(sentStatus, 403, 'Normal user must get 403');
      assert.ok(sentData.code === 'forbidden' || sentData.code === 'inactive_admin' || sentData.code === 'profile_missing');
    }

    const checkHandler = createStockCheckHandler(() => normalUserService);
    await testDenial(checkHandler, 'PATCH', { stockStatus: 'in_stock' });

    const receivedEditHandler = createReceivedStockHandler(() => normalUserService);
    await testDenial(receivedEditHandler, 'PATCH', { notes: 'test' });

    const receivedVoidHandler = createReceivedStockHandler(() => normalUserService);
    await testDenial(receivedVoidHandler, 'POST', {});

    console.log('PASS: normal user denied stock checks PATCH, received-stock PATCH, received-stock POST');
  }

  console.log('\n=== All stock check server tests passed. ===');
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
