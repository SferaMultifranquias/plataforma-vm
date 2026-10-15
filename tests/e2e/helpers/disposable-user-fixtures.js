const crypto = require('node:crypto');

const { deleteUserViaAdminApi, listUsersViaAdminApi } = require('./users-admin');
const { assertMutationTarget } = require('./runtime');

function getEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getBaseUrl() {
  return String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

function assertLiveCrudEnabled() {
  if (process.env.E2E_ALLOW_LIVE_READS !== 'true' || process.env.E2E_ALLOW_LIVE_WRITES !== 'true' || process.env.E2E_ALLOW_LIVE_CRUD !== 'true') {
    throw new Error('Live E2E gates must all be true.');
  }
  assertMutationTarget();
}

function getSupabaseBaseUrl() {
  return getEnv('SUPABASE_URL').replace(/\/$/, '');
}

function getServiceRoleKey() {
  return getEnv('SUPABASE_SERVICE_ROLE_KEY');
}

function getAnonKey() {
  return getEnv('SUPABASE_ANON_KEY');
}

function getTestEmailDomain() {
  return getEnv('E2E_TEST_EMAIL_DOMAIN').replace(/^@+/, '');
}

function buildCorrelationMarker() {
  return `usv-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function buildDisposableEmail(marker, suffix) {
  return `e2e-user-${marker}-${suffix}@${getTestEmailDomain()}`;
}

function hasMarker(value, marker) {
  return String(value || '').includes(marker);
}

function assertDisposableIdentity(record, marker, expectedEmail) {
  if (!record || !record.id) {
    throw new Error('Disposable user record missing.');
  }

  if (!hasMarker(record.email, marker) || (expectedEmail && String(record.email || '').toLowerCase() !== String(expectedEmail).toLowerCase())) {
    throw new Error('Disposable user email mismatch.');
  }

  if (String(record.role || '').toLowerCase() === 'admin') {
    throw new Error('Refusing ADMIN disposable user.');
  }

  if (!hasMarker(record.name, marker) && !hasMarker(record.email, marker)) {
    throw new Error('Disposable user missing E2E marker.');
  }

  return record;
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
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = { raw: text };
    }
  }

  if (!response.ok) {
    const message = json && (json.message || json.error || json.raw) ? String(json.message || json.error || json.raw) : `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = json;
    throw error;
  }

  return json;
}

async function fetchActiveStores() {
  const rows = await supabaseRest('/rest/v1/lojas?select=id,nome,ativo&order=id.asc', { method: 'GET' });
  return Array.isArray(rows)
    ? rows.filter((row) => row && row.ativo !== false).map((row) => ({ id: String(row.id), name: String(row.nome || ''), active: row.ativo !== false }))
    : [];
}

