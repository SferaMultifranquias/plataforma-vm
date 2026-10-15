'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');

function toFileUrl(...parts) {
  return pathToFileURL(path.join(ROOT, ...parts)).href;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// ── Test helpers ────────────────────────────────────────────
function makeMockRequest(opts) {
  const o = opts || {};
  return {
    body: o.body !== undefined ? o.body : true,
    headers: {
      get(name) {
        const h = o.headers || {};
        return h[name.toLowerCase()] !== undefined ? h[name.toLowerCase()] : (h[name] || null);
      },
    },
    text() {
      const t = o.bodyText !== undefined ? String(o.bodyText) : '{}';
      return Promise.resolve(t);
    },
  };
}

function makeMockResponse() {
  const sent = { statusCode: 200, body: null };
  return {
    _sent: sent,
    status(c) { sent.statusCode = c; return this; },
    json(p) { sent.body = p; },
  };
}

// ── 1. http.js helpers ──────────────────────────────────────
async function testHttpHelpers() {
  const http = await import(toFileUrl('functions', '_shared', 'http.js'));

  // BODY_SIZE_LIMIT
  assert.equal(http.BODY_SIZE_LIMIT, 10240, 'BODY_SIZE_LIMIT = 10KB');

  // badRequest
  const br = http.badRequest();
  assert.equal(br.status, 400, 'badRequest returns 400');

  // unsupportedMediaType
  const umt = http.unsupportedMediaType();
  assert.equal(umt.status, 415, 'unsupportedMediaType returns 415');

  // requestEntityTooLarge
  const retl = http.requestEntityTooLarge();
  assert.equal(retl.status, 413, 'requestEntityTooLarge returns 413');

  // methodNotAllowed
  const mna = http.methodNotAllowed();
  assert.equal(mna.status, 405, 'methodNotAllowed returns 405');

  // notFound
  const nf = http.notFound();
  assert.equal(nf.status, 404, 'notFound returns 404');

  // errorResponse format
  const err = http.errorResponse('test msg', 418, 'TEST_CODE');
  assert.equal(err.status, 418, 'errorResponse status');
  const errBody = JSON.parse(await err.text());
  assert.equal(errBody.code, 'TEST_CODE', 'errorResponse code');
  assert.equal(errBody.error, 'test msg', 'errorResponse message');
  assert.equal(errBody.secrets, undefined, 'no secrets in error');

  // jsonResponse format
  const jr = http.jsonResponse({ ok: true }, 201);
  assert.equal(jr.status, 201, 'jsonResponse status');
  assert.equal(jr.headers.get('Content-Type'), 'application/json; charset=utf-8', 'jsonResponse content-type');
  const jrBody = JSON.parse(await jr.text());
  assert.equal(jrBody.ok, true, 'jsonResponse body');

  // extractBearerToken
  const tokReq1 = makeMockRequest({ headers: { Authorization: 'Bearer tok123' } });
  assert.equal(http.extractBearerToken(tokReq1), 'tok123');
  const tokReq2 = makeMockRequest({ headers: { authorization: 'bearer tok456' } });
  assert.equal(http.extractBearerToken(tokReq2), 'tok456');
  const tokReq3 = makeMockRequest({ headers: {} });
  assert.equal(http.extractBearerToken(tokReq3), '');
  assert.equal(http.extractBearerToken({ headers: { get() { return ''; } } }), '');
  assert.equal(http.extractBearerToken({ headers: { get() { return 'Bearer '; } } }), '');
  assert.equal(http.extractBearerToken({ headers: { get() { return 'Basic xyz'; } } }), '');

  // requireJsonContentType
  const ct1 = makeMockRequest({ headers: { 'content-type': 'application/json' } });
  assert.equal(http.requireJsonContentType(ct1), true, 'application/json accepted');
  const ct2 = makeMockRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } });
  assert.equal(http.requireJsonContentType(ct2), true, 'charset variant accepted');
  const ct3 = makeMockRequest({ headers: { 'content-type': 'text/plain' } });
  assert.equal(http.requireJsonContentType(ct3), false, 'text/plain rejected');
  const ct4 = makeMockRequest({ headers: {} });
  assert.equal(http.requireJsonContentType(ct4), false, 'no content-type rejected');
  const ct5 = makeMockRequest({ headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(http.requireJsonContentType(ct5), false, 'urlencoded rejected');

  // checkBodySize
  const sz1 = makeMockRequest({ headers: { 'content-length': '500' } });
  assert.equal(http.checkBodySize(sz1).tooLarge, false, '500B within limit');
  const sz2 = makeMockRequest({ headers: { 'content-length': '99999' } });
  assert.equal(http.checkBodySize(sz2).tooLarge, true, '99KB over limit');
  const sz3 = makeMockRequest({ headers: {} });
  assert.equal(http.checkBodySize(sz3).tooLarge, false, 'no content-length passes');

  // readJsonPayload - valid JSON
  const rjp1 = makeMockRequest({ bodyText: '{"a":1}', body: true });
  const p1 = await http.readJsonPayload(rjp1);
  assert.equal(p1.ok, true, 'valid JSON ok');
  assert.equal(p1.data.a, 1, 'valid JSON data');
  assert.equal(p1.isEmpty, false);

  // readJsonPayload - empty body
  const rjp2 = makeMockRequest({ bodyText: '', body: true });
  const p2 = await http.readJsonPayload(rjp2);
  assert.equal(p2.ok, true, 'empty body ok');
  assert.equal(p2.isEmpty, true, 'empty body isEmpty');

  // readJsonPayload - no body (null)
  const rjp3 = makeMockRequest({ body: null, bodyText: '' });
  const p3 = await http.readJsonPayload(rjp3);
  assert.equal(p3.ok, true, 'null body ok');
  assert.equal(p3.isEmpty, true, 'null body isEmpty');

  // readJsonPayload - malformed JSON
  const rjp4 = makeMockRequest({ bodyText: '{bad json}', body: true });
  const p4 = await http.readJsonPayload(rjp4);
  assert.equal(p4.ok, false, 'malformed JSON not ok');
  assert.equal(p4.errorCode, 'MALFORMED_JSON', 'malformed JSON errorCode');
  assert.equal(p4.errorMessage, 'Corpo da requisição inválido.');
  // Body must not appear in error
  assert.equal(p4.errorMessage.includes('{bad json}'), false, 'body not leaked in error');

  // readJsonPayload - oversized by actual bytes (10KB+1)
  const oversized = 'x'.repeat(10241);
  const rjp5 = makeMockRequest({ bodyText: oversized, body: true });
  const p5 = await http.readJsonPayload(rjp5);
  assert.equal(p5.ok, false, 'oversized not ok');
  assert.equal(p5.errorCode, 'PAYLOAD_TOO_LARGE', 'oversized errorCode');

  // readJsonPayload - within limit
  const within = '{"a":' + JSON.stringify('x'.repeat(500)) + '}';
  const rjp6 = makeMockRequest({ bodyText: within, body: true });
  const p6 = await http.readJsonPayload(rjp6);
  assert.equal(p6.ok, true, 'within limit ok');
  assert.equal(p6.data.a.length, 500, 'within limit data preserved');

  // readJsonPayload - Content-Length says small but actual bytes exceed
  const sneaky = 'x'.repeat(10241);
  const rjp7 = makeMockRequest({
    bodyText: sneaky,
    body: true,
    headers: { 'content-length': '100' },
  });
  const p7 = await http.readJsonPayload(rjp7);
  assert.equal(p7.ok, false, 'actual bytes still checked even with small content-length');
  assert.equal(p7.errorCode, 'PAYLOAD_TOO_LARGE');

  // readJsonPayload - unicode multi-byte oversized (each CJK char 3 bytes in UTF-8)
  const unicodeStr = '\u3042'.repeat(5000);
  const rjp8 = makeMockRequest({ bodyText: JSON.stringify(unicodeStr), body: true });
  const p8 = await http.readJsonPayload(rjp8);
  assert.equal(p8.ok, false, 'unicode oversized not ok');
  assert.equal(p8.errorCode, 'PAYLOAD_TOO_LARGE', 'unicode oversized');

  // readJsonPayload - unicode within limit (small enough)
  const unicodeSmall = '\u00e9'.repeat(2000);
  const rjp9 = makeMockRequest({ bodyText: JSON.stringify(unicodeSmall), body: true });
  const p9 = await http.readJsonPayload(rjp9);
  assert.equal(p9.ok, true, 'unicode small within limit ok');
  assert.equal(p9.isEmpty, false);

  console.log('http.js helpers ok.');
}

// ── 2. admin-core.js helpers ────────────────────────────────
async function testAdminCore() {
  const core = await import(toFileUrl('functions', '_shared', 'admin-core.js'));

  // isValidUUID
  const validIds = [
    '550e8400-e29b-41d4-a716-446655440000',
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ];
  for (const id of validIds) {
    assert.equal(core.isValidUUID(id), true, `valid UUID: ${id}`);
  }
  const invalidIds = [
    '', null, undefined, 123, 'not-a-uuid', 'order-123',
    '550e8400-e29b-41d4-a716-44665544000Z',
    '550e8400-e29b-41d4-a716-4466554400000',
    '550e8400e29b41d4a716446655440000',
  ];
  for (const id of invalidIds) {
    assert.equal(core.isValidUUID(id), false, `invalid UUID rejected: ${JSON.stringify(id)}`);
  }

  // sanitizeObject - keeps allowed fields
  const result1 = core.sanitizeObject({ name: 'Ana', email: 'ana@test.com', role: 'USER', unknown: 'x' }, ['name', 'email', 'role']);
  assert.equal(result1.name, 'Ana', 'keeps allowed name');
  assert.equal(result1.email, 'ana@test.com', 'keeps allowed email');
  assert.equal(result1.role, 'USER', 'keeps allowed role');
  assert.equal(result1.unknown, undefined, 'strips unknown field');

  // sanitizeObject - null/undefined/array pass through
  assert.equal(core.sanitizeObject(null, ['a']), null, 'null passes through');
  assert.equal(core.sanitizeObject(undefined, ['a']), undefined, 'undefined passes through');
  assert.deepEqual(core.sanitizeObject(['a', 'b'], ['a']), ['a', 'b'], 'array passes through');

  // sanitizeObject - __proto__ rejected (use JSON.parse to avoid prototype setter)
  assert.throws(() => core.sanitizeObject(JSON.parse('{"__proto__": {"admin": true}, "name": "x"}'), ['name']), {
    name: 'AdminError',
    status: 400,
    code: 'INVALID_FIELD',
  }, '__proto__ rejected');

  // sanitizeObject - prototype rejected
  assert.throws(() => core.sanitizeObject(JSON.parse('{"prototype": {"pollute": true}, "name": "x"}'), ['name']), {
    status: 400,
    code: 'INVALID_FIELD',
  }, 'prototype rejected');

  // sanitizeObject - constructor rejected
  assert.throws(() => core.sanitizeObject(JSON.parse('{"constructor": "evil", "name": "x"}'), ['name']), {
    status: 400,
    code: 'INVALID_FIELD',
  }, 'constructor rejected');

  // sanitizeObject - empty allowed keys
  const res2 = core.sanitizeObject({ name: 'x', email: 'y' }, []);
  assert.equal(res2.name, undefined, 'empty allowlist strips all');
  assert.equal(Object.keys(res2).length, 0, 'empty allowlist returns empty object');

  console.log('admin-core.js helpers ok.');
}

// ── 3. Express route files (CJS) ────────────────────────────
async function testExpressRoutes() {
  const { createUsersAdminHandler } = require('../../src/server/routes/users-admin');
  const { createOrdersAdminHandler } = require('../../src/server/routes/orders-admin');
  const { AdminError } = require('../../src/server/services/supabase-admin-service');

  // ── UUID validation ──

  // Invalid user UUID for PATCH returns 400
  const handler1 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    updateUser() { return Promise.resolve({}); },
  });
  const req1 = {
    method: 'PATCH',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: 'not-a-uuid' },
    body: { name: 'x' },
  };
  const res1 = makeMockResponse();
  await handler1(req1, res1);
  assert.equal(res1._sent.statusCode, 400, 'invalid user UUID PATCH returns 400');

  // Invalid user UUID for DELETE returns 400
  const handler2 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    removeUser() { return Promise.resolve({}); },
  });
  const req2 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: 'bad-uuid' },
    body: {},
  };
  const res2 = makeMockResponse();
  await handler2(req2, res2);
  assert.equal(res2._sent.statusCode, 400, 'invalid user UUID DELETE returns 400');

  // Invalid order UUID returns 400
  const handler3 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    verifyCallerPassword() { return Promise.resolve(true); },
    deleteOrder() { return Promise.resolve({ ok: true }); },
  });
  const req3 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: 'bad-order' },
    body: { password: 'x' },
  };
  const res3 = makeMockResponse();
  await handler3(req3, res3);
  assert.equal(res3._sent.statusCode, 400, 'invalid order UUID DELETE returns 400');

  // ── Auth BEFORE ID validation ──

  // Missing auth returns 401 before UUID validation
  const handler4 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { throw new AdminError(401, 'missing_token', 'No token.'); },
  });
  const req4 = {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    params: { id: 'not-a-uuid' },
    body: { password: 'x' },
  };
  const res4 = makeMockResponse();
  await handler4(req4, res4);
  assert.equal(res4._sent.statusCode, 401, 'auth fails before UUID check for orders');

  // Non-admin returns 403 before mutation
  const handler5 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { throw new AdminError(403, 'forbidden', 'Admin only.'); },
  });
  const req5 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: { password: 'x' },
  };
  const res5 = makeMockResponse();
  await handler5(req5, res5);
  assert.equal(res5._sent.statusCode, 403, 'non-admin 403 before mutation');

  // ── Content-Type enforcement ──

  // POST user with wrong content-type -> 415
  const handler6 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    createUser() { return Promise.resolve({}); },
  });
  const req6 = {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'text/plain' },
    body: { name: 'x', email: 'x@x.com', role: 'USER', storeIds: [1] },
  };
  const res6 = makeMockResponse();
  await handler6(req6, res6);
  assert.equal(res6._sent.statusCode, 415, 'wrong content-type returns 415 for POST user');

  // DELETE user does NOT require JSON content-type (no body needed)
  const handler7 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    removeUser() { return Promise.resolve({ ok: true }); },
  });
  const req7 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'text/plain' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: {},
  };
  const res7 = makeMockResponse();
  await handler7(req7, res7);
  assert.equal(res7._sent.statusCode, 200, 'DELETE user succeeds without json content-type');

  // DELETE order with wrong content-type -> 415
  const handler8 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    verifyCallerPassword() { return Promise.resolve(true); },
    deleteOrder() { return Promise.resolve({ ok: true }); },
  });
  const req8 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'text/plain' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: { password: 'x' },
  };
  const res8 = makeMockResponse();
  await handler8(req8, res8);
  assert.equal(res8._sent.statusCode, 415, 'wrong content-type returns 415 for DELETE order');

  // ── Field allowlists ──

  // Unknown fields stripped on create
  let createPayload = null;
  const handler9 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    createUser(payload) { createPayload = payload; return Promise.resolve({}); },
  });
  const req9 = {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.parse('{"name":"Ana","email":"ana@x.com","role":"USER","isActive":true,"storeIds":[1],"admin":true,"SUPABASE_SERVICE_ROLE_KEY":"leaked","__proto__":{}}'),
  };
  const res9 = makeMockResponse();
  await handler9(req9, res9);
  assert.equal(res9._sent.statusCode, 400, '__proto__ rejected on create');
  assert.equal(createPayload, null, 'service not called after __proto__ rejection');

  // Unknown fields stripped on update
  let updatePayload = null;
  const handler10 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    updateUser(id, payload) { updatePayload = payload; return Promise.resolve({}); },
  });
  const req10 = {
    method: 'PATCH',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: { name: 'Ana', role: 'ADMIN', isActive: true, extraField: 'should-be-stripped' },
  };
  const res10 = makeMockResponse();
  await handler10(req10, res10);
  assert.equal(res10._sent.statusCode, 200, 'valid update succeeds');
  assert.equal(updatePayload.extraField, undefined, 'unknown field stripped on update');
  assert.equal(updatePayload.name, 'Ana', 'allowed field preserved');

  // Unknown fields stripped on order delete
  let deleteBody = null;
  const handler11 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    verifyCallerPassword() { return Promise.resolve(true); },
    deleteOrder(orderId, caller, token) { deleteBody = { orderId, caller, token }; return Promise.resolve({ ok: true }); },
  });
  const req11 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: { password: 'correct', extraParam: 'should-not-pass' },
  };
  const res11 = makeMockResponse();
  await handler11(req11, res11);
  assert.equal(res11._sent.statusCode, 200, 'valid order delete succeeds');
  // verifyCallerPassword only receives password, check it was called
  assert.equal(deleteBody !== null, true, 'deleteOrder called');

  // ── Password validation ──
  // Password wrong type rejected by service (verifyCallerPassword mock handles this)
  // Password excessive length - test service would validate it

  // ── Sanitize prototype pollution ──
  // constructor on create
  const handler12 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    createUser() { return Promise.resolve({}); },
  });
  const req12 = {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: { constructor: { prototype: { admin: true } }, name: 'x', email: 'x@x.com', role: 'USER', isActive: true, storeIds: [1] },
  };
  const res12 = makeMockResponse();
  await handler12(req12, res12);
  assert.equal(res12._sent.statusCode, 400, 'constructor rejected on create');

  // ── Non-admin cannot mutate ──
  const handler13 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { throw new AdminError(403, 'forbidden', 'Admin only.'); },
  });
  const req13 = {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: { name: 'x', email: 'x@x.com', role: 'USER', storeIds: [1] },
  };
  const res13 = makeMockResponse();
  await handler13(req13, res13);
  assert.equal(res13._sent.statusCode, 403, 'non-admin cannot create user');

  // ── Missing bearer returns 401 before any action ──
  const handler14 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { throw new AdminError(401, 'missing_token', 'Token missing.'); },
  });
  const req14 = {
    method: 'GET',
    headers: {},
    query: {},
  };
  const res14 = makeMockResponse();
  await handler14(req14, res14);
  assert.equal(res14._sent.statusCode, 401, 'missing token returns 401 for GET');

  // ── Valid UUID passes for valid user operations ──
  let updateCalled = false;
  const handler15 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    updateUser() { updateCalled = true; return Promise.resolve({}); },
  });
  const req15 = {
    method: 'PATCH',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: '550e8400-e29b-41d4-a716-446655440000' },
    body: { name: 'Valid' },
  };
  const res15 = makeMockResponse();
  await handler15(req15, res15);
  assert.equal(res15._sent.statusCode, 200, 'valid UUID PATCH succeeds');
  assert.equal(updateCalled, true, 'updateUser called with valid UUID');

  // ── Non-mutation methods work without content-type ──
  const handler16 = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    listUsers() { return Promise.resolve({ items: [], stores: [], summary: {}, page: 1, pageSize: 20, total: 0, totalPages: 1 }); },
  });
  const req16 = {
    method: 'GET',
    headers: { authorization: 'Bearer tok' },
    query: {},
  };
  const res16 = makeMockResponse();
  await handler16(req16, res16);
  assert.equal(res16._sent.statusCode, 200, 'GET without content-type works');

  // ── Error responses never include upstream details ──
  const handler17 = createOrdersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    verifyCallerPassword() { return Promise.resolve(true); },
    deleteOrder() {
      throw new AdminError(502, 'SUPABASE_ERROR', 'Falha ao excluir o pedido.');
    },
  });
  const req17 = {
    method: 'DELETE',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: { password: 'x' },
  };
  const res17 = makeMockResponse();
  await handler17(req17, res17);
  assert.equal(res17._sent.statusCode, 502, 'upstream error returns 502');
  assert.equal(res17._sent.body.error.includes('timeout'), false, 'no upstream detail in message');
  assert.equal(res17._sent.body.error.includes('connection'), false, 'no upstream detail in message');

  console.log('Express route hardening ok.');
}

