export class AdminError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

export function createJsonError(status, code, message, details) {
  return new AdminError(status, code, message, details);
}

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' ? 'admin' : 'loja';
}

export function normalizePersistedRole(role) {
  const value = String(role || '').trim().toUpperCase();
  if (value === 'ADMIN') return 'ADMIN';
  if (value === 'USER') return 'USER';
  throw createJsonError(400, 'INVALID_ROLE', 'Perfil invalido.');
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeName(value) {
  return String(value || '').trim();
}

export function normalizeBoolean(value, defaultValue) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const n = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim', 'on'].includes(n)) return true;
    if (['false', '0', 'no', 'nao', 'não', 'off'].includes(n)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return Boolean(defaultValue);
}

export function normalizeStoreIds(storeIds) {
  const values = Array.isArray(storeIds) ? storeIds : [];
  const normalized = [];
  const seen = new Set();
  for (const raw of values) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw createJsonError(400, 'INVALID_STORE', 'Uma das lojas selecionadas e invalida.');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function normalizeStatus(profile, authUser) {
  const active = profile && Object.prototype.hasOwnProperty.call(profile, 'active')
    ? profile.active !== false
    : profile?.is_active !== false;
  const removed = Boolean(profile?.removedAt);
  const invitePending = Boolean(
    authUser &&
      (authUser.invited_at || authUser.confirmation_sent_at) &&
      !authUser.email_confirmed_at &&
      !authUser.confirmed_at
  );
  if (removed) return 'removed';
  if (!active) return 'blocked';
  if (invitePending) return 'invited';
  return 'active';
}

export function normalizeStore(store) {
  return { id: store.id, name: store.nome || store.name || '', codigo: store.codigo || store.code || '' };
}

export function normalizeProfile(profile) {
  return {
    createdAt: profile.created_at || null,
    email: profile.email || '',
    id: profile.id,
    name: profile.name || '',
    role: normalizeRole(profile.role),
    updatedAt: profile.updated_at || null,
    active: profile.is_active !== false,
    removedAt: profile.removed_at || null,
    removedById: profile.removed_by_id || null,
  };
}

export function normalizeCreatedUserDto(profile, stores, temporaryPassword) {
  const np = normalizeProfile(profile);
  const linkedStores = Array.isArray(stores) ? stores.map(normalizeStore) : [];
  return {
    active: np.active,
    blocked: false,
    createdAt: np.createdAt,
    email: np.email,
    id: np.id,
    invitationSent: false,
    invitePending: false,
    lastSignInAt: null,
    name: np.name,
    role: np.role,
    status: 'active',
    temporaryPassword: String(temporaryPassword || ''),
    stores: linkedStores,
    updatedAt: np.updatedAt,
  };
}

export function normalizeSavedUserDto(profile, stores, temporaryPassword) {
  const dto = normalizeCreatedUserDto(profile, stores, temporaryPassword);
  dto.status = dto.active ? 'active' : 'blocked';
  dto.invitationSent = false;
  dto.invitePending = false;
  return dto;
}

export function buildMergedUsers(profiles, authUsers, userStores, stores) {
  const authById = new Map(authUsers.map((item) => [item.id, item]));
  const storesById = new Map(stores.map((item) => [String(item.id), item]));
  const linksByUser = new Map();
  for (const link of userStores) {
    const userId = String(link.user_id || '');
    if (!userId) continue;
    const current = linksByUser.get(userId) || [];
    current.push(String(link.store_id || ''));
    linksByUser.set(userId, current);
  }
  return profiles.map((profile) => {
    const authUser = authById.get(profile.id) || {};
    const linkedStoreIds = linksByUser.get(String(profile.id)) || [];
    const linkedStores = linkedStoreIds.map((sid) => storesById.get(String(sid))).filter(Boolean);
    const role = normalizeRole(profile.role || authUser.app_metadata?.role || authUser.user_metadata?.role);
    const active = profile.active !== false;
    const status = normalizeStatus(profile, authUser);
    return {
      active,
      blocked: !active,
      createdAt: profile.createdAt,
      email: profile.email || authUser.email || '',
      id: profile.id,
      invitePending: status === 'invited',
      lastSignInAt: authUser.last_sign_in_at || null,
      name: profile.name || authUser.user_metadata?.full_name || authUser.email || '',
      removedAt: profile.removedAt || null,
      role,
      status,
      stores: linkedStores,
      updatedAt: profile.updatedAt,
    };
  });
}

export function normalizeRoleFilter(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrador') return 'admin';
  if (value === 'loja' || value === 'user') return 'loja';
  return '';
}

export function normalizeStatusFilter(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['active', 'ativo'].includes(value)) return 'active';
  if (['blocked', 'bloqueado'].includes(value)) return 'blocked';
  if (['invited', 'convite_pendente', 'convite pendente'].includes(value)) return 'invited';
  if (['removed', 'removido'].includes(value)) return 'removed';
  return '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function sanitizeObject(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw createJsonError(400, 'INVALID_FIELD', 'Campo inválido detectado.');
    }
    if (allowedKeys.includes(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function matchesSearch(user, search) {
  if (!search) return true;
  const haystack = [user.name, user.email].map((v) => String(v || '').toLowerCase()).join(' ');
  return haystack.includes(search);
}

export function matchesStore(user, storeId) {
  if (!storeId) return true;
  return (user.stores || []).some((store) => String(store.id) === String(storeId));
}

export function computeSummary(users) {
  return {
    active: users.filter((u) => u.status === 'active').length,
    admin: users.filter((u) => u.role === 'admin').length,
    blocked: users.filter((u) => u.status === 'blocked').length,
    invited: users.filter((u) => u.status === 'invited').length,
    removed: users.filter((u) => u.status === 'removed').length,
    total: users.length,
  };
}