async function createDisposableUserDirect(email, password, name, role, storeIds, marker) {
  assertLiveCrudEnabled();
  const svcKey = getServiceRoleKey();
  const anonKey = getAnonKey();
  const svcUrl = getSupabaseBaseUrl();

  // Create Auth user with known password
  const authResp = await fetch(`${svcUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { is_active: true, role },
      user_metadata: { full_name: name, name, is_active: true, role },
    }),
  });

  if (!authResp.ok) {
    const text = await authResp.text().catch(() => '');
    throw new Error(`create Auth user failed (HTTP ${authResp.status}): ${text.slice(0, 200)}`);
  }

  const authData = await authResp.json();
  const userId = authData?.user?.id || authData?.id;
  if (!userId) {
    throw new Error('create Auth user returned no ID');
  }

  // Profile auto-created by handle_new_user trigger.
  // Update the auto-created profile with our desired values.
  await fetch(`${svcUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      is_active: true,
    }),
  });

  // Assign stores
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    for (const storeId of storeIds) {
      await fetch(`${svcUrl}/rest/v1/user_stores`, {
        method: 'POST',
        headers: {
          apikey: svcKey,
          Authorization: `Bearer ${svcKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId, store_id: storeId }),
      }).catch(() => {});
    }
  }

  return { id: userId, email, name, role };
}

async function updateDisposableUser(page, accessToken, userId, payload) {
  const response = await page.request.patch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    data: {
      email: payload.email,
      isActive: payload.isActive,
      name: payload.name,
      password: payload.password || '',
      role: payload.role,
      storeIds: Array.isArray(payload.storeIds) ? payload.storeIds : [],
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text().catch(() => '');
  const data = text ? JSON.parse(text) : {};
  if (!response.ok()) {
    const error = new Error(data.error || data.message || `update user failed (HTTP ${response.status()}).`);
    error.code = data.code || '';
    error.status = response.status();
    throw error;
  }

  return data;
}

async function getDisposableUserRecord(page, accessToken, email, marker) {
  const payload = await listUsersViaAdminApi(page, email, accessToken);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const record = items.find((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase()) || null;
  if (!record) {
    throw new Error(`Disposable user not found: ${email}`);
  }

  return assertDisposableIdentity(record, marker, email);
}

async function unlinkDisposableUserStores({ userId, email, marker }) {
  assertLiveCrudEnabled();
  if (!userId) throw new Error('Disposable user id required.');
  if (!email || !hasMarker(email, marker)) throw new Error('Disposable user email missing marker.');
  if (!marker) throw new Error('Correlation marker required.');

  const record = await supabaseRest(`/rest/v1/profiles?select=id,email,role,name,is_active&id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET',
  });

  const profile = Array.isArray(record) && record.length ? record[0] : null;
  if (!profile) {
    throw new Error('Disposable profile not found.');
  }
  if (String(profile.role || '').toLowerCase() === 'admin') {
    throw new Error('Refusing ADMIN disposable user.');
  }
  if (!hasMarker(profile.email, marker)) {
    throw new Error('Disposable profile missing E2E marker.');
  }

  await supabaseRest(`/rest/v1/user_stores?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

  return getUserStoreAssignments(userId);
}

async function getUserStoreAssignments(userId) {
  const rows = await supabaseRest(`/rest/v1/user_stores?select=user_id,store_id&user_id=eq.${encodeURIComponent(userId)}&order=store_id.asc`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows.map((row) => ({ userId: String(row.user_id), storeId: String(row.store_id) })) : [];
}

async function deleteDisposableUser(page, accessToken, userId) {
  return deleteUserViaAdminApi(page, userId, accessToken);
}

async function findOrdersByRequesterId(userId) {
  const rows = await supabaseRest(`/rest/v1/orders?select=id,requester_id,created_at&requester_id=eq.${encodeURIComponent(userId)}&order=created_at.asc`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows.map((row) => ({ id: String(row.id), requesterId: String(row.requester_id || '') })) : [];
}

async function findOrderStoragePaths(orderId) {
  const rows = await supabaseRest(`/rest/v1/order_images?select=storage_path,bucket_name&order_id=eq.${encodeURIComponent(orderId)}`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows.map((row) => ({ path: String(row.storage_path || ''), bucket: String(row.bucket_name || 'order-images') })).filter((s) => s.path) : [];
}

async function deleteStorageObject(bucket, path) {
  const url = `${getSupabaseBaseUrl()}/storage/v1/object/${bucket}/${path}`;
  const svcKey = getServiceRoleKey();
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '');
    throw new Error(`Storage DELETE failed: HTTP ${response.status}${text ? ' ' + text.slice(0, 200) : ''}`);
  }
}

async function findOrderArtifactsByOrderId(orderId) {
  const [items, images, history] = await Promise.all([
    supabaseRest(`/rest/v1/order_items?select=id,order_id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/order_images?select=id,order_id,storage_path,bucket_name&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
    supabaseRest(`/rest/v1/status_history?select=id,order_id&order_id=eq.${encodeURIComponent(orderId)}`, { method: 'GET' }),
  ]);

  return {
    items: Array.isArray(items) ? items.map((row) => String(row.id)) : [],
    images: Array.isArray(images) ? images.map((row) => ({ id: String(row.id), storagePath: String(row.storage_path || ''), bucket: String(row.bucket_name || 'order-images') })) : [],
    history: Array.isArray(history) ? history.map((row) => String(row.id)) : [],
  };
}

