'use strict';

const assert = require('node:assert/strict');
const { AdminError, createSupabaseAdminService } = require('../../src/server/services/supabase-admin-service');
const { createOrdersAdminHandler, resolveService, readBearerToken } = require('../../src/server/routes/orders-admin');

function makeReq(overrides) {
  return {
    method: 'DELETE',
    headers: { authorization: 'Bearer admintoken', 'content-type': 'application/json', ...((overrides && overrides.headers) || {}) },
    params: { id: '00000000-0000-0000-0000-000000000123', ...((overrides && overrides.params) || {}) },
    body: { password: 'correct-password', ...((overrides && overrides.body) || {}) },
    ...overrides,
  };
}

function makeRes() {
  var sent = { statusCode: 200, body: null };
  return {
    _sent: sent,
    status: function (code) {
      sent.statusCode = code;
      return this;
    },
    json: function (payload) {
      sent.body = payload;
    },
  };
}

function makeOkCaller() {
  return { profile: { id: 'admin-id', role: 'admin', active: true }, authUser: { id: 'admin-id' } };
}

function makeOkService() {
  return {
    assertConfigured: function () {},
    assertActiveAdmin: function () { return Promise.resolve(makeOkCaller()); },
    verifyCallerPassword: function () { return Promise.resolve(true); },
    deleteOrder: function () {
      return Promise.resolve({
        ok: true,
        orderId: 'order-123',
        deletedFiles: ['imgs/photo.jpg'],
        missingFiles: [],
      });
    },
  };
}

function makeJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text() {
      return Promise.resolve(JSON.stringify(body));
    },
  };
}

function createFetchStub(routes, calls) {
  return async function fetchStub(url, init) {
    calls.push({ url: String(url), init: init || {} });
    const parsed = new URL(url);
    const handler = routes[parsed.pathname];
    if (!handler) {
      throw new Error(`Unhandled request: ${parsed.pathname}`);
    }
    const payload = typeof handler === 'function' ? await handler(parsed, init || {}) : handler;
    return makeJsonResponse(payload.status || 200, payload.body);
  };
}

