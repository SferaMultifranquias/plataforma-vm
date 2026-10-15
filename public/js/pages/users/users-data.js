(function initUsersDataModule(global) {
  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeRole(role) {
    const normalized = normalizeText(role).toLowerCase();
    if (normalized === 'admin') return 'admin';
    return 'loja';
  }

  function normalizeStatus(status) {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'blocked') return 'blocked';
    if (normalized === 'invited') return 'invited';
    return 'active';
  }

  function normalizeStore(store) {
    return {
      id: store.id,
      name: store.name || store.nome || '',
    };
  }

  function normalizeUser(user) {
    var statusValue = user.status || (user.blocked ? 'blocked' : user.active === false ? 'blocked' : user.invitePending ? 'invited' : 'active');
    if (user.removedAt) statusValue = 'removed';
    return {
      active: Boolean(user.active),
      blocked: Boolean(user.blocked),
      createdAt: user.createdAt || null,
      email: user.email || '',
      id: user.id,
      invitePending: Boolean(user.invitePending),
      lastSignInAt: user.lastSignInAt || null,
      name: user.name || '',
      removedAt: user.removedAt || null,
      role: normalizeRole(user.role),
      status: statusValue,
      stores: Array.isArray(user.stores) ? user.stores.map(normalizeStore) : [],
      temporaryPassword: user.temporaryPassword || '',
      updatedAt: user.updatedAt || null,
    };
  }

  function normalizeCreatedUser(user) {
    return normalizeUser({
      active: user.active,
      blocked: user.blocked,
      createdAt: user.createdAt,
      email: user.email,
      id: user.id,
      invitePending: user.invitationSent || user.invitePending,
      lastSignInAt: user.lastSignInAt,
      name: user.name,
      role: user.role,
      status: user.status || 'active',
      stores: Array.isArray(user.stores) ? user.stores : [],
      temporaryPassword: user.temporaryPassword || '',
      updatedAt: user.updatedAt,
    });
  }

  function normalizeSavedUser(user) {
    return normalizeCreatedUser(user);
  }

  async function getAccessToken(deps) {
    const sb = typeof deps.getSb === 'function' ? deps.getSb() : deps.supabase;
    if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') {
      throw new Error('Supabase não inicializado.');
    }

    const sessionResult = await sb.auth.getSession();
    const accessToken = sessionResult?.data?.session?.access_token || '';
    if (!accessToken) {
      throw new Error('Sessão autenticada não encontrada.');
    }

    return accessToken;
  }

  async function apiFetch(path, deps, options) {
    const accessToken = await getAccessToken(deps);
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options && options.headers ? options.headers : {}),
      },
    });

    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { raw };
      }
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || `Falha ao consultar usuarios (HTTP ${response.status}).`);
    }

    return data;
  }

  async function createUser(payload, deps) {
    const body = {
      email: normalizeText(payload && payload.email).toLowerCase(),
      isActive: Boolean(payload && payload.isActive),
      name: normalizeText(payload && payload.name),
      role: normalizeText(payload && payload.role).toUpperCase(),
      storeIds: Array.isArray(payload && payload.storeIds) ? payload.storeIds : [],
    };

    const accessToken = await getAccessToken(deps);
    const response = await fetch('/api/admin/users', {
      body: JSON.stringify(body),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'POST',
    });

    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { raw };
      }
    }

    if (!response.ok) {
      const error = new Error(data.error || data.message || `Falha ao criar usuario (HTTP ${response.status}).`);
      error.code = data.code || '';
      error.status = response.status;
      throw error;
    }

    return normalizeCreatedUser(data);
  }

  async function updateUser(userId, payload, deps) {
    const body = {
      email: normalizeText(payload && payload.email).toLowerCase(),
      isActive: Boolean(payload && payload.isActive),
      name: normalizeText(payload && payload.name),
      password: normalizeText(payload && payload.password),
      role: normalizeText(payload && payload.role).toUpperCase(),
      storeIds: Array.isArray(payload && payload.storeIds) ? payload.storeIds : [],
    };

    const accessToken = await getAccessToken(deps);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      body: JSON.stringify(body),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'PATCH',
    });

    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { raw };
      }
    }

    if (!response.ok) {
      const error = new Error(data.error || data.message || `Falha ao atualizar usuario (HTTP ${response.status}).`);
      error.code = data.code || '';
      error.status = response.status;
      throw error;
    }

    return normalizeSavedUser(data);
  }

  async function removeUser(userId, deps) {
    const accessToken = await getAccessToken(deps);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'DELETE',
    });

    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { raw };
      }
    }

    if (!response.ok) {
      const error = new Error(data.error || data.message || `Falha ao remover usuario (HTTP ${response.status}).`);
      error.code = data.code || '';
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function listUsers(params, deps) {
    const query = new URLSearchParams();
    if (params && params.page) query.set('page', String(params.page));
    if (params && params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params && params.search) query.set('search', String(params.search));
    if (params && params.role) query.set('role', String(params.role));
    if (params && params.status) query.set('status', String(params.status));
    if (params && params.storeId) query.set('storeId', String(params.storeId));

    const payload = await apiFetch(`/api/admin/users?${query.toString()}`, deps, {
      method: 'GET',
    });

    return {
      items: Array.isArray(payload.items) ? payload.items.map(normalizeUser) : [],
      page: Number(payload.page) || 1,
      pageSize: Number(payload.pageSize) || 20,
      stores: Array.isArray(payload.stores) ? payload.stores.map(normalizeStore) : [],
      summary: payload.summary || {
        active: 0,
        admin: 0,
        blocked: 0,
        invited: 0,
        total: 0,
      },
      total: Number(payload.total) || 0,
      totalPages: Number(payload.totalPages) || 1,
    };
  }

  async function validateImport(rows, deps) {
    return apiFetch('/api/admin/users/import/validate', deps, {
      body: JSON.stringify({ rows }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  async function importUsers(rows, deps) {
    return apiFetch('/api/admin/users/import', deps, {
      body: JSON.stringify({ rows }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  async function exportUsers(params, deps) {
    var query = new URLSearchParams();
    if (params && params.search) query.set('search', String(params.search));
    if (params && params.role) query.set('role', String(params.role));
    if (params && params.status) query.set('status', String(params.status));
    if (params && params.storeId) query.set('storeId', String(params.storeId));

    return apiFetch('/api/admin/users/export?' + query.toString(), deps, { method: 'GET' });
  }

  global.UsersDataModule = {
    apiFetch,
    createUser,
    removeUser,
    getAccessToken,
    listUsers,
    normalizeRole,
    normalizeStatus,
    normalizeStore,
    normalizeUser,
    normalizeCreatedUser,
    normalizeSavedUser,
    updateUser,
    validateImport,
    importUsers,
    exportUsers,
  };
})(window);