async function deleteOrderArtifactsByOrderId(orderId) {
  // First, clean Storage objects for this order's images
  const storagePaths = await findOrderStoragePaths(orderId);
  const storageErrors = [];
  for (const s of storagePaths) {
    try {
      await deleteStorageObject(s.bucket, s.path);
    } catch (e) {
      storageErrors.push(`Storage ${s.bucket}/${s.path}: ${e.message}`);
    }
  }

  // Then remove DB records
  const errors = [];
  for (const { endpoint } of [
    { endpoint: `/rest/v1/status_history?order_id=eq.${encodeURIComponent(orderId)}` },
    { endpoint: `/rest/v1/order_images?order_id=eq.${encodeURIComponent(orderId)}` },
    { endpoint: `/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}` },
    { endpoint: `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}` },
  ]) {
    try {
      await supabaseRest(endpoint, { method: 'DELETE' });
    } catch (e) {
      errors.push(`${endpoint}: ${e.message}`);
    }
  }

  const allErrors = [...storageErrors, ...errors];
  if (allErrors.length) {
    throw new Error(`Cleanup errors for order ${orderId}: ${allErrors.join('; ')}`);
  }
}

async function purgeDisposableUser(userId, email, marker, orders) {
  assertLiveCrudEnabled();
  if (!userId) throw new Error('Disposable user id required.');
  if (!email || !hasMarker(email, marker)) throw new Error('Disposable user email missing marker.');
  if (!marker) throw new Error('Correlation marker required.');

  // Load orders if not provided
  const userOrders = orders || await findOrdersByRequesterId(userId);

  // Delete all order artifacts (including Storage objects)
  for (const order of userOrders) {
    await deleteOrderArtifactsByOrderId(order.id);
  }

  // Delete user_stores, audit_logs, profile
  const errors = [];
  for (const endpoint of [
    `/rest/v1/user_stores?user_id=eq.${encodeURIComponent(userId)}`,
    `/rest/v1/audit_logs?user_id=eq.${encodeURIComponent(userId)}`,
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
  ]) {
    try {
      await supabaseRest(endpoint, { method: 'DELETE' });
    } catch (e) {
      errors.push(`${endpoint}: ${e.message}`);
    }
  }

  // Delete Auth user last
  try {
    await supabaseRest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
    });
  } catch (e) {
    errors.push(`auth delete: ${e.message}`);
  }

  if (errors.length) {
    throw new Error(`Cleanup errors for user ${userId}: ${errors.join('; ')}`);
  }
}

async function verifyCleanup(userId, email, marker) {
  // Verify profile gone
  const profileCheck = await supabaseRest(`/rest/v1/profiles?select=id&id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET',
  }).catch(() => null);
  const profileRows = Array.isArray(profileCheck) ? profileCheck : [];
  if (profileRows.length > 0) {
    throw new Error(`Cleanup verification failed: profile still exists for ${email}`);
  }

  // Verify Auth user gone
  const svcKey = getServiceRoleKey();
  const authCheck = await fetch(`${getSupabaseBaseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
    },
  }).catch(() => null);
  if (authCheck && authCheck.ok) {
    throw new Error(`Cleanup verification failed: Auth user still exists for ${email}`);
  }

  // Verify no orders
  const orderCheck = await supabaseRest(`/rest/v1/orders?select=id&requester_id=eq.${encodeURIComponent(userId)}`, {
    method: 'GET',
  }).catch(() => null);
  const orderRows = Array.isArray(orderCheck) ? orderCheck : [];
  if (orderRows.length > 0) {
    throw new Error(`Cleanup verification failed: ${orderRows.length} orders remain for ${email}`);
  }
}