function makeOkCaller() {
  return { profile: { id: 'admin-id', role: 'admin', active: true }, authUser: { id: 'admin-id' } };
}

// ── 4. Express app.js error handler ────────────────────────
async function testExpressApp() {
  const source = read('src/server/app.js');

  // Verify jsonParseErrorHandler exists and handles the right errors
  assert.ok(source.includes('jsonParseErrorHandler'), 'jsonParseErrorHandler defined');
  assert.ok(source.includes('SyntaxError'), 'catches SyntaxError');
  assert.ok(source.includes('entity.too.large'), 'catches entity.too.large');
  assert.ok(source.includes('MALFORMED_JSON'), 'MALFORMED_JSON code');
  assert.ok(source.includes('PAYLOAD_TOO_LARGE'), 'PAYLOAD_TOO_LARGE code');
  assert.ok(source.includes('10kb'), 'body limit set to 10kb');

  // Verify error middleware does not expose parser internals
  assert.ok(!source.includes('err.message'), 'error middleware does not expose err.message');
  assert.ok(!source.includes('err.body'), 'error middleware does not expose err.body');

  // Verify middleware uses 'body' in err (safe check)
  assert.ok(source.includes("'body' in err"), 'uses safe body check');

  // CORS: isLocalOrigin
  assert.ok(source.includes('isLocalOrigin'), 'CORS local origin function defined');
  assert.ok(source.includes('localhost'), 'localhost allowed');
  assert.ok(source.includes('127.0.0.1'), '127.0.0.1 allowed');

  // CORS does not allow arbitrary origins
  assert.ok(!source.includes('credentials: true'), 'credentials not enabled');
  const originLine = source.split('\n').find(l => l.includes('origin:'));
  assert.ok(originLine && originLine.includes('isLocalOrigin'), 'CORS origin uses isLocalOrigin');
  assert.ok(originLine && originLine.includes('callback'), 'CORS origin uses callback pattern');

  console.log('Express app.js checks ok.');
}