async function run() {
  // resolveService: function factory
  var called = 0;
  var factory = resolveService(function () {
    called++;
    return { ok: true };
  });
  var svc = factory();
  assert.equal(called, 1);
  assert.equal(svc.ok, true);

  // resolveService: plain object
  var plain = resolveService({ ok: true });
  assert.equal(plain().ok, true);

  // readBearerToken
  assert.equal(readBearerToken({ headers: {} }), '');
  assert.equal(readBearerToken({ headers: { authorization: '' } }), '');
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer tok123' } }), 'tok123');
  assert.equal(readBearerToken({ headers: { authorization: 'bearer tok456' } }), 'tok456');

  // handler: missing auth token
  var handler1 = createOrdersAdminHandler({
    assertConfigured: function () {},
    assertActiveAdmin: function () {
      throw new AdminError(401, 'missing_token', 'Token de acesso ausente.');
    },
  });
  var req1 = makeReq({ headers: {} });
  var res1 = makeRes();
  await handler1(req1, res1);
  assert.equal(res1._sent.statusCode, 401);
  assert.equal(res1._sent.body && res1._sent.body.error, 'Token de acesso ausente.');

  // handler: invalid token
  var handler2 = createOrdersAdminHandler({
    assertConfigured: function () {},
    assertActiveAdmin: function () {
      throw new AdminError(401, 'invalid_token', 'Token de acesso inválido.');
    },
  });
  var req2 = makeReq({ headers: { authorization: 'Bearer badtoken' } });
  var res2 = makeRes();
  await handler2(req2, res2);
  assert.equal(res2._sent.statusCode, 401);

  // handler: forbidden (non-admin)
  var handler3 = createOrdersAdminHandler({
    assertConfigured: function () {},
    assertActiveAdmin: function () {
      throw new AdminError(403, 'forbidden', 'Admin access required.');
    },
  });
  var req3 = makeReq();
  var res3 = makeRes();
  await handler3(req3, res3);
  assert.equal(res3._sent.statusCode, 403);

  // handler: inactive admin rejected
  var handler4 = createOrdersAdminHandler({
    assertConfigured: function () {},
    assertActiveAdmin: function () {
      throw new AdminError(403, 'inactive_admin', 'Administradores inativos não podem acessar este endpoint.');
    },
  });
  var req4 = makeReq();
  var res4 = makeRes();
  await handler4(req4, res4);
  assert.equal(res4._sent.statusCode, 403);

  // handler: missing order id
  var handler5 = createOrdersAdminHandler(makeOkService());
  var req5 = makeReq({ params: {} });
  var res5 = makeRes();
  await handler5(req5, res5);
  assert.equal(res5._sent.statusCode, 400);

  // handler: order not found
  var handler6 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    deleteOrder: function () {
      throw new AdminError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    },
  }));
  var req6 = makeReq();
  var res6 = makeRes();
  await handler6(req6, res6);
  assert.equal(res6._sent.statusCode, 404);

  // handler: non-DRAFT orders are accepted (no INVALID_STATUS)
  var handler7 = createOrdersAdminHandler(makeOkService());
  var req7 = makeReq();
  var res7 = makeRes();
  await handler7(req7, res7);
  assert.equal(res7._sent.statusCode, 200);
  assert.equal(res7._sent.body && res7._sent.body.ok, true);
  assert.equal(res7._sent.body.orderId, 'order-123');

  // handler: successful deletion
  var handler8 = createOrdersAdminHandler(makeOkService());
  var req8 = makeReq();
  var res8 = makeRes();
  await handler8(req8, res8);
  assert.equal(res8._sent.statusCode, 200);
  assert.equal(res8._sent.body && res8._sent.body.ok, true);
  assert.equal(res8._sent.body.orderId, 'order-123');
  assert.equal(res8._sent.body.deletedFiles.length, 1);

  // handler: storage failure before RPC (502)
  var handler9 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    deleteOrder: function () {
      throw new AdminError(502, 'STORAGE_DELETE_FAILED', 'Storage cleanup failed before database deletion: timeout');
    },
  }));
  var req9 = makeReq();
  var res9 = makeRes();
  await handler9(req9, res9);
  assert.equal(res9._sent.statusCode, 502);

  // handler: partial failure after storage deletion succeeds but RPC fails
  var handler10 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    deleteOrder: function () {
      return Promise.resolve({
        ok: false,
        orderId: 'order-123',
        partialFailure: true,
        error: 'Order stored files were removed but database deletion failed: connection error',
        deletedFiles: ['imgs/photo.jpg'],
        missingFiles: [],
      });
    },
  }));
  var req10 = makeReq();
  var res10 = makeRes();
  await handler10(req10, res10);
  assert.equal(res10._sent.statusCode, 207);
  assert.equal(res10._sent.body.partialFailure, true);

  // handler: retry with already deleted order (safe result)
  var handler11 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    deleteOrder: function () {
      return Promise.resolve({
        ok: true,
        orderId: 'order-123',
        alreadyDeleted: true,
        deletedFiles: [],
        missingFiles: [],
      });
    },
  }));
  var req11 = makeReq();
  var res11 = makeRes();
  await handler11(req11, res11);
  assert.equal(res11._sent.statusCode, 200);
  assert.equal(res11._sent.body.alreadyDeleted, true);

  // handler: method not allowed
  var handler12 = createOrdersAdminHandler(makeOkService());
  var req12 = makeReq({ method: 'GET' });
  var res12 = makeRes();
  await handler12(req12, res12);
  assert.equal(res12._sent.statusCode, 405);

  // handler: not found when service not configured
  var handler13 = createOrdersAdminHandler(null);
  var req13 = makeReq();
  var res13 = makeRes();
  await handler13(req13, res13);
  assert.equal(res13._sent.statusCode, 503);

  // handler: missing password rejected
  var handler14 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    verifyCallerPassword: function () {
      throw new AdminError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    },
  }));
  var req14 = makeReq({ body: {} });
  var res14 = makeRes();
  await handler14(req14, res14);
  assert.equal(res14._sent.statusCode, 401);
  assert.equal(res14._sent.body && res14._sent.body.error, 'Senha incorreta. O pedido não foi excluído.');
  assert.equal(res14._sent.body.code, 'INVALID_PASSWORD');

  // handler: wrong password rejected
  var handler15 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    verifyCallerPassword: function () {
      throw new AdminError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    },
  }));
  var req15 = makeReq({ body: { password: 'wrong-password' } });
  var res15 = makeRes();
  await handler15(req15, res15);
  assert.equal(res15._sent.statusCode, 401);
  assert.equal(res15._sent.body && res15._sent.body.error, 'Senha incorreta. O pedido não foi excluído.');

  // handler: password other user ID mismatch
  var handler16 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    verifyCallerPassword: function () {
      throw new AdminError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    },
  }));
  var req16 = makeReq({ body: { password: 'other-user-password' } });
  var res16 = makeRes();
  await handler16(req16, res16);
  assert.equal(res16._sent.statusCode, 401);
  assert.equal(res16._sent.body && res16._sent.body.error, 'Senha incorreta. O pedido não foi excluído.');

  // handler: password failure prevents deleteOrder from being called
  var deleteOrderCalled = false;
  var handler17 = createOrdersAdminHandler(Object.assign({}, makeOkService(), {
    verifyCallerPassword: function () {
      throw new AdminError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    },
    deleteOrder: function () {
      deleteOrderCalled = true;
      return Promise.resolve({ ok: true, orderId: 'order-123' });
    },
  }));
  var req17 = makeReq({ body: { password: 'wrong' } });
  var res17 = makeRes();
  await handler17(req17, res17);
  assert.equal(res17._sent.statusCode, 401);
  assert.equal(deleteOrderCalled, false);

  // handler: Auth token never appears in returned errors
  var handler18 = createOrdersAdminHandler({
    assertConfigured: function () {},
    assertActiveAdmin: function () {
      throw new AdminError(401, 'missing_token', 'Token de acesso ausente.');
    },
  });
  var req18 = makeReq({ headers: {} });
  var res18 = makeRes();
  await handler18(req18, res18);
  assert.equal(res18._sent.statusCode, 401);
  var bodyStr = JSON.stringify(res18._sent.body || '');
  assert.equal(bodyStr.includes('admintoken'), false);
  assert.equal(bodyStr.includes('Bearer'), false);
  assert.equal(bodyStr.includes('password'), false);

  // service: delete storage cleanup hits bucket remove endpoint used by storage-js
  var fetchCalls = [];
  var service = createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: createFetchStub({
      '/rest/v1/orders': {
        status: 200,
        body: [
          {
            id: 'order-123',
            status: 'PENDING_APPROVAL',
          },
        ],
      },
      '/rest/v1/order_images': {
        status: 200,
        body: [
          {
            storage_path: 'orders/admin-id/order-123/image.webp',
          },
        ],
      },
      '/storage/v1/object/order-images': {
        status: 200,
        body: [
          {
            name: 'orders/admin-id/order-123/image.webp',
          },
        ],
      },
      '/rest/v1/rpc/delete_order': {
        status: 200,
        body: {
          id: 'order-123',
        },
      },
    }, fetchCalls),
  });

  var deleteResult = await service.deleteOrder('order-123', {
    authUser: { id: 'admin-id', email: 'admin@sfera.com' },
    profile: { role: 'admin' },
  }, 'admintoken');

  assert.equal(deleteResult.ok, true);
  assert.equal(fetchCalls.some(function (call) {
    return call.url === 'https://project.supabase.co/storage/v1/object/order-images' && call.init && call.init.method === 'DELETE';
  }), true);
  assert.equal(fetchCalls.some(function (call) {
    return call.url.indexOf('/remove') !== -1;
  }), false);

  console.log('Orders admin handler checks ok.');
}

run().catch(function (error) {
  console.error('Orders admin handler test failed:', error);
  process.exit(1);
});