async function createOrderViaRpc(token, storeId, marker) {
  const anonKey = getAnonKey();
  const svcUrl = getSupabaseBaseUrl();

  const resp = await fetch(`${svcUrl}/rest/v1/rpc/create_order`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_brand: 'E2E',
      p_store: '',
      p_cost_center: '',
      p_purpose: `E2E removal test ${marker}`,
      p_justification: 'Test order for E2E removal validation',
      p_priority: 'NORMAL',
      p_notes: `marker:${marker}`,
      p_store_id: storeId,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`create_order failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const order = await resp.json();
  if (!order || !order.id) {
    throw new Error('create_order returned no order');
  }
  return order;
}

async function createOrderItemViaRpc(token, orderId, productCode) {
  const svcKey = getServiceRoleKey();
  const svcUrl = getSupabaseBaseUrl();

  // Use service role to bypass RLS for fixture creation
  const resp = await fetch(`${svcUrl}/rest/v1/order_items`, {
    method: 'POST',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      order_id: orderId,
      product_code: productCode || 'SKU-E2E-001',
      description: 'E2E removal test item',
      quantity: 1,
      unit: 'un',
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`create order_item failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const items = await resp.json();
  const item = Array.isArray(items) ? items[0] : items;
  if (!item || !item.id) {
    throw new Error('create order_item returned no item');
  }
  return item;
}

async function createStorageObject(token, bucket, path, marker) {
  const svcKey = getServiceRoleKey();
  const svcUrl = getSupabaseBaseUrl();
  const content = Buffer.from(`fake-image-${marker}`);

  // Use service role to bypass Storage RLS for fixture creation
  const resp = await fetch(`${svcUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'false',
    },
    body: content,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Storage upload failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  return { bucket, path, size: content.length };
}

async function createOrderImageMetadata(token, orderId, storagePath, marker, requesterId) {
  const svcKey = getServiceRoleKey();
  const svcUrl = getSupabaseBaseUrl();
  const anonKey = getAnonKey();

  const fileHash = crypto.createHash('sha256').update(`fake-image-${marker}`).digest('hex');

  // Use service role to bypass RLS for fixture creation
  const authHeader = requesterId ? `Bearer ${svcKey}` : `Bearer ${token}`;
  const apiKey = requesterId ? svcKey : anonKey;

  const resp = await fetch(`${svcUrl}/rest/v1/order_images`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      order_id: orderId,
      order_item_id: null,
      uploaded_by_id: requesterId || '', // service role sets it; RLS expects auth.uid()
      original_filename: 'e2e-test.jpg',
      storage_path: storagePath,
      bucket_name: 'order-images',
      mime_type: 'image/jpeg',
      file_size: 100,
      file_hash: fileHash,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`create order_image failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  const images = await resp.json();
  const img = Array.isArray(images) ? images[0] : images;
  if (!img || !img.id) {
    throw new Error('create order_image returned no image');
  }
  return img;
}

async function getStoreIdForRequester(token) {
  const anonKey = getAnonKey();
  const svcUrl = getSupabaseBaseUrl();

  // Get first active store
  const resp = await fetch(`${svcUrl}/rest/v1/lojas?select=id,nome,ativo&ativo=eq.true&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!resp.ok) throw new Error(`Failed to fetch stores: HTTP ${resp.status}`);
  const stores = await resp.json();
  if (!Array.isArray(stores) || stores.length === 0) throw new Error('No active stores found');
  return stores[0].id;
}

async function assignStoreToUser(token, userId, storeId) {
  const svcKey = getServiceRoleKey();
  const svcUrl = getSupabaseBaseUrl();

  const resp = await fetch(`${svcUrl}/rest/v1/user_stores`, {
    method: 'POST',
    headers: {
      apikey: svcKey,
      Authorization: `Bearer ${svcKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: userId, store_id: storeId }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`assignStore failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
}

async function loginAndGetToken(email, password) {
  const anonKey = getAnonKey();
  const svcUrl = getSupabaseBaseUrl();

  const resp = await fetch(`${svcUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await resp.json();
  return {
    status: resp.status,
    ok: resp.ok,
    accessToken: data.access_token || '',
    refreshToken: data.refresh_token || '',
    user: data.user || null,
    error: data.error || null,
    errorDescription: data.error_description || null,
  };
}

module.exports = {
  assertDisposableIdentity,
  assertLiveCrudEnabled,
  assignStoreToUser,
  buildCorrelationMarker,
  buildDisposableEmail,
  createDisposableUserDirect,
  createOrderImageMetadata,
  createOrderItemViaRpc,
  createOrderViaRpc,
  createStorageObject,
  deleteDisposableUser,
  deleteOrderArtifactsByOrderId,
  fetchActiveStores,
  findOrderArtifactsByOrderId,
  findOrderStoragePaths,
  getStoreIdForRequester,
  loginAndGetToken,
  supabaseRest,
  purgeDisposableUser,
  verifyCleanup,
  getBaseUrl,
  getDisposableUserRecord,
  getSupabaseBaseUrl,
  getTestEmailDomain,
  getServiceRoleKey,
  getAnonKey,
  getUserStoreAssignments,
  unlinkDisposableUserStores,
  updateDisposableUser,
};