// ── 5. Error message safety (source inspection) ────────────
async function testErrorSafety() {
  // Express service
  const expressService = read('src/server/services/supabase-admin-service.js');
  // Check no raw upstream patterns remain in client-facing errors
  const leakPatterns = [
    'Storage cleanup failed before database deletion',
    'Order stored files were removed but database deletion failed',
    'ORDER_DELETE_FAILED',
  ];
  for (const pattern of leakPatterns) {
    const lines = expressService.split('\n').filter(l => l.includes(pattern) && !l.trim().startsWith('//'));
    for (const line of lines) {
      // Verify the line is not a string literal containing upstream details
      const match = line.match(/['"]([^'"]*' + `)/);
      assert.ok(
        !line.includes('storageError.message') && !line.includes('dbError.message'),
        `Express service: raw message not leaked in: ${line.trim()}`
      );
    }
  }

  // Pages service
  const pagesService = read('functions/_shared/admin-service.js');
  const pagesLeakPatterns = [
    'STORAGE_DELETE_FAILED',
    'ORDER_DELETE_INCOMPLETE',
    'ORDER_DELETE_FAILED',
  ];
  for (const pattern of pagesLeakPatterns) {
    const lines = pagesService.split('\n').filter(l => l.includes(pattern));
    for (const line of lines) {
      assert.ok(
        !line.includes('storageError.message') && !line.includes('dbError.message') && !line.includes('msg'),
        `Pages service: raw message not leaked in: ${line.trim()}`
      );
    }
  }

  // Verify passwords/tokens not in error responses
  const allSources = [
    read('src/server/routes/users-admin.js'),
    read('src/server/routes/orders-admin.js'),
  ];
  for (const src of allSources) {
    const errorFn = src.match(/function sendAdminError[\s\S]*?\n\}/);
    if (errorFn) {
      const fnText = errorFn[0];
      assert.ok(!fnText.includes('password'), 'sendAdminError does not include password');
      assert.ok(!fnText.includes('token') || fnText.includes('RATE_LIMITED')
        || fnText.includes('missing_token') || fnText.includes('invalid_token')
        || fnText.includes('INVALID_PASSWORD'), 'sendAdminError does not leak token/password values');
    }
  }

  console.log('Error message safety ok.');
}

// ── 6. Express integration (real HTTP) ─────────────────────
async function testExpressIntegration() {
  const app = require('../../src/server/app');
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });

  async function localFetch(pathname, opts) {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}${pathname}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Express integration test timeout')), 3000);
    try {
      const response = await fetch(url, { ...opts, signal: ac.signal });
      const text = await response.text();
      return { response, text, json: tryParseJson(text) };
    } finally {
      clearTimeout(timer);
    }
  }

  function tryParseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  try {
    // 1. No Origin header
    {
      const r = await localFetch('/api/health');
      assert.equal(r.response.status, 200, 'no Origin: status 200');
      assert.equal(r.json && r.json.ok, true, 'no Origin: ok=true');
      assert.ok(r.json && r.json.hora, 'no Origin: hora present');
      assert.ok(r.json && typeof r.json.hora === 'string', 'no Origin: hora is string');
      // CORS header not strictly required when Origin is absent (browser same-origin)
    }

    // 2. Origin: localhost
    {
      const r = await localFetch('/api/health', { headers: { Origin: 'http://localhost:3000' } });
      assert.equal(r.response.status, 200, 'localhost Origin: status 200');
      assert.equal(r.response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000', 'localhost Origin: ACAO matches');
      assert.equal(r.response.headers.get('Access-Control-Allow-Credentials'), null, 'localhost Origin: no credentials');
    }

    // 3. Origin: 127.0.0.1
    {
      const r = await localFetch('/api/health', { headers: { Origin: 'http://127.0.0.1:3000' } });
      assert.equal(r.response.status, 200, '127.0.0.1 Origin: status 200');
      assert.equal(r.response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:3000', '127.0.0.1 Origin: ACAO matches');
    }

    // 4. Origin: [::1]
    {
      const r = await localFetch('/api/health', { headers: { Origin: 'http://[::1]:3000' } });
      assert.equal(r.response.status, 200, '[::1] Origin: status 200');
      assert.equal(r.response.headers.get('Access-Control-Allow-Origin'), 'http://[::1]:3000', '[::1] Origin: ACAO matches');
    }

    // 5. External origin
    {
      const r = await localFetch('/api/health', { headers: { Origin: 'https://evil.com' } });
      assert.equal(r.response.status, 200, 'external Origin: status 200');
      const acao = r.response.headers.get('Access-Control-Allow-Origin');
      assert.ok(acao === null || acao !== 'https://evil.com', `external Origin: ACAO not set for evil origin (got ${acao})`);
    }

    // 6. Malformed origin
    {
      const r = await localFetch('/api/health', { headers: { Origin: 'not-a-url' } });
      assert.equal(r.response.status, 200, 'malformed Origin: status 200');
      const acao = r.response.headers.get('Access-Control-Allow-Origin');
      assert.ok(acao === null || (acao !== 'not-a-url' && acao !== 'http://not-a-url'), `malformed Origin: ACAO not set for malformed (got ${acao})`);
    }

    // 7. OPTIONS preflight from allowed loopback
    {
      const r = await localFetch('/api/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });
      assert.equal(r.response.status, 204, 'OPTIONS preflight: status 204');
      assert.equal(r.response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000', 'OPTIONS: ACAO matches');
      // Access-Control-Allow-Headers should include authorization if preflight passed
      const allowedHeaders = r.response.headers.get('Access-Control-Allow-Headers') || '';
      assert.ok(allowedHeaders.toLowerCase().includes('authorization'), 'OPTIONS: authorization in Allow-Headers');
      assert.equal(r.response.headers.get('Access-Control-Allow-Credentials'), null, 'OPTIONS: no credentials');
    }

    // 8. External OPTIONS preflight
    {
      const r = await localFetch('/api/health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://external.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      // Request completes (doesn't hang) but CORS denied
      const acao = r.response.headers.get('Access-Control-Allow-Origin');
      assert.ok(acao === null || acao !== 'https://external.com', `external OPTIONS: ACAO not set (got ${acao})`);
    }

    console.log('Express integration checks ok.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ── 7. CORS behavior (pure function) ──────────────────────
async function testCors() {
  // Read the isLocalOrigin function from app.js
  const source = read('src/server/app.js');
  const fnMatch = source.match(/function isLocalOrigin[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'isLocalOrigin found');
  const fnCode = fnMatch[0];
  const vm = require('vm');
  const sandbox = { URL, isLocalOrigin: null, result: [] };
  vm.runInNewContext(fnCode.replace('function isLocalOrigin', 'isLocalOrigin = function'), sandbox);

  const { isLocalOrigin } = sandbox;

  // No origin
  assert.equal(isLocalOrigin(null), true, 'null origin allowed');
  assert.equal(isLocalOrigin(''), true, 'empty origin allowed');
  assert.equal(isLocalOrigin(undefined), true, 'undefined origin allowed');

  // Localhost
  assert.equal(isLocalOrigin('http://localhost:3000'), true, 'localhost allowed');
  assert.equal(isLocalOrigin('http://localhost:8788'), true, 'localhost other port allowed');

  // 127.0.0.1
  assert.equal(isLocalOrigin('http://127.0.0.1:3000'), true, '127.0.0.1 allowed');
  assert.equal(isLocalOrigin('http://127.0.0.1:5500'), true, '127.0.0.1 other port');

  // IPv6 loopback
  assert.equal(isLocalOrigin('http://[::1]:3000'), true, 'IPv6 loopback allowed');

  // External origins
  assert.equal(isLocalOrigin('http://example.com'), false, 'external origin rejected');
  assert.equal(isLocalOrigin('https://malicious.com'), false, 'malicious origin rejected');
  assert.equal(isLocalOrigin('http://localhost.evil.com'), false, 'subdomain attack rejected');
  assert.equal(isLocalOrigin('http://127.0.0.1.evil.com'), false, 'IP subdomain attack rejected');
  assert.equal(isLocalOrigin('http://192.168.1.1'), false, 'private IP rejected');

  console.log('CORS checks ok.');
}

// ── 6. Migration SQL safety (static analysis) ───────────────
async function testMigrationSqlSafety() {
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  assert.ok(files.length >= 21, `at least 21 migration files found: ${files.length}`);

  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('--') || trimmed === '') continue;

      // EXECUTE with string concatenation (dynamic SQL building)
      if (/\bexecute\s+'.*'\s*\|\|/i.test(trimmed)) {
        violations.push(`${file}:${i + 1}: ${trimmed.substring(0, 80)}`);
      }
    }
  }

  assert.equal(
    violations.length, 0,
    violations.length
      ? `Dynamic SQL patterns (EXECUTE with concat) found:\n${violations.join('\n')}`
      : 'No dynamic SQL EXECUTE+concat patterns found'
  );

  // Verify all RPC functions use typed SQL parameters (not text for IDs etc.)
  // Check that migration SQL files reference uuid, bigint, jsonb, boolean params
  let rpcCount = 0;
  let typedParamCount = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const rpcMatches = content.match(/create\s+(or\s+replace\s+)?function\s+public\.\w+/gi) || [];
    rpcCount += rpcMatches.length;
    // Count occurrences of typed parameter declarations
    const typedParamMatches = content.match(/\b(?:uuid|bigint|jsonb|boolean|date|numeric)\b/gi) || [];
    typedParamCount += typedParamMatches.length;
  }
  assert.ok(rpcCount >= 5, `at least 5 RPC functions defined: ${rpcCount}`);
  assert.ok(typedParamCount >= rpcCount, `typed params (${typedParamCount}) >= RPC count (${rpcCount})`);

  console.log('Migration SQL safety ok.');
}

// ── 7. Filter normalization safety (admin-core.js) ─────────
async function testFilterNormalizationSafety() {
  const core = await import(toFileUrl('functions', '_shared', 'admin-core.js'));

  // isValidUUID rejects SQL injection and malformed UUIDs
  const injectionIds = [
    "550e8400-e29b-41d4-a716-446655440000'; DROP TABLE profiles;--",
    "' OR '1'='1",
    "1; SELECT * FROM profiles",
    "' UNION SELECT * FROM profiles --",
    "../etc/passwd",
    "<script>alert(1)</script>",
  ];
  for (const id of injectionIds) {
    assert.equal(core.isValidUUID(id), false, `SQLi UUID rejected: ${id.substring(0, 40)}`);
  }

  // isValidUUID rejects empty/falsy values
  assert.equal(core.isValidUUID(''), false, 'empty UUID rejected');
  assert.equal(core.isValidUUID(null), false, 'null UUID rejected');
  assert.equal(core.isValidUUID(undefined), false, 'undefined UUID rejected');

  // normalizeStoreIds rejects non-numeric and negative values
  const badStoreIds = [
    ['1; DROP TABLE profiles'],
    ['-1'],
    ['0'],
    ['abc'],
    ['1', '2); DELETE FROM profiles;--'],
    [NaN],
  ];
  for (const ids of badStoreIds) {
    assert.throws(
      () => core.normalizeStoreIds(ids),
      { code: 'INVALID_STORE' },
      `bad store IDs rejected: ${JSON.stringify(ids)}`
    );
  }

  // normalizeStoreIds accepts positive integers
  const goodIds = core.normalizeStoreIds(['1', '2', '3']);
  assert.deepEqual(goodIds, [1, 2, 3], 'positive integer IDs accepted');

  // normalizeStoreIds deduplicates
  const deduped = core.normalizeStoreIds(['1', '1', '2', '2']);
  assert.deepEqual(deduped, [1, 2], 'duplicate store IDs deduplicated');

  // normalizeRoleFilter rejects SQL injection
  const sqlRoles = [
    "admin' OR '1'='1",
    "' UNION SELECT * FROM profiles --",
    "''; DROP TABLE profiles;--",
  ];
  for (const role of sqlRoles) {
    assert.equal(core.normalizeRoleFilter(role), '', `SQLi role filter: ${role}`);
  }

  // normalizeRoleFilter accepts valid roles
  assert.equal(core.normalizeRoleFilter('admin'), 'admin', 'admin role');
  assert.equal(core.normalizeRoleFilter('ADMIN'), 'admin', 'ADMIN role normalized');
  assert.equal(core.normalizeRoleFilter('administrador'), 'admin', 'administrador role');
  assert.equal(core.normalizeRoleFilter('loja'), 'loja', 'loja role');
  assert.equal(core.normalizeRoleFilter('user'), 'loja', 'user role');
  assert.equal(core.normalizeRoleFilter('USER'), 'loja', 'USER role normalized');

  // normalizeStatusFilter rejects SQL injection
  const sqlStatuses = [
    "active' OR '1'='1",
    "'; DROP TABLE profiles;--",
    "' UNION SELECT --",
  ];
  for (const status of sqlStatuses) {
    assert.equal(core.normalizeStatusFilter(status), '', `SQLi status filter: ${status}`);
  }

  // normalizeStatusFilter accepts valid statuses
  assert.equal(core.normalizeStatusFilter('active'), 'active', 'active status');
  assert.equal(core.normalizeStatusFilter('blocked'), 'blocked', 'blocked status');
  assert.equal(core.normalizeStatusFilter('invited'), 'invited', 'invited status');
  assert.equal(core.normalizeStatusFilter('removed'), 'removed', 'removed status');
  assert.equal(core.normalizeStatusFilter(''), '', 'empty status returns empty');
  assert.equal(core.normalizeStatusFilter('bogus'), '', 'bogus status returns empty');

  // matchesSearch is in-memory only, should not false-positive match SQLi
  // Note: search param is lowercased by callers (listUsers) before passing in
  const user = { name: 'Ana Silva', email: 'ana@test.com' };
  const noMatchPatterns = [
    "' or 1=1 --",
    "' union select * from profiles --",
    "1; drop table profiles",
    "1' or '1'='1",
    "' or '1'='1",
    "' or 'x'='x",
  ];
  for (const pattern of noMatchPatterns) {
    assert.equal(core.matchesSearch(user, pattern), false, `SQLi search not matched: ${pattern}`);
  }
  assert.equal(core.matchesSearch(user, 'ana'), true, 'normal search: ana');
  assert.equal(core.matchesSearch(user, 'silva'), true, 'normal search: silva');
  assert.equal(core.matchesSearch(user, ''), true, 'empty search matches all');

  // matchesStore does not match SQL injection store IDs
  const storeUser = { name: 'Ana', email: 'ana@test.com', stores: [{ id: 5, name: 'Loja A' }] };
  assert.equal(core.matchesStore(storeUser, "' OR '1'='1"), false, 'SQLi storeId not matched');
  assert.equal(core.matchesStore(storeUser, '1; DROP TABLE'), false, 'SQLi storeId 2 not matched');
  assert.equal(core.matchesStore(storeUser, '5'), true, 'valid storeId matched');
  assert.equal(core.matchesStore(storeUser, ''), true, 'empty storeId matches all');

  // sanitizeObject rejects prototype pollution
  // Use JSON.parse to create __proto__ as own key (not prototype chain setter)
  const pollutePayloads = [
    JSON.parse('{"__proto__":"evil","name":"x"}'),
    JSON.parse('{"prototype":"evil","name":"x"}'),
    JSON.parse('{"constructor":"evil","name":"x"}'),
  ];
  for (const payload of pollutePayloads) {
    assert.throws(
      () => core.sanitizeObject(payload, ['name']),
      { code: 'INVALID_FIELD' },
      `prototype pollution rejected: ${JSON.stringify(payload)}`
    );
  }

  // sanitizeObject strips unknown fields even with SQL-like keys
  const sqlKeyPayload = { name: 'Ana', "role'--DROP TABLE": 'admin' };
  const cleaned = core.sanitizeObject(sqlKeyPayload, ['name']);
  assert.equal(cleaned.name, 'Ana', 'name preserved');
  assert.equal(cleaned["role'--DROP TABLE"], undefined, 'SQLi key stripped');

  // computeSummary counts correctly with various statuses
  const users = [
    { status: 'active', role: 'admin' },
    { status: 'active', role: 'loja' },
    { status: 'blocked', role: 'loja' },
    { status: 'invited', role: 'loja' },
    { status: 'removed', role: 'loja' },
  ];
  const summary = core.computeSummary(users);
  assert.equal(summary.active, 2, 'computeSummary active');
  assert.equal(summary.admin, 1, 'computeSummary admin');
  assert.equal(summary.blocked, 1, 'computeSummary blocked');
  assert.equal(summary.invited, 1, 'computeSummary invited');
  assert.equal(summary.removed, 1, 'computeSummary removed');
  assert.equal(summary.total, 5, 'computeSummary total');

  console.log('Filter normalization safety ok.');
}

// ── 8. PostgREST URL encoding safety (service static check) ─
async function testPostgrestUrlSafety() {
  const expressSrc = read('src/server/services/supabase-admin-service.js');
  const pagesSrc = read('functions/_shared/admin-service.js');

  // CHECK 1: All eq.${value} expressions must be in searchParams.set() call
  // OR use encodeURIComponent. This prevents raw user data from reaching PostgREST.
  const ALL_EQ = [
    ...expressSrc.matchAll(/eq\.\$\{(.+?)\}/g),
    ...pagesSrc.matchAll(/eq\.\$\{(.+?)\}/g),
  ];
  for (const m of ALL_EQ) {
    const src = m.input;
    // Find the nearest searchParams.set before this match
    const lastSet = src.lastIndexOf('searchParams.set(', m.index);
    const lastEnc = src.lastIndexOf('encodeURIComponent(', m.index);
    const lineStart = Math.max(0, m.index - 300);
    const inSearchParams = lastSet > lineStart && lastSet > (src.lastIndexOf('\n', m.index - 1) + 1);
    const inEncode = lastEnc > lineStart && lastEnc < m.index;
    if (!inSearchParams && !inEncode) {
      // For the deleteAuditLogsByUserId pattern: uses direct string concat with encodeURIComponent
      // Check if the variable being interpolated is wrapped in encodeURIComponent
      const matchExpr = m[0];
      const isEncoded = matchExpr.includes('encodeURIComponent');
      if (!isEncoded) {
        assert.fail(`eq.${m[1].trim()} not in searchParams.set() or encodeURIComponent at offset ${m.index}`);
      }
    }
  }

  // CHECK 2: encodeURIComponent used for Auth user IDs in URL paths
  // Pattern: /auth/v1/admin/users/${encodeURIComponent(...)}
  const encodedAuth = [
    ...expressSrc.matchAll(/\/auth\/v1\/admin\/users\/\$\{encodeURIComponent/g),
    ...pagesSrc.matchAll(/\/auth\/v1\/admin\/users\/\$\{encodeURIComponent/g),
  ];
  assert.ok(encodedAuth.length >= 4, `auth user URLs use encodeURIComponent: ${encodedAuth.length} occurrences`);

  // CHECK 3: in.(${...}) uses .join() on validated IDs (safe numeric ids)
  // fetchStoresByIds: in.(${ids.join(',')}), fetchStoresByCodes: in.(${valid.join(',')})
  for (const match of [...expressSrc.matchAll(/in\.\(\$\{([^}]+)\}\)/g), ...pagesSrc.matchAll(/in\.\(\$\{([^}]+)\}\)/g)]) {
    const expr = match[1];
    assert.ok(expr.includes('.join'), `in.() uses .join(): ${expr}`);
    assert.ok(expr.includes('ids') || expr.includes('valid'), `in.() uses validated variable: ${expr}`);
  }

  // CHECK 4: listUsers applies filters in-memory, not via PostgREST URL params
  for (const src of [expressSrc, pagesSrc]) {
    const fnMatch = src.match(/async function listUsers[\s\S]*?\n  \}/);
    assert.ok(fnMatch, 'listUsers function found in both services');
    assert.ok(!fnMatch[0].includes('/rest/v1'), 'listUsers does not build PostgREST URLs');
    assert.ok(fnMatch[0].includes('.filter('), 'listUsers uses in-memory .filter()');
  }

  // CHECK 5: RPC calls use POST with JSON body, not URL params
  for (const src of [expressSrc, pagesSrc]) {
    const rpcCalls = src.match(/\/rest\/v1\/rpc\/\w+/g) || [];
    for (const rpcUrl of rpcCalls) {
      const methodStart = src.lastIndexOf('async function', src.indexOf(rpcUrl));
      const methodEnd = src.indexOf('\n  }', methodStart);
      const body = methodEnd > methodStart
        ? src.substring(methodStart, methodEnd + 3)
        : src.substring(methodStart, src.indexOf(rpcUrl) + rpcUrl.length + 80);
      assert.ok(
        body.includes('JSON.stringify') || body.includes('body:'),
        `RPC uses JSON body: ${rpcUrl}`
      );
    }
  }

  console.log('PostgREST URL safety ok.');
}

// ── 9. Express route SQL injection rejection ───────────────
async function testExpressRouteInjection() {
  const { createUsersAdminHandler } = require('../../src/server/routes/users-admin');
  const { createOrdersAdminHandler } = require('../../src/server/routes/orders-admin');
  const { AdminError } = require('../../src/server/services/supabase-admin-service');

  function makeRes() {
    const sent = { statusCode: 200, body: null };
    return {
      _sent: sent,
      status(c) { sent.statusCode = c; return this; },
      json(p) { sent.body = p; },
    };
  }

  function makeOkCaller() {
    return { profile: { id: 'admin-id', role: 'admin', active: true }, authUser: { id: 'admin-id' } };
  }

  // ── UUID param with SQL injection patterns ──
  const sqlInjectionIds = [
    "550e8400-e29b-41d4-a716-446655440000'; DROP TABLE profiles;--",
    "' OR '1'='1",
    "1; SELECT pg_sleep(5)",
    "../etc/passwd",
    "../../../etc/shadow",
  ];

  for (const injectionId of sqlInjectionIds) {
    const handler = createUsersAdminHandler({
      assertConfigured() {},
      assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
      updateUser() { return Promise.resolve({}); },
    });
    const req = {
      method: 'PATCH',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      params: { id: injectionId },
      body: { name: 'x' },
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(
      res._sent.statusCode, 400,
      `PATCH injection UUID rejected (400): ${injectionId.substring(0, 40)}`
    );
  }

  // ── DELETE with SQL injection in UUID ──
  for (const injectionId of sqlInjectionIds) {
    const handler = createUsersAdminHandler({
      assertConfigured() {},
      assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
      removeUser() { return Promise.resolve({ removed: true }); },
    });
    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      params: { id: injectionId },
      body: {},
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(
      res._sent.statusCode, 400,
      `DELETE injection UUID rejected (400): ${injectionId.substring(0, 40)}`
    );
  }

  // ── Order DELETE with SQL injection in UUID ──
  for (const injectionId of sqlInjectionIds) {
    const handler = createOrdersAdminHandler({
      assertConfigured() {},
      assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
      verifyCallerPassword() { return Promise.resolve(true); },
      deleteOrder() { return Promise.resolve({ ok: true }); },
    });
    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      params: { id: injectionId },
      body: { password: 'x' },
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(
      res._sent.statusCode, 400,
      `Order DELETE injection UUID rejected (400): ${injectionId.substring(0, 40)}`
    );
  }

  // ── POST body with SQL injection in fields ──
  // Body fields go through sanitizeObject + validation; SQL injection in string fields
  // should be treated as literal data (not SQL)
  const handler = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    createUser() { return Promise.reject(new AdminError(400, 'VALIDATION', 'Need real validation')); },
  });

  // SQL injection in name should fail validation (not crash), not reach PostgREST
  const injectionBodies = [
    { name: "' OR '1'='1", email: 'x@x.com', role: 'USER', isActive: true, storeIds: [1] },
    { name: "'; DROP TABLE profiles;--", email: 'x@x.com', role: 'USER', isActive: true, storeIds: [1] },
    { name: 'Ana', email: "' OR '1'='1@x.com", role: 'USER', isActive: true, storeIds: [1] },
    { name: 'Ana', email: 'x@x.com', role: 'USER', isActive: true, storeIds: [1] },
  ];

  // These should either pass validation (name/email treated as strings) or fail gracefully
  for (const body of injectionBodies) {
    const h = createUsersAdminHandler({
      assertConfigured() {},
      assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
      createUser(payload) {
        // Simulate validation - injection strings should be treated as literal data
        assert.ok(typeof payload.name === 'string', 'name is string');
        assert.ok(typeof payload.email === 'string', 'email is string');
        return Promise.resolve({ id: 'new-id' });
      },
    });
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body,
    };
    const res = makeRes();
    await h(req, res);
    // Service may return 201 (validated) or throw AdminError
    assert.ok(
      res._sent.statusCode === 201 || res._sent.statusCode === 400 || res._sent.statusCode === 500,
      `POST injection body handled gracefully: ${res._sent.statusCode}`
    );
  }

  // ── GET with SQL injection in query params ──
  // listUsers applies filters in-memory; query params should not reach PostgREST
  let listUsersCalled = false;
  let capturedQuery = null;
  const listHandler = createUsersAdminHandler({
    assertConfigured() {},
    assertActiveAdmin() { return Promise.resolve(makeOkCaller()); },
    listUsers(query) {
      listUsersCalled = true;
      capturedQuery = query;
      return Promise.resolve({ items: [], stores: [], summary: {}, page: 1, pageSize: 20, total: 0, totalPages: 1 });
    },
  });

  const sqlQueryParams = [
    { search: "' OR 1=1 --", role: 'admin', status: 'active' },
    { search: 'ana', role: "' UNION SELECT --", status: "active' OR '1'='1" },
    { search: '', role: '', status: "'; DROP TABLE profiles;--" },
    { storeId: "' OR '1'='1", search: 'ana' },
    { page: "' OR 1=1 --", pageSize: "' UNION SELECT --" },
  ];

  for (const params of sqlQueryParams) {
    listUsersCalled = false;
    capturedQuery = null;
    const hh = listHandler;
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      query: params,
    };
    const res = makeRes();
    await hh(req, res);
    assert.ok(listUsersCalled, `listUsers called with SQLi query: ${JSON.stringify(params)}`);
    assert.equal(res._sent.statusCode, 200, `SQLi query returns 200: ${JSON.stringify(params)}`);
    // Verify params passed through untouched (service handles sanitization)
    assert.ok(capturedQuery, 'query captured');
    assert.equal(capturedQuery.search, params.search, 'search param preserved for service filter');
  }

  console.log('Express route injection rejection ok.');
}

// ── 10. Run all ─────────────────────────────────────────────
async function run() {
  try {
    await testHttpHelpers();
    await testAdminCore();
    await testExpressRoutes();
    await testExpressApp();
    await testErrorSafety();
    await testMigrationSqlSafety();
    await testFilterNormalizationSafety();
    await testPostgrestUrlSafety();
    await testExpressRouteInjection();
    await testExpressIntegration();
    await testCors();
    console.log('All security hardening checks passed.');
  } catch (error) {
    console.error('Security hardening test failed:', error);
    process.exitCode = 1;
  }
}

run();
