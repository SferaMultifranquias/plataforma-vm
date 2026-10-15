import { AdminError, createJsonError } from './admin-core.js';
import {
  normalizeRole, normalizePersistedRole, normalizeEmail, normalizeName,
  normalizeBoolean, normalizeStoreIds, normalizeStatus, normalizeStore,
  normalizeProfile, normalizeCreatedUserDto, normalizeSavedUserDto,
  buildMergedUsers, normalizeRoleFilter, normalizeStatusFilter,
  matchesSearch, matchesStore, computeSummary,
} from './admin-core.js';
import { getEnvValue } from './env.js';

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let password = '';
  for (let i = 0; i < bytes.length; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}

function createServiceUnavailableError(details) {
  return new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED',
    'O serviço administrativo não está configurado.', details || null);
}

export function createPagesAdminService(options) {
  const env = options?.env || {};
  const fetchImpl = options?.fetch || globalThis.fetch;
  let cachedConfig = null;
  let supabaseUrl = '';
  let anonKey = '';
  let serviceRoleKey = '';

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch global indisponivel para o servico administrativo.');
  }

  function readConfig() {
    const u = getEnvValue(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL']);
    const a = getEnvValue(env, ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']);
    const s = getEnvValue(env, ['SUPABASE_SERVICE_ROLE_KEY']);
    return { supabaseUrl: u, anonKey: a, serviceRoleKey: s, configured: Boolean(u && a && s) };
  }

  function assertConfigured() {
    if (cachedConfig) {
      supabaseUrl = cachedConfig.supabaseUrl;
      anonKey = cachedConfig.anonKey;
      serviceRoleKey = cachedConfig.serviceRoleKey;
      return cachedConfig;
    }
    const config = readConfig();
    if (!config.configured) throw createServiceUnavailableError();
    cachedConfig = config;
    supabaseUrl = config.supabaseUrl;
    anonKey = config.anonKey;
    serviceRoleKey = config.serviceRoleKey;
    return cachedConfig;
  }

  async function requestJson(url, init) {
    const response = await fetchImpl(url, init);
    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch (_) { data = { raw }; }
    }
    if (!response.ok) {
      const message = data.message || data.msg || data.error_description || data.error || `HTTP ${response.status}`;
      const code = data.code || data.error || 'request_failed';
      throw createJsonError(response.status, code, message, data);
    }
    return data;
  }

  async function requestJsonAllowNotFound(url, init) {
    try { return await requestJson(url, init); } catch (error) {
      if (error instanceof AdminError && (error.status === 404 || error.status === 405)) return null;
      throw error;
    }
  }

  function authHeaders(token) {
    return { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }

  function serviceHeaders() {
    return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' };
  }

  function serviceJsonHeaders() {
    return { ...serviceHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' };
  }

  function callerAuthHeaders(token) {
    return { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  async function validateAccessToken(token) {
    assertConfigured();
    if (!token) throw createJsonError(401, 'missing_token', 'Token de acesso ausente.');
    const user = await requestJson(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders(token), method: 'GET' });
    if (!user || !user.id) throw createJsonError(401, 'invalid_token', 'Token de acesso inválido.');
    return user;
  }

  async function loadCallerProfile(userId) {
    assertConfigured();
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('select', 'id,name,email,role,is_active,removed_at,removed_by_id,created_at,updated_at');
    url.searchParams.set('id', `eq.${userId}`);
    url.searchParams.set('limit', '1');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) && rows.length ? normalizeProfile(rows[0]) : null;
  }

  async function assertActiveAdmin(token) {
    assertConfigured();
    const authUser = await validateAccessToken(token);
    const profile = await loadCallerProfile(authUser.id);
    if (!profile) throw createJsonError(403, 'profile_missing', 'Perfil administrativo não encontrado.');
    if (!profile.active) throw createJsonError(403, 'inactive_admin', 'Administradores inativos não podem acessar este endpoint.');
    if (profile.role !== 'admin') throw createJsonError(403, 'forbidden', 'Acesso administrativo obrigatório.');
    return { authUser, profile };
  }

  async function fetchAllProfiles() {
    assertConfigured();
    const rows = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const url = new URL('/rest/v1/profiles', supabaseUrl);
      url.searchParams.set('select', 'id,name,email,role,is_active,removed_at,removed_by_id,created_at,updated_at');
      url.searchParams.set('order', 'created_at.desc');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      const batch = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
      const items = Array.isArray(batch) ? batch : [];
      rows.push(...items.map(normalizeProfile));
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  async function fetchAllAuthUsers() {
    assertConfigured();
    const users = [];
    const pageSize = 1000;
    let page = 1;
    while (true) {
      const url = new URL('/auth/v1/admin/users', supabaseUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(pageSize));
      const payload = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
      const batch = Array.isArray(payload.users) ? payload.users : [];
      users.push(...batch);
      if (batch.length < pageSize) break;
      page += 1;
    }
    return users;
  }

  async function findAuthUserByEmail(email) {
    assertConfigured();
    const target = normalizeEmail(email);
    const users = await fetchAllAuthUsers();
    return users.find((u) => normalizeEmail(u.email) === target) || null;
  }

  async function fetchAllUserStores() {
    assertConfigured();
    const rows = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const url = new URL('/rest/v1/user_stores', supabaseUrl);
      url.searchParams.set('select', 'user_id,store_id,created_at');
      url.searchParams.set('order', 'user_id.asc');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      const batch = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
      const items = Array.isArray(batch) ? batch : [];
      rows.push(...items);
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  async function fetchStores() {
    assertConfigured();
    const rows = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const url = new URL('/rest/v1/lojas', supabaseUrl);
      url.searchParams.set('select', 'id,nome,codigo');
      url.searchParams.set('order', 'nome.asc');
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      const batch = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
      const items = Array.isArray(batch) ? batch : [];
      rows.push(...items.map(normalizeStore));
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  async function fetchStoresByIds(storeIds) {
    assertConfigured();
    const ids = normalizeStoreIds(storeIds);
    if (!ids.length) return [];
    const url = new URL('/rest/v1/lojas', supabaseUrl);
    url.searchParams.set('select', 'id,nome,codigo');
    url.searchParams.set('id', `in.(${ids.join(',')})`);
    url.searchParams.set('order', 'id.asc');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    const items = Array.isArray(rows) ? rows.map(normalizeStore) : [];
    if (items.length !== ids.length) throw createJsonError(400, 'INVALID_STORE', 'Uma das lojas selecionadas nao esta disponivel.');
    const available = new Set(items.map((item) => Number(item.id)));
    for (const id of ids) {
      if (!available.has(id)) throw createJsonError(400, 'INVALID_STORE', 'Uma das lojas selecionadas nao esta disponivel.');
    }
    const byId = new Map(items.map((item) => [Number(item.id), item]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  // ponytail: text codes in in.(...) — safe for typical alphanumeric store codes
  async function fetchStoresByCodes(codes) {
    assertConfigured();
    const valid = Array.isArray(codes) ? codes.filter(Boolean).map((c) => String(c).trim()) : [];
    if (!valid.length) return new Map();
    const url = new URL('/rest/v1/lojas', supabaseUrl);
    url.searchParams.set('select', 'id,nome,codigo');
    url.searchParams.set('codigo', `in.(${valid.join(',')})`);
    url.searchParams.set('order', 'codigo.asc');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    const items = Array.isArray(rows) ? rows.map(normalizeStore) : [];
    const byCode = new Map(items.map((s) => [String(s.codigo), s]));
    return byCode;
  }

  async function fetchProfileById(profileId) {
    assertConfigured();
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('select', 'id,name,email,role,is_active,removed_at,removed_by_id,created_at,updated_at');
    url.searchParams.set('id', `eq.${profileId}`);
    url.searchParams.set('limit', '1');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function fetchProfileByEmail(email) {
    assertConfigured();
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('select', 'id,name,email,role,is_active,removed_at,removed_by_id,created_at,updated_at');
    url.searchParams.set('email', `eq.${email}`);
    url.searchParams.set('limit', '1');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function fetchAuthUserById(authUserId) {
    assertConfigured();
    if (!authUserId) return null;
    const users = await fetchAllAuthUsers();
    return users.find((u) => String(u.id) === String(authUserId)) || null;
  }

  async function createAuthUser(payload) {
    assertConfigured();
    const body = {
      email: payload.email, email_confirm: true, password: payload.password,
      app_metadata: { is_active: payload.isActive, role: payload.role },
      user_metadata: { full_name: payload.name, name: payload.name, is_active: payload.isActive, role: payload.role },
    };
    const response = await requestJson(`${supabaseUrl}/auth/v1/admin/users`, {
      body: JSON.stringify(body), headers: serviceJsonHeaders(), method: 'POST',
    });
    return response && (response.user || response.data?.user || response);
  }

  async function insertProfile(profile) {
    assertConfigured();
    return requestJson(`${supabaseUrl}/rest/v1/profiles`, {
      body: JSON.stringify([profile]), headers: serviceJsonHeaders(), method: 'POST',
    });
  }

  async function patchProfileById(profile) {
    assertConfigured();
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('id', `eq.${profile.id}`);
    const response = await fetchImpl(url.toString(), {
      body: JSON.stringify({
        created_at: profile.created_at, email: profile.email, id: profile.id,
        is_active: profile.is_active, name: profile.name, role: profile.role, updated_at: profile.updated_at,
      }),
      headers: { ...serviceJsonHeaders(), Prefer: 'return=representation' },
      method: 'PATCH',
    });
    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) { try { data = JSON.parse(raw); } catch (_) { data = { raw }; } }
    if (response.ok) return data;
    const message = data.message || data.msg || data.error_description || data.error || `HTTP ${response.status}`;
    throw createJsonError(response.status, data.code || data.error || 'profile_patch_failed', message, data);
  }

  async function saveProfile(profile) {
    const existing = await fetchProfileById(profile.id);
    if (existing) {
      const patched = await patchProfileById(profile);
      return Array.isArray(patched) && patched.length ? patched[0] : profile;
    }
    try {
      const inserted = await insertProfile(profile);
      return Array.isArray(inserted) && inserted.length ? inserted[0] : profile;
    } catch (error) {
      if (error instanceof AdminError && error.status === 409) {
        const patched = await patchProfileById(profile);
        return Array.isArray(patched) && patched.length ? patched[0] : profile;
      }
      throw error;
    }
  }

  async function updateAuthUserById(authUserId, payload) {
    assertConfigured();
    const body = {
      app_metadata: { role: payload.role, is_active: payload.isActive },
      email: payload.email, email_confirm: true,
      user_metadata: { full_name: payload.name, name: payload.name, is_active: payload.isActive, role: payload.role },
    };
    if (payload.password) body.password = payload.password;
    const response = await requestJson(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      body: JSON.stringify(body), headers: serviceJsonHeaders(), method: 'PUT',
    });
    return response && (response.user || response.data?.user || response);
  }

  async function deleteAuthUser(authUserId) {
    assertConfigured();
    if (!authUserId) return;
    await requestJson(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      headers: serviceHeaders(), method: 'DELETE',
    });
  }

  async function deleteProfileById(profileId) {
    assertConfigured();
    if (!profileId) return;
    const url = new URL('/rest/v1/profiles', supabaseUrl);
    url.searchParams.set('id', `eq.${profileId}`);
    await requestJson(url.toString(), { headers: serviceHeaders(), method: 'DELETE' });
  }

  async function deleteUserStoresByUserId(userId) {
    assertConfigured();
    if (!userId) return;
    const url = new URL('/rest/v1/user_stores', supabaseUrl);
    url.searchParams.set('user_id', `eq.${userId}`);
    await requestJson(url.toString(), { headers: serviceHeaders(), method: 'DELETE' });
  }

  async function insertUserStores(userId, storeIds) {
    const ids = normalizeStoreIds(storeIds);
    if (!ids.length) return [];
    const rows = ids.map((storeId) => ({ store_id: storeId, user_id: userId }));
    return requestJson(`${supabaseUrl}/rest/v1/user_stores`, {
      body: JSON.stringify(rows), headers: serviceJsonHeaders(), method: 'POST',
    });
  }

  async function insertAuditLog(entry) {
    return requestJson(`${supabaseUrl}/rest/v1/audit_logs`, {
      body: JSON.stringify([entry]), headers: serviceJsonHeaders(), method: 'POST',
    });
  }

  async function disableAuthUser(authUserId) {
    assertConfigured();
    if (!authUserId) return null;
    try {
      return await requestJson(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
        body: JSON.stringify({
          app_metadata: { is_active: false, role: 'USER' },
          ban_duration: '876000h',
          user_metadata: { is_active: false, role: 'USER' },
        }),
        headers: serviceJsonHeaders(), method: 'PUT',
      });
    } catch (error) {
      if (error instanceof AdminError && (error.status === 404 || error.status === 422)) return null;
      throw error;
    }
  }

  async function callAdminRemoveUserProfileRpc(targetUserId, callerId) {
    assertConfigured();
    const url = `${supabaseUrl}/rest/v1/rpc/admin_remove_user_profile`;
    return requestJson(url, {
      body: JSON.stringify({ p_target_id: targetUserId, p_caller_id: callerId }),
      headers: serviceJsonHeaders(), method: 'POST',
    });
  }

  function exportUserDto(user) {
    return {
      id: user.id, name: user.name, email: user.email, role: user.role,
      status: user.status, active: user.active,
      stores: (user.stores || []).map(normalizeStore),
      createdAt: user.createdAt, lastSignInAt: user.lastSignInAt, removedAt: user.removedAt,
    };
  }

  async function exportUsers(query, caller) {
    assertConfigured();
    const callerToken = caller?.accessToken || '';
    const role = normalizeRoleFilter(query?.role);
    const status = normalizeStatusFilter(query?.status);
    const search = String(query?.search || '').trim().toLowerCase();
    const storeId = String(query?.storeId || '').trim();
    const [profiles, authUsers, userStores, stores] = await Promise.all([
      fetchAllProfiles(), fetchAllAuthUsers(), fetchAllUserStores(), fetchStores(),
    ]);
    let users = buildMergedUsers(profiles, authUsers, userStores, stores);
    users = users.filter((u) => {
      if (search && !matchesSearch(u, search)) return false;
      if (role && u.role !== role) return false;
      if (status && u.status !== status) return false;
      if (!status && u.status === 'removed') return false;
      if (storeId && !matchesStore(u, storeId)) return false;
      return true;
    });
    return users.map(exportUserDto);
  }

  const IMPORT_MAX_ROWS = 200;

  function validateImportRow(row) {
    const errors = [];
    const rawName = normalizeName(row?.nome || row?.name || row?.Nome);
    const rawEmail = normalizeEmail(row?.email || row?.['e-mail'] || row?.Email || row?.E_mail);
    const rawRole = normalizeName(row?.perfil || row?.role || row?.Role || row?.Perfil);
    const rawStatus = normalizeName(row?.status || row?.Status);
    const rawStores = normalizeName(row?.lojas || row?.stores || row?.Lojas || row?.Stores);

    if (!rawName) errors.push({ field: 'name', message: 'Nome obrigatorio.' });
    else if (rawName.length > 120) errors.push({ field: 'name', message: 'Nome excede 120 caracteres.' });

    if (!rawEmail) errors.push({ field: 'email', message: 'E-mail obrigatorio.' });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) errors.push({ field: 'email', message: 'E-mail invalido.' });

    let resolvedRole = 'USER';
    const rl = rawRole.toLowerCase();
    if (rl === 'admin' || rl === 'administrador') resolvedRole = 'ADMIN';
    else if (rl === 'loja' || rl === 'user') resolvedRole = 'USER';
    else if (!rawRole) errors.push({ field: 'role', message: 'Perfil obrigatorio.' });
    else errors.push({ field: 'role', message: `Perfil invalido: '${rawRole}'. Use ADMIN ou Loja.` });

    const isActive = normalizeBoolean(rawStatus, true);
    if (rawStatus && !/^(active|ativo|blocked|bloqueado|true|false|1|0|yes|no|sim|nao|não|on|off)$/i.test(rawStatus)) {
      errors.push({ field: 'status', message: `Status invalido: '${rawStatus}'.` });
    }

    const storeCodes = [];
    if (rawStores) {
      const parts = rawStores.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part) storeCodes.push(part);
      }
    }

    if (resolvedRole === 'USER' && !storeCodes.length) {
      errors.push({ field: 'stores', message: 'Perfil Loja exige ao menos uma loja.' });
    }

    return {
      row: { name: rawName, email: rawEmail, role: resolvedRole, isActive, storeCodes },
      errors, valid: !errors.length, original: row,
    };
  }

  async function fetchExistingEmails(emails) {
    if (!emails.length) return new Map();
    const results = await Promise.allSettled(emails.map((e) => Promise.all([fetchProfileByEmail(e), findAuthUserByEmail(e)])));
    const map = new Map();
    emails.forEach((email, idx) => {
      const r = results[idx];
      if (r.status === 'fulfilled') {
        const [profile, authUser] = r.value;
        if (profile || authUser) map.set(email, true);
      }
    });
    return map;
  }

  async function validateImport(rows, caller) {
    assertConfigured();
    if (!Array.isArray(rows) || !rows.length) throw createJsonError(400, 'EMPTY_IMPORT', 'Nenhum usuario para importar.');
    if (rows.length > IMPORT_MAX_ROWS) throw createJsonError(400, 'TOO_MANY_ROWS', `Maximo de ${IMPORT_MAX_ROWS} usuarios por importacao.`);

    const validated = rows.map(validateImportRow);
    const validRows = validated.filter((r) => r.valid).map((r) => r.row);

    const fileEmails = new Map();
    for (const vr of validated) {
      if (!vr.valid) continue;
      const email = vr.row.email;
      fileEmails.set(email, (fileEmails.get(email) || 0) + 1);
    }
    for (const vr of validated) {
      if (!vr.valid) continue;
      if (fileEmails.get(vr.row.email) > 1) {
        vr.valid = false;
        vr.errors.push({ field: 'email', message: 'E-mail duplicado no arquivo.' });
      }
    }

    const existing = await fetchExistingEmails(validRows.map((r) => r.email));
    for (const vr of validated) {
      if (!vr.valid) continue;
      if (existing.has(vr.row.email)) {
        vr.valid = false;
        vr.errors.push({ field: 'email', message: 'E-mail ja cadastrado.' });
      }
    }

    const allCodes = [];
    for (const vr of validated) {
      if (!vr.valid) continue;
      if (vr.row.storeCodes.length) allCodes.push(...vr.row.storeCodes);
    }
    let storeMap = new Map();
    if (allCodes.length) {
      try {
        storeMap = await fetchStoresByCodes([...new Set(allCodes)]);
      } catch (_) {}
    }
    for (const vr of validated) {
      if (!vr.valid) continue;
      const codes = vr.row.storeCodes;
      const resolved = [];
      for (const code of codes) {
        const store = storeMap.get(code);
        if (store) {
          resolved.push(Number(store.id));
        } else {
          vr.valid = false;
          vr.errors.push({ field: 'stores', message: `Loja codigo '${code}' nao encontrada.` });
        }
      }
      vr.row.storeIds = resolved;
    }

    return {
      total: validated.length,
      valid: validated.filter((r) => r.valid).map((r) => r.row),
      invalid: validated.filter((r) => !r.valid),
      validCount: validated.filter((r) => r.valid).length,
      invalidCount: validated.filter((r) => !r.valid).length,
    };
  }

  async function importUsers(importRows, caller) {
    assertConfigured();
    const callerIdentity = { authUser: { id: caller?.authUser?.id || '' } };
    const validation = await validateImport(importRows, caller);
    const results = [];
    for (const row of validation.valid) {
      try {
        const created = await createUser(row, callerIdentity);
        results.push({ email: row.email, name: row.name, status: 'created', temporaryPassword: created.temporaryPassword });
      } catch (error) {
        const code = error instanceof AdminError ? error.code : 'UNKNOWN';
        results.push({ email: row.email, name: row.name, status: 'failed', errorCode: code, errorMessage: error.message || 'Erro interno.' });
      }
    }
    for (const invalid of validation.invalid) {
      results.push({
        email: invalid.row.email || '', name: invalid.row.name || '', status: 'skipped',
        errors: invalid.errors.map((e) => e.message),
      });
    }
    return {
      total: results.length, created: results.filter((r) => r.status === 'created').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length, results,
    };
  }

  async function listUsers(query) {
    assertConfigured();
    const pageSizeRaw = Number(query?.pageSize) || 20;
    const pageSize = Math.max(1, Math.min(100, pageSizeRaw));
    const requestedPage = Math.max(1, Number(query?.page) || 1);
    const search = String(query?.search || '').trim().toLowerCase();
    const role = normalizeRoleFilter(query?.role);
    const status = normalizeStatusFilter(query?.status);
    const storeId = String(query?.storeId || '').trim();

    const [profiles, authUsers, userStores, stores] = await Promise.all([
      fetchAllProfiles(), fetchAllAuthUsers(), fetchAllUserStores(), fetchStores(),
    ]);

    let users = buildMergedUsers(profiles, authUsers, userStores, stores);
    users = users.filter((u) => {
      if (search && !matchesSearch(u, search)) return false;
      if (role && u.role !== role) return false;
      if (status && u.status !== status) return false;
      if (!status && u.status === 'removed') return false;
      if (storeId && !matchesStore(u, storeId)) return false;
      return true;
    });
    users.sort((a, b) => {
      const left = new Date(b.createdAt || 0).getTime();
      const right = new Date(a.createdAt || 0).getTime();
      if (left !== right) return left - right;
      return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    });
    const summary = computeSummary(users);
    const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;
    const items = users.slice(start, start + pageSize);
    return { items, page, pageSize, stores, summary, total: users.length, totalPages };
  }

  async function createUser(input, caller) {
    assertConfigured();
    const performedBy = caller?.authUser?.id || null;
    const normalizedName = normalizeName(input?.name);
    const normalizedEmail = normalizeEmail(input?.email);
    const persistedRole = normalizePersistedRole(input?.role);
    const isActive = normalizeBoolean(input?.isActive, true);
    const storeIds = normalizeStoreIds(input?.storeIds);
    const temporaryPassword = generateTemporaryPassword();

    if (!normalizedName) throw createJsonError(400, 'INVALID_NAME', 'Nome completo obrigatorio.');
    if (normalizedName.length > 120) throw createJsonError(400, 'INVALID_NAME', 'Nome completo excede o limite permitido.');
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw createJsonError(400, 'INVALID_EMAIL', 'E-mail invalido.');
    if (persistedRole === 'USER' && !storeIds.length) throw createJsonError(400, 'STORE_REQUIRED', 'Selecione pelo menos uma loja para o perfil Loja.');

    const [profileByEmail, authUserByEmail] = await Promise.all([
      fetchProfileByEmail(normalizedEmail), findAuthUserByEmail(normalizedEmail),
    ]);
    if (profileByEmail || authUserByEmail) throw createJsonError(409, 'EMAIL_ALREADY_EXISTS', 'Ja existe um usuario cadastrado com este e-mail.');

    const selectedStores = await fetchStoresByIds(storeIds);
    let createdProfile = null;
    let createdStores = [];
    let authUserId = null;

    try {
      const authUser = await createAuthUser({ email: normalizedEmail, name: normalizedName, password: temporaryPassword, role: persistedRole });
      authUserId = authUser?.id || null;
      if (!authUserId) throw createJsonError(500, 'AUTH_USER_CREATE_FAILED', 'Nao foi possivel obter o usuario criado no Auth.');

      const profilePayload = {
        created_at: new Date().toISOString(), email: normalizedEmail, id: authUserId,
        is_active: isActive, name: normalizedName, role: persistedRole, updated_at: new Date().toISOString(),
      };
      createdProfile = await saveProfile(profilePayload);
      if (selectedStores.length) {
        await insertUserStores(authUserId, selectedStores.map((s) => s.id));
        createdStores = selectedStores;
      }

      try {
        await insertAuditLog({
          action: 'USER_CREATED', entity: 'profiles', entity_id: authUserId,
          new_data: {
            active: isActive, email: normalizedEmail, performed_by: performedBy, role: persistedRole,
            store_ids: selectedStores.map((s) => s.id), store_count: selectedStores.length, temporary_password_generated: true,
          },
          user_id: performedBy,
        });
      } catch (auditError) {
        await Promise.allSettled([deleteProfileById(authUserId), deleteAuthUser(authUserId)]);
        throw createJsonError(500, 'MANUAL_RECOVERY_REQUIRED', 'O cadastro nao foi concluido. Verifique os logs administrativos.', auditError);
      }
    } catch (error) {
      if (authUserId) await Promise.allSettled([deleteProfileById(authUserId), deleteAuthUser(authUserId)]);
      if (error instanceof AdminError && error.status === 429) {
        throw createJsonError(429, 'RATE_LIMITED', 'Ação temporariamente limitada. Aguarde alguns minutos e tente novamente.', error.details);
      }
      if (error instanceof AdminError) throw error;
      throw createJsonError(500, 'USER_CREATE_FAILED', 'Nao foi possivel concluir a criacao do usuario.', error);
    }
    return normalizeCreatedUserDto(createdProfile, createdStores, temporaryPassword);
  }

  async function updateUser(userId, input, caller) {
    assertConfigured();
    const performedBy = caller?.authUser?.id || null;
    const normalizedId = normalizeName(userId);
    const normalizedName = normalizeName(input?.name);
    const normalizedEmail = normalizeEmail(input?.email);
    const persistedRole = normalizePersistedRole(input?.role);
    const isActive = normalizeBoolean(input?.isActive, true);
    const storeIds = normalizeStoreIds(input?.storeIds);
    const temporaryPassword = normalizeName(input?.password);

    if (!normalizedId) throw createJsonError(400, 'INVALID_USER', 'Usuario invalido.');
    if (!normalizedName) throw createJsonError(400, 'INVALID_NAME', 'Nome completo obrigatorio.');
    if (normalizedName.length > 120) throw createJsonError(400, 'INVALID_NAME', 'Nome completo excede o limite permitido.');
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw createJsonError(400, 'INVALID_EMAIL', 'E-mail invalido.');
    if (persistedRole === 'USER' && !storeIds.length) throw createJsonError(400, 'STORE_REQUIRED', 'Selecione pelo menos uma loja para o perfil Loja.');

    const [profileByEmail, authUserByEmail, currentAuthUser] = await Promise.all([
      fetchProfileByEmail(normalizedEmail), findAuthUserByEmail(normalizedEmail), fetchAuthUserById(normalizedId),
    ]);
    if (!currentAuthUser) throw createJsonError(404, 'USER_NOT_FOUND', 'Usuario nao encontrado.');
    const dupProfile = profileByEmail && String(profileByEmail.id) !== normalizedId;
    const dupAuth = authUserByEmail && String(authUserByEmail.id) !== normalizedId;
    if (dupProfile || dupAuth) throw createJsonError(409, 'EMAIL_ALREADY_EXISTS', 'Ja existe um usuario cadastrado com este e-mail.');

    const selectedStores = await fetchStoresByIds(storeIds);
    let savedProfile = null;
    let newPassword = '';

    try {
      const authUser = await updateAuthUserById(normalizedId, {
        email: normalizedEmail, isActive, name: normalizedName, password: temporaryPassword || '', role: persistedRole,
      });
      newPassword = temporaryPassword || '';
      if (!authUser?.id) throw createJsonError(500, 'AUTH_USER_UPDATE_FAILED', 'Nao foi possivel atualizar o usuario no Auth.');
      const profilePayload = {
        created_at: currentAuthUser.created_at || new Date().toISOString(), email: normalizedEmail, id: normalizedId,
        is_active: isActive, name: normalizedName, role: persistedRole, updated_at: new Date().toISOString(),
      };
      savedProfile = await saveProfile(profilePayload);
      await deleteUserStoresByUserId(normalizedId);
      if (selectedStores.length) await insertUserStores(normalizedId, selectedStores.map((s) => s.id));
      await insertAuditLog({
        action: 'USER_UPDATED', entity: 'profiles', entity_id: normalizedId,
        new_data: {
          active: isActive, email: normalizedEmail, performed_by: performedBy, role: persistedRole,
          store_ids: selectedStores.map((s) => s.id), store_count: selectedStores.length, password_updated: Boolean(temporaryPassword),
        },
        user_id: performedBy,
      });
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw createJsonError(500, 'USER_UPDATE_FAILED', 'Nao foi possivel atualizar o usuario.', error);
    }
    return normalizeSavedUserDto(savedProfile, selectedStores, newPassword);
  }

  async function removeUser(userId, caller, accessToken) {
    assertConfigured();
    const performedBy = caller?.authUser?.id || null;
    const normalizedId = normalizeName(userId);
    if (!normalizedId) throw createJsonError(400, 'INVALID_USER', 'Usuario invalido.');
    if (!performedBy) throw createJsonError(401, 'missing_caller', 'Caller identity required for RPC call.');

    let rpcResult;
    try {
      rpcResult = await callAdminRemoveUserProfileRpc(normalizedId, performedBy);
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw createJsonError(502, 'REMOVE_RPC_FAILED', 'Falha ao remover usuario.', error);
    }

    const alreadyRemoved = Boolean(rpcResult?.already_removed);
    if (alreadyRemoved) {
      return { removed: true, alreadyRemoved: true, id: normalizedId, removedAt: rpcResult.removed_at || null, removedById: rpcResult.removed_by_id || null };
    }

    let authDisableResult = 'ok';
    try {
      await disableAuthUser(normalizedId);
    } catch (error) {
      authDisableResult = 'failed';
      const message = error instanceof AdminError ? error.message : String(error);
      return {
        removed: true, alreadyRemoved: false, id: normalizedId,
        removedAt: rpcResult.removed_at || null, removedById: rpcResult.removed_by_id || null,
        authDisable: 'failed', authDisableError: message, partialFailure: true,
        message: 'Perfil removido, mas a desativacao da conta Auth falhou. Tente novamente.',
      };
    }
    return { removed: true, alreadyRemoved: false, id: normalizedId, removedAt: rpcResult.removed_at || null, removedById: rpcResult.removed_by_id || null, authDisable: authDisableResult, partialFailure: false };
  }

  function normalizeStockCheck(item) {
    return {
      id: item.id,
      orderId: item.order_id,
      orderItemId: item.order_item_id,
      storeId: Number(item.store_id),
      productCode: String(item.product_code || ''),
      description: String(item.description || ''),
      requestedQuantity: Number(item.requested_quantity),
      stockStatus: String(item.stock_status || 'pending_check'),
      availableQuantity: item.available_quantity != null ? Number(item.available_quantity) : null,
      checkedBy: item.checked_by || null,
      checkedAt: item.checked_at || null,
      notes: item.notes || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || null,
    };
  }

  async function listStockChecks(query) {
    assertConfigured();
    const url = new URL('/rest/v1/order_item_stock_checks', supabaseUrl);
    url.searchParams.set('select', 'id,order_id,order_item_id,store_id,product_code,description,requested_quantity,stock_status,available_quantity,checked_by,checked_at,notes,created_at,updated_at');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', '1000');
    if (query?.storeId) url.searchParams.set('store_id', `eq.${Number(query.storeId)}`);
    if (query?.orderId) url.searchParams.set('order_id', `eq.${query.orderId}`);
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    const items = Array.isArray(rows) ? rows.map(normalizeStockCheck) : [];
    return { items };
  }

  async function updateStockCheck(orderItemId, input, caller) {
    assertConfigured();
    const patch = {};
    if (input.stockStatus !== undefined) patch.stock_status = String(input.stockStatus).trim();
    if (input.availableQuantity !== undefined && input.availableQuantity !== null) patch.available_quantity = Number(input.availableQuantity);
    if (input.notes !== undefined) patch.notes = String(input.notes).trim();
    patch.checked_by = caller?.authUser?.id || '00000000-0000-0000-0000-000000000000';
    patch.checked_at = new Date().toISOString();

    const url = new URL('/rest/v1/order_item_stock_checks', supabaseUrl);
    url.searchParams.set('order_item_id', `eq.${orderItemId}`);

    const existing = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    const existingItem = Array.isArray(existing) && existing.length ? existing[0] : null;

    if (existingItem) {
      patch.updated_at = new Date().toISOString();
      const rows = await requestJson(url.toString(), { body: JSON.stringify(patch), headers: serviceJsonHeaders(), method: 'PATCH' });
      const updated = Array.isArray(rows) && rows.length ? rows[0] : rows;
      return normalizeStockCheck(updated || { ...existingItem, ...patch });
    }

    const orderItem = await findOrderItemById(orderItemId);
    if (!orderItem) throw createJsonError(404, 'ORDER_ITEM_NOT_FOUND', 'Item de pedido não encontrado.');

    const body = {
      order_id: orderItem.order_id,
      order_item_id: orderItemId,
      store_id: orderItem.store_id || 0,
      product_code: orderItem.product_code || '',
      description: orderItem.description || '',
      requested_quantity: Number(orderItem.quantity) || 0,
      stock_status: patch.stock_status || 'pending_check',
      available_quantity: patch.available_quantity || null,
      checked_by: patch.checked_by,
      checked_at: patch.checked_at,
      notes: patch.notes || null,
    };

    const rows = await requestJson(`${supabaseUrl}/rest/v1/order_item_stock_checks`, {
      body: JSON.stringify([body]),
      headers: serviceJsonHeaders(),
      method: 'POST',
    });
    const created = Array.isArray(rows) && rows.length ? rows[0] : rows;
    return normalizeStockCheck(created);
  }

  async function findOrderItemById(orderItemId) {
    assertConfigured();
    const url = new URL('/rest/v1/order_items', supabaseUrl);
    url.searchParams.set('select', 'id,order_id,store_id,product_code,description,quantity');
    url.searchParams.set('id', `eq.${orderItemId}`);
    url.searchParams.set('limit', '1');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function normalizeReceivedStock(item) {
    return {
      id: item.id,
      orderId: item.order_id,
      orderItemId: item.order_item_id,
      orderReceiptId: item.order_receipt_id || null,
      storeId: Number(item.store_id),
      productCode: String(item.product_code || ''),
      description: String(item.description || ''),
      receivedQuantity: Number(item.received_quantity),
      unit: String(item.unit || 'un'),
      receivedUnitValue: item.received_unit_value != null ? Number(item.received_unit_value) : null,
      receivedTotalValue: item.received_total_value != null ? Number(item.received_total_value) : null,
      invoiceNumber: item.order_receipts?.invoice_number || null,
      receivedBy: item.received_by,
      receivedAt: item.received_at || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || null,
      updatedBy: item.updated_by || null,
      voidedAt: item.voided_at || null,
      voidedBy: item.voided_by || null,
      voidReason: item.void_reason || null,
    };
  }

  async function listReceivedStock(query) {
    assertConfigured();
    const url = new URL('/rest/v1/store_stock_receipts', supabaseUrl);
    let selectFields = 'id,order_id,order_item_id,order_receipt_id,store_id,product_code,description,received_quantity,unit,received_unit_value,received_total_value,received_by,received_at,created_at,updated_at,updated_by,voided_at,voided_by,void_reason,order_receipts!store_stock_receipts_order_receipt_id_fkey(invoice_number)';
    url.searchParams.set('select', selectFields);
    url.searchParams.set('order', 'received_at.desc');
    url.searchParams.set('limit', '1000');
    if (query?.storeId) url.searchParams.set('store_id', `eq.${Number(query.storeId)}`);
    if (!query?.showVoided) url.searchParams.set('voided_at', 'is.null');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    const items = Array.isArray(rows) ? rows.map(normalizeReceivedStock) : [];
    return { items };
  }

  async function updateReceivedStock(receiptId, payload, caller, accessToken) {
    assertConfigured();
    const url = `${supabaseUrl}/rest/v1/rpc/admin_update_stock_receipt`;
    const body = {
      p_receipt_id: receiptId,
      p_product_code: String(payload.productCode || ''),
      p_description: String(payload.description || ''),
      p_received_quantity: Number(payload.receivedQuantity),
      p_unit: String(payload.unit || ''),
    };
    if (payload.receivedUnitValue !== undefined && payload.receivedUnitValue !== null) {
      body.p_received_unit_value = Number(payload.receivedUnitValue);
    }
    const result = await requestJson(url, {
      body: JSON.stringify(body),
      headers: callerAuthHeaders(accessToken),
      method: 'POST',
    });
    return normalizeReceivedStock(result);
  }

  async function voidReceivedStock(receiptId, reason, caller, accessToken) {
    assertConfigured();
    const url = `${supabaseUrl}/rest/v1/rpc/admin_void_stock_receipt`;
    const result = await requestJson(url, {
      body: JSON.stringify({
        p_receipt_id: receiptId,
        p_void_reason: String(reason || ''),
      }),
      headers: callerAuthHeaders(accessToken),
      method: 'POST',
    });
    return normalizeReceivedStock(result);
  }

  async function findOrderById(orderId) {
    assertConfigured();
    const url = new URL('/rest/v1/orders', supabaseUrl);
    url.searchParams.set('select', 'id,status,internal_number,store,requester_id,created_at');
    url.searchParams.set('id', `eq.${orderId}`);
    url.searchParams.set('limit', '1');
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function findOrderImagePaths(orderId) {
    assertConfigured();
    const url = new URL('/rest/v1/order_images', supabaseUrl);
    url.searchParams.set('select', 'storage_path');
    url.searchParams.set('order_id', `eq.${orderId}`);
    const rows = await requestJson(url.toString(), { headers: serviceHeaders(), method: 'GET' });
    return Array.isArray(rows) ? rows.map((r) => String(r.storage_path || '')).filter(Boolean) : [];
  }

  async function deleteStorageFiles(paths) {
    if (!paths.length) return { deleted: [], missing: [] };
    const result = await requestJson(`${supabaseUrl}/storage/v1/object/order-images`, {
      body: JSON.stringify({ prefixes: paths }), headers: serviceJsonHeaders(), method: 'DELETE',
    });
    const deleted = Array.isArray(result) ? result.map((r) => String(r.key || r.name || '')).filter(Boolean) : [];
    const missing = paths.filter((p) => !deleted.includes(p));
    return { deleted, missing };
  }

  async function callDeleteOrderRpc(orderId, callerToken) {
    assertConfigured();
    return requestJson(`${supabaseUrl}/rest/v1/rpc/delete_order`, {
      body: JSON.stringify({ p_order_id: orderId }), headers: callerAuthHeaders(callerToken), method: 'POST',
    });
  }

  async function verifyCallerPassword(caller, password) {
    assertConfigured();
    if (!caller?.authUser?.id || !caller?.authUser?.email) {
      throw createJsonError(403, 'forbidden', 'Caller identity required for password verification.');
    }
    if (!password?.trim()) throw createJsonError(400, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');

    try {
      const authResponse = await requestJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: caller.authUser.email, password }),
      });
      if (!authResponse?.user?.id) throw createJsonError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
      if (String(authResponse.user.id) !== String(caller.authUser.id)) throw createJsonError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    } catch (error) {
      if (error instanceof AdminError && error.code === 'INVALID_PASSWORD') throw error;
      throw createJsonError(401, 'INVALID_PASSWORD', 'Senha incorreta. O pedido não foi excluído.');
    }
  }

  async function deleteOrder(orderId, caller, accessToken) {
    assertConfigured();
    if (!caller?.authUser?.id || !caller?.profile) throw createJsonError(403, 'forbidden', 'Caller identity required.');
    if (caller.profile.role !== 'admin') throw createJsonError(403, 'forbidden', 'Admin access required.');

    const order = await findOrderById(orderId);
    if (!order) throw createJsonError(404, 'ORDER_NOT_FOUND', 'Order not found.');

    const storagePaths = await findOrderImagePaths(orderId);
    let storageResult = null;
    if (storagePaths.length) {
      try { storageResult = await deleteStorageFiles(storagePaths); } catch (storageError) {
        throw createJsonError(502, 'STORAGE_DELETE_FAILED', 'Falha ao limpar arquivos de armazenamento antes da exclusão do pedido.', storageError);
      }
    } else { storageResult = { deleted: [], missing: [] }; }

    let rpcResult;
    try { rpcResult = await callDeleteOrderRpc(orderId, accessToken); } catch (dbError) {
      const msg = dbError.message || String(dbError);
      if (dbError instanceof AdminError && (String(msg).includes('ORDER_NOT_FOUND') || String(msg).includes('not found'))) {
        return { ok: true, orderId, alreadyDeleted: true, deletedFiles: storageResult.deleted, missingFiles: storageResult.missing };
      }
      if (storageResult.deleted.length > 0) {
        return { ok: false, orderId, partialFailure: true, error: 'Arquivos do pedido foram removidos, mas a exclusão do banco de dados falhou.', deletedFiles: storageResult.deleted, missingFiles: storageResult.missing };
      }
      throw createJsonError(502, 'ORDER_DELETE_FAILED', 'Falha ao excluir o pedido.', dbError);
    }
    return { ok: true, orderId, deletedFiles: storageResult.deleted, missingFiles: storageResult.missing };
  }

  return {
    assertActiveAdmin, assertConfigured, createJsonError, listUsers, createUser, updateUser, removeUser,
    deleteOrder, verifyCallerPassword, findOrderById, normalizeRole, normalizePersistedRole,
    normalizeStatus, normalizeStore, normalizeEmail, normalizeName, normalizeBoolean, normalizeStoreIds,
    exportUsers, validateImport, importUsers,
    listStockChecks, updateStockCheck, listReceivedStock, updateReceivedStock, voidReceivedStock, findOrderItemById,
  };
}
