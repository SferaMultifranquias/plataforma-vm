const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { AdminError, createSupabaseAdminService } = require('../../src/server/services/supabase-admin-service');
const { createUsersAdminHandler } = require('../../src/server/routes/users-admin');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
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

function createFetchStub(routes) {
  return async function fetchStub(url, init) {
    const parsed = new URL(url);
    const handler = routes[parsed.pathname];
    if (!handler) {
      throw new Error(`Unhandled request: ${parsed.pathname}`);
    }

    const payload = typeof handler === 'function' ? await handler(parsed, init || {}) : handler;
    return makeJsonResponse(payload.status || 200, payload.body);
  };
}

function parseJsonBody(init) {
  if (!init || !init.body) return null;
  try {
    return JSON.parse(init.body);
  } catch (_) {
    return null;
  }
}

function createServiceScenario(overrides) {
  const scenario = overrides || {};
  const fetch = createFetchStub({
    '/auth/v1/admin/users': scenario.authUsers || {
      status: 200,
      body: {
        users: [
          {
            email: 'admin@sfera.com',
            email_confirmed_at: '2026-06-18T10:00:00.000Z',
            id: 'admin-id',
            invited_at: null,
            last_sign_in_at: '2026-06-18T12:00:00.000Z',
          },
        ],
      },
    },
    '/auth/v1/user': scenario.currentUser || {
      status: 200,
      body: {
        email: 'admin@sfera.com',
        id: 'admin-id',
      },
    },
    '/rest/v1/lojas': scenario.stores || {
      status: 200,
      body: [
        {
          id: 10,
          nome: 'Loja Centro',
        },
      ],
    },
    '/rest/v1/profiles': scenario.profiles || {
      status: 200,
      body: [
        {
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'admin@sfera.com',
          id: 'admin-id',
          is_active: true,
          name: 'Admin Sfera',
          role: 'ADMIN',
          updated_at: '2026-06-18T09:30:00.000Z',
        },
      ],
    },
    '/rest/v1/user_stores': scenario.userStores || {
      status: 200,
      body: [
        {
          created_at: '2026-06-18T09:00:00.000Z',
          store_id: 10,
          user_id: 'admin-id',
        },
      ],
    },
  });

  return createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch,
  });
}

function createResponseRecorder() {
  return {
    body: null,
    statusCode: 200,
    json(payload) {
      this.body = payload;
      return payload;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function createUsersDataSandbox() {
  const elements = new Map();

  function createElement() {
    const attributes = {};
    const classes = new Set();
    return {
      classList: {
        add(...names) {
          names.forEach((name) => classes.add(name));
        },
        remove(...names) {
          names.forEach((name) => classes.delete(name));
        },
        toggle(name, force) {
          if (typeof force === 'boolean') {
            if (force) classes.add(name);
            else classes.delete(name);
            return force;
          }
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          }
          classes.add(name);
          return true;
        },
        contains(name) {
          return classes.has(name);
        },
      },
      className: '',
      disabled: false,
      innerHTML: '',
      listeners: {},
      attributes,
      __classes: classes,
      style: {},
      textContent: '',
      value: '',
      checked: false,
      focus() {
        this.focused = true;
      },
      closest(selector) {
        if (selector === '[data-close-create-modal="true"]' && this.attributes['data-close-create-modal'] === 'true') {
          return this;
        }
        return null;
      },
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
      removeEventListener(event) {
        delete this.listeners[event];
      },
      dispatchEvent(event) {
        const handler = this.listeners[event.type];
        if (handler) handler(event);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
    };
  }

  const documentListeners = {};
  const document = {
    activeElement: null,
    addEventListener(event, handler) {
      documentListeners[event] = handler;
    },
    removeEventListener(event) {
      delete documentListeners[event];
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
  };

  const sandbox = {
    Intl,
    Promise,
    URL,
    URLSearchParams,
    console,
    document,
    fetch: async function fetch(url, init) {
      sandbox.__requests.push({ url: String(url), init: init || {} });
      return {
        ok: true,
        text() {
          return Promise.resolve(JSON.stringify({
            items: [
              {
                active: true,
                blocked: false,
                createdAt: '2026-06-18T09:00:00.000Z',
                email: 'ana@sfera.com',
                id: 'user-1',
                invitePending: false,
                lastSignInAt: '2026-06-18T10:00:00.000Z',
                name: 'Ana Souza',
                role: 'admin',
                status: 'active',
                stores: [{ id: 10, name: 'Loja Centro' }],
                updatedAt: '2026-06-18T10:30:00.000Z',
              },
              {
                active: false,
                blocked: true,
                createdAt: '2026-06-17T09:00:00.000Z',
                email: 'bruno@sfera.com',
                id: 'user-2',
                invitePending: false,
                lastSignInAt: null,
                name: 'Bruno Lima',
                role: 'loja',
                status: 'blocked',
                stores: [{ id: 10, name: 'Loja Centro' }],
                updatedAt: '2026-06-17T10:30:00.000Z',
              },
            ],
            page: 2,
            pageSize: 5,
            stores: [{ id: 10, name: 'Loja Centro' }],
            summary: {
              active: 1,
              admin: 1,
              blocked: 1,
              invited: 0,
              total: 2,
            },
            total: 2,
            totalPages: 1,
          }));
        },
      };
    },
    globalThis: null,
    lucide: {
      createIcons() {},
    },
    __requests: [],
    __documentListeners: documentListeners,
    clearTimeout,
    ConfirmModal: {
      confirm() { return Promise.resolve(true); },
    },
    setTimeout,
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return sandbox;
}

function loadModule(file, sandbox) {
  const code = read(file);
  vm.runInNewContext(code, sandbox, { filename: file });
  return sandbox;
}

async function run() {
  const serviceMissingToken = createServiceScenario({
    currentUser: { status: 401, body: { message: 'missing token' } },
  });

  await assert.rejects(
    serviceMissingToken.assertActiveAdmin(''),
    (error) => error instanceof AdminError && error.status === 401
  );

  const serviceInvalidToken = createServiceScenario({
    currentUser: { status: 401, body: { message: 'invalid token' } },
  });

  await assert.rejects(
    serviceInvalidToken.assertActiveAdmin('invalid'),
    (error) => error instanceof AdminError && error.status === 401
  );

  const serviceNonAdmin = createServiceScenario({
    profiles: {
      status: 200,
      body: [
        {
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'user@sfera.com',
          id: 'user-id',
          is_active: true,
          name: 'Usuário',
          role: 'USER',
          updated_at: '2026-06-18T09:30:00.000Z',
        },
      ],
    },
    currentUser: {
      status: 200,
      body: {
        email: 'user@sfera.com',
        id: 'user-id',
      },
    },
  });

  await assert.rejects(
    serviceNonAdmin.assertActiveAdmin('token'),
    (error) => error instanceof AdminError && error.status === 403
  );

  const serviceInactiveAdmin = createServiceScenario({
    profiles: {
      status: 200,
      body: [
        {
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'admin@sfera.com',
          id: 'admin-id',
          is_active: false,
          name: 'Admin Sfera',
          role: 'ADMIN',
          updated_at: '2026-06-18T09:30:00.000Z',
        },
      ],
    },
  });

  await assert.rejects(
    serviceInactiveAdmin.assertActiveAdmin('token'),
    (error) => error instanceof AdminError && error.status === 403
  );

  const activeService = createServiceScenario();
  const auth = await activeService.assertActiveAdmin('token');
  assert.equal(auth.profile.role, 'admin');

  const listing = await activeService.listUsers({
    page: 2,
    pageSize: 5,
    role: 'admin',
    search: '',
    status: 'active',
    storeId: '10',
  });

  assert.equal(listing.total, 1);
  assert.equal(listing.totalPages, 1);
  assert.equal(listing.items[0].name, 'Admin Sfera');
  assert.equal(listing.summary.admin, 1);
  assert.equal(listing.summary.active, 1);
  assert.equal(listing.summary.blocked, 0);
  assert.equal(listing.stores[0].name, 'Loja Centro');

  const createRequests = [];
  const creationFetch = async function creationFetch(url, init) {
    const parsed = new URL(url);
    createRequests.push({
      body: parseJsonBody(init),
      method: (init && init.method) || 'GET',
      pathname: parsed.pathname,
      search: parsed.search,
    });

    if (parsed.pathname === '/auth/v1/user') {
      return makeJsonResponse(200, {
        email: 'admin@sfera.com',
        id: 'admin-id',
      });
    }

    if (parsed.pathname === '/auth/v1/admin/users' && (!init || init.method === 'GET')) {
      return makeJsonResponse(200, { users: [] });
    }

    if (parsed.pathname === '/auth/v1/admin/users' && init && init.method === 'POST') {
      return makeJsonResponse(200, {
        user: {
          created_at: '2026-06-18T12:00:00.000Z',
          email: 'novo@sfera.com',
          id: 'new-user-id',
          last_sign_in_at: null,
        },
      });
    }

    if (parsed.pathname === '/rest/v1/profiles') {
      if (!init || init.method === 'GET') {
        const emailFilter = parsed.searchParams.get('email') || '';
        const idFilter = parsed.searchParams.get('id') || '';
        if (idFilter === 'eq.new-user-id') {
          return makeJsonResponse(200, []);
        }
        if (emailFilter === 'eq.existente@sfera.com') {
          return makeJsonResponse(200, [{
            created_at: '2026-06-18T09:00:00.000Z',
            email: 'existente@sfera.com',
            id: 'existing-profile-id',
            is_active: true,
            name: 'Existente',
            role: 'USER',
            updated_at: '2026-06-18T09:30:00.000Z',
          }]);
        }
        return makeJsonResponse(200, []);
      }
      if (init.method === 'PATCH' && parsed.searchParams.get('id') === 'eq.new-user-id') {
        return makeJsonResponse(200, [{
          created_at: '2026-06-18T12:00:00.000Z',
          email: 'novo@sfera.com',
          id: 'new-user-id',
          is_active: true,
          name: 'Novo Usuário',
          role: 'USER',
          updated_at: '2026-06-18T12:00:00.000Z',
        }]);
      }
      if (init.method === 'POST') {
        return makeJsonResponse(201, [{
          created_at: '2026-06-18T12:00:00.000Z',
          email: 'novo@sfera.com',
          id: 'new-user-id',
          is_active: true,
          name: 'Novo Usuário',
          role: 'USER',
          updated_at: '2026-06-18T12:00:00.000Z',
        }]);
      }
      if (init.method === 'DELETE') {
        return makeJsonResponse(200, []);
      }
    }

    if (parsed.pathname === '/rest/v1/lojas') {
      const storeFilter = parsed.searchParams.get('id') || '';
      if (storeFilter.includes('999')) {
        return makeJsonResponse(200, []);
      }
      return makeJsonResponse(200, [
        { id: 10, nome: 'Loja Centro' },
        { id: 11, nome: 'Loja Norte' },
      ]);
    }

    if (parsed.pathname === '/rest/v1/user_stores' && init && init.method === 'POST') {
      return makeJsonResponse(201, [
        { store_id: 10, user_id: 'new-user-id' },
        { store_id: 11, user_id: 'new-user-id' },
      ]);
    }

    if (parsed.pathname === '/rest/v1/audit_logs' && init && init.method === 'POST') {
      return makeJsonResponse(201, [{
        action: 'USER_CREATED',
        entity: 'profiles',
        entity_id: 'new-user-id',
      }]);
    }

    if (parsed.pathname === '/auth/v1/admin/users/new-user-id' && init && init.method === 'DELETE') {
      return makeJsonResponse(200, {});
    }

    throw new Error(`Unhandled request: ${parsed.pathname}`);
  };

  const creationService = createSupabaseAdminService({
    env: {
      APP_PUBLIC_URL: 'https://app.sfera.com',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: creationFetch,
  });

  const createdUser = await creationService.createUser({
    email: 'Novo@Sfera.com ',
    isActive: true,
    name: ' Novo Usuário ',
    role: 'USER',
    storeIds: [10, 11],
  }, {
    authUser: {
      id: 'admin-id',
    },
  });

  assert.equal(typeof createdUser.temporaryPassword, 'string');
  assert.equal(createdUser.temporaryPassword.length > 0, true);
  assert.equal(createdUser.invitationSent, false);
  assert.equal(createdUser.role, 'loja');
  assert.equal(createdUser.stores.length, 2);
  assert.equal(createdUser.email, 'novo@sfera.com');
  const authRequest = createRequests.find((request) => request.pathname === '/auth/v1/admin/users' && request.method === 'POST');
  assert.equal(authRequest.body.email, 'novo@sfera.com');
  assert.equal(authRequest.body.password.length > 0, true);
  assert.equal(authRequest.body.email_confirm, true);
  assert.equal(authRequest.body.user_metadata.name, 'Novo Usuário');

  const profileRequest = createRequests.find((request) => request.pathname === '/rest/v1/profiles' && request.method === 'PATCH')
    || createRequests.find((request) => request.pathname === '/rest/v1/profiles' && request.method === 'POST');
  assert.equal(profileRequest.body.role || profileRequest.body[0].role, 'USER');
  assert.equal(profileRequest.body.email || profileRequest.body[0].email, 'novo@sfera.com');

  const storesRequest = createRequests.find((request) => request.pathname === '/rest/v1/user_stores');
  assert.deepEqual(storesRequest.body, [
    { store_id: 10, user_id: 'new-user-id' },
    { store_id: 11, user_id: 'new-user-id' },
  ]);

  const auditRequest = createRequests.find((request) => request.pathname === '/rest/v1/audit_logs');
  assert.equal(auditRequest.body[0].action, 'USER_CREATED');

  const updateRequests = [];
  const updateFetch = async function updateFetch(url, init) {
    const parsed = new URL(url);
    updateRequests.push({
      body: parseJsonBody(init),
      method: (init && init.method) || 'GET',
      pathname: parsed.pathname,
      search: parsed.search,
    });

    if (parsed.pathname === '/auth/v1/user') {
      return makeJsonResponse(200, { email: 'admin@sfera.com', id: 'admin-id' });
    }
    if (parsed.pathname === '/auth/v1/admin/users' && (!init || init.method === 'GET')) {
      return makeJsonResponse(200, {
        users: [
          { id: 'user-edit-id', email: 'editado@sfera.com', created_at: '2026-06-18T09:00:00.000Z', last_sign_in_at: null, invited_at: null },
          { id: 'admin-id', email: 'admin@sfera.com', created_at: '2026-06-18T09:00:00.000Z', last_sign_in_at: null, invited_at: null },
        ],
      });
    }
    if (parsed.pathname === '/auth/v1/admin/users/user-edit-id' && init && init.method === 'PUT') {
      return makeJsonResponse(200, {
        user: { id: 'user-edit-id', email: 'editado-novo@sfera.com' },
      });
    }
    if (parsed.pathname === '/rest/v1/profiles' && (!init || init.method === 'GET')) {
      const idFilter = parsed.searchParams.get('id') || '';
      if (idFilter === 'eq.user-edit-id') {
        return makeJsonResponse(200, [{
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'editado@sfera.com',
          id: 'user-edit-id',
          is_active: true,
          name: 'Editado',
          role: 'USER',
          updated_at: '2026-06-18T09:30:00.000Z',
        }]);
      }
      if (idFilter === 'eq.admin-id') {
        return makeJsonResponse(200, [{
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'admin@sfera.com',
          id: 'admin-id',
          is_active: true,
          name: 'Admin Sfera',
          role: 'ADMIN',
          updated_at: '2026-06-18T09:30:00.000Z',
        }]);
      }
      return makeJsonResponse(200, []);
    }
    if (parsed.pathname === '/rest/v1/profiles' && init && init.method === 'PATCH' && parsed.searchParams.get('id') === 'eq.user-edit-id') {
      return makeJsonResponse(200, [{
        created_at: '2026-06-18T09:00:00.000Z',
        email: 'editado-novo@sfera.com',
        id: 'user-edit-id',
        is_active: false,
        name: 'Editado Novo',
        role: 'ADMIN',
        updated_at: '2026-06-18T12:00:00.000Z',
      }]);
    }
    if (parsed.pathname === '/rest/v1/user_stores' && init && init.method === 'DELETE') {
      return makeJsonResponse(200, []);
    }
    if (parsed.pathname === '/rest/v1/user_stores' && init && init.method === 'POST') {
      return makeJsonResponse(201, [{ store_id: 10, user_id: 'user-edit-id' }]);
    }
    if (parsed.pathname === '/rest/v1/audit_logs' && init && init.method === 'POST') {
      return makeJsonResponse(201, [{ action: 'USER_UPDATED' }]);
    }
    throw new Error(`Unhandled request: ${parsed.pathname}`);
  };

  const updateService = createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: updateFetch,
  });

  const updatedUser = await updateService.updateUser('user-edit-id', {
    email: 'editado-novo@sfera.com',
    isActive: false,
    name: 'Editado Novo',
    password: 'SenhaNova#123',
    role: 'ADMIN',
    storeIds: [],
  }, {
    authUser: {
      id: 'admin-id',
    },
  });

  assert.equal(updatedUser.email, 'editado-novo@sfera.com');
  assert.equal(updatedUser.role, 'admin');
  assert.equal(updatedUser.active, false);
  assert.equal(updatedUser.temporaryPassword, 'SenhaNova#123');
  assert.equal(updateRequests.some((request) => request.pathname === '/auth/v1/admin/users/user-edit-id' && request.method === 'PUT'), true);
  assert.equal(updateRequests.some((request) => request.pathname === '/rest/v1/user_stores' && request.method === 'DELETE'), true);

  const removeFetch = async function removeFetch(url, init) {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/v1/user') {
      return makeJsonResponse(200, { email: 'admin@sfera.com', id: 'admin-id' });
    }
    if (parsed.pathname === '/auth/v1/admin/users' && (!init || init.method === 'GET')) {
      return makeJsonResponse(200, { users: [{ id: 'user-remove-id', email: 'remove@sfera.com' }] });
    }
    if (parsed.pathname === '/rest/v1/rpc/admin_remove_user_profile') {
      return makeJsonResponse(200, {
        target_id: 'user-remove-id',
        removed_at: '2026-06-30T10:00:00.000Z',
        removed_by_id: 'admin-id',
        already_removed: false,
      });
    }
    if (parsed.pathname === '/auth/v1/admin/users/user-remove-id' && init && init.method === 'PUT') {
      return makeJsonResponse(200, { user: { id: 'user-remove-id' } });
    }
    if (parsed.pathname === '/rest/v1/profiles' && (!init || init.method === 'GET')) {
      const idFilter = parsed.searchParams.get('id') || '';
      if (idFilter === 'eq.user-remove-id') {
        return makeJsonResponse(200, [{
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'remove@sfera.com',
          id: 'user-remove-id',
          is_active: true,
          name: 'Remover',
          role: 'USER',
          updated_at: '2026-06-18T09:30:00.000Z',
        }]);
      }
      if (idFilter === 'eq.admin-id') {
        return makeJsonResponse(200, [{
          created_at: '2026-06-18T09:00:00.000Z',
          email: 'admin@sfera.com',
          id: 'admin-id',
          is_active: true,
          name: 'Admin Sfera',
          role: 'ADMIN',
          updated_at: '2026-06-18T09:30:00.000Z',
        }]);
      }
      return makeJsonResponse(200, []);
    }
    throw new Error(`Unhandled request: ${parsed.pathname}`);
  };

  const removeService = createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: removeFetch,
  });

  const removedUser = await removeService.removeUser('user-remove-id', {
    authUser: {
      id: 'admin-id',
    },
  }, 'admin-access-token');
  assert.equal(removedUser.removed, true);
  assert.equal(removedUser.id, 'user-remove-id');

  await assert.rejects(
    creationService.createUser({
      email: 'existente@sfera.com',
      isActive: true,
      name: 'Existente',
      role: 'ADMIN',
      storeIds: [],
    }, {
      authUser: {
        id: 'admin-id',
      },
    }),
    (error) => error instanceof AdminError && error.status === 409 && error.code === 'EMAIL_ALREADY_EXISTS'
  );

  await assert.rejects(
    creationService.createUser({
      email: 'nova@sfera.com',
      isActive: true,
      name: 'Sem Loja',
      role: 'USER',
      storeIds: [],
    }, {
      authUser: {
        id: 'admin-id',
      },
    }),
    (error) => error instanceof AdminError && error.status === 400 && error.code === 'STORE_REQUIRED'
  );

  await assert.rejects(
    creationService.createUser({
      email: 'nova@sfera.com',
      isActive: true,
      name: 'Loja inválida',
      role: 'USER',
      storeIds: [999],
    }, {
      authUser: {
        id: 'admin-id',
      },
    }),
    (error) => error instanceof AdminError && error.status === 400 && error.code === 'INVALID_STORE'
  );

  const rollbackRequests = [];
  const rollbackFetch = async function rollbackFetch(url, init) {
    const parsed = new URL(url);
    rollbackRequests.push({
      body: parseJsonBody(init),
      method: (init && init.method) || 'GET',
      pathname: parsed.pathname,
    });

    if (parsed.pathname === '/auth/v1/user') {
      return makeJsonResponse(200, { email: 'admin@sfera.com', id: 'admin-id' });
    }
    if (parsed.pathname === '/auth/v1/admin/users' && (!init || init.method === 'GET')) {
      return makeJsonResponse(200, { users: [] });
    }
    if (parsed.pathname === '/auth/v1/admin/users' && init && init.method === 'POST') {
      return makeJsonResponse(200, {
        user: { created_at: '2026-06-18T12:00:00.000Z', email: 'falha@sfera.com', id: 'rollback-id' },
      });
    }
    if (parsed.pathname === '/rest/v1/profiles' && (!init || init.method === 'GET')) {
      return makeJsonResponse(200, []);
    }
    if (parsed.pathname === '/rest/v1/profiles' && init && init.method === 'PATCH' && parsed.searchParams.get('id') === 'eq.rollback-id') {
      return makeJsonResponse(200, [{
        created_at: '2026-06-18T12:00:00.000Z',
        email: 'falha@sfera.com',
        id: 'rollback-id',
        is_active: true,
        name: 'Falha',
        role: 'USER',
        updated_at: '2026-06-18T12:00:00.000Z',
      }]);
    }
    if (parsed.pathname === '/rest/v1/profiles' && init && init.method === 'POST') {
      return makeJsonResponse(201, [{ created_at: '2026-06-18T12:00:00.000Z', email: 'falha@sfera.com', id: 'rollback-id', is_active: true, name: 'Falha', role: 'USER', updated_at: '2026-06-18T12:00:00.000Z' }]);
    }
    if (parsed.pathname === '/rest/v1/lojas') {
      return makeJsonResponse(200, [{ id: 10, nome: 'Loja Centro' }]);
    }
    if (parsed.pathname === '/rest/v1/user_stores' && init && init.method === 'POST') {
      return makeJsonResponse(201, [{ store_id: 10, user_id: 'rollback-id' }]);
    }
    if (parsed.pathname === '/rest/v1/audit_logs' && init && init.method === 'POST') {
      return makeJsonResponse(500, { message: 'audit failed' });
    }
    if (parsed.pathname === '/rest/v1/profiles' && init && init.method === 'DELETE') {
      return makeJsonResponse(200, []);
    }
    if (parsed.pathname === '/auth/v1/admin/users/rollback-id' && init && init.method === 'DELETE') {
      return makeJsonResponse(200, {});
    }
    throw new Error(`Unhandled request: ${parsed.pathname}`);
  };

  const rollbackService = createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: rollbackFetch,
  });

  await assert.rejects(
    rollbackService.createUser({
      email: 'falha@sfera.com',
      isActive: true,
      name: 'Falha',
      role: 'USER',
      storeIds: [10],
    }, {
      authUser: {
        id: 'admin-id',
      },
    }),
    (error) => error instanceof AdminError && error.code === 'MANUAL_RECOVERY_REQUIRED'
  );

  assert.equal(rollbackRequests.some((request) => request.pathname === '/auth/v1/admin/users/rollback-id' && request.method === 'DELETE'), true);
  assert.equal(rollbackRequests.some((request) => request.pathname === '/rest/v1/profiles' && request.method === 'DELETE'), true);

  const rateLimitService = createSupabaseAdminService({
    env: {
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_URL: 'https://project.supabase.co',
    },
    fetch: async function rateLimitFetch(url, init) {
      const parsed = new URL(url);
      if (parsed.pathname === '/auth/v1/user') {
        return makeJsonResponse(200, { email: 'admin@sfera.com', id: 'admin-id' });
      }
      if (parsed.pathname === '/auth/v1/admin/users' && (!init || init.method === 'GET')) {
        return makeJsonResponse(200, { users: [] });
      }
      if (parsed.pathname === '/rest/v1/profiles' && (!init || init.method === 'GET')) {
        return makeJsonResponse(200, []);
      }
      if (parsed.pathname === '/rest/v1/lojas') {
        return makeJsonResponse(200, [{ id: 10, nome: 'Loja Centro' }]);
      }
      if (parsed.pathname === '/auth/v1/admin/users' && init && init.method === 'POST') {
        return makeJsonResponse(429, { message: 'Rate limit exceeded' });
      }
      throw new Error(`Unhandled request: ${parsed.pathname}`);
    },
  });

  await assert.rejects(
    rateLimitService.createUser({
      email: 'rate@sfera.com',
      isActive: true,
      name: 'Rate Limit',
      role: 'ADMIN',
      storeIds: [],
    }, {
      authUser: {
        id: 'admin-id',
      },
    }),
    (error) => error instanceof AdminError && error.status === 429 && error.code === 'RATE_LIMITED'
  );

  const handlerService = {
    assertActiveAdmin() {
      return Promise.resolve({ profile: { id: 'admin-id', role: 'admin' } });
    },
    listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
  };

  const unauthorizedHandler = createUsersAdminHandler({
    assertActiveAdmin() {
      throw new AdminError(401, 'missing_token', 'Missing bearer token.');
    },
    listUsers() {
      return Promise.resolve();
    },
  });

  const unauthorizedResponse = createResponseRecorder();
  await unauthorizedHandler({ headers: {}, query: {} }, unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(unauthorizedResponse.body.error, 'Missing bearer token.');

  const forbiddenHandler = createUsersAdminHandler({
    assertActiveAdmin() {
      throw new AdminError(403, 'forbidden', 'Administrative access required.');
    },
    listUsers() {
      return Promise.resolve();
    },
  });

  const forbiddenResponse = createResponseRecorder();
  await forbiddenHandler({
    headers: { authorization: 'Bearer token' },
    query: {},
  }, forbiddenResponse);
  assert.equal(forbiddenResponse.statusCode, 403);

  const successHandler = createUsersAdminHandler(handlerService);
  const successResponse = createResponseRecorder();
  const payload = {
    page: 1,
    pageSize: 20,
    search: '',
    role: '',
    status: '',
    storeId: '',
  };
  await successHandler({
    headers: { authorization: 'Bearer access-token' },
    query: payload,
  }, successResponse);
  assert.equal(successResponse.statusCode, 200);
  assert.deepEqual(successResponse.body.summary, {
    active: 0,
    admin: 0,
    blocked: 0,
    invited: 0,
    total: 0,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(successResponse.body, 'serviceRoleKey'), false);

  const createHandlerService = {
    assertActiveAdmin() {
      return Promise.resolve({
        authUser: { id: 'admin-id' },
        profile: { id: 'admin-id', role: 'admin' },
      });
    },
    createUser(payload, caller) {
      assert.equal(payload.name, 'Novo Usuário');
      assert.equal(payload.email, 'novo@sfera.com');
      assert.equal(payload.role, 'USER');
      assert.equal(caller.authUser.id, 'admin-id');
      return Promise.resolve({
        active: true,
        blocked: false,
        createdAt: '2026-06-18T11:00:00.000Z',
        email: 'novo@sfera.com',
        id: 'new-user-id',
        invitationSent: false,
        invitePending: false,
        lastSignInAt: null,
        name: 'Novo Usuário',
        role: 'loja',
        status: 'active',
        temporaryPassword: 'Temp#123456',
        stores: [],
        updatedAt: '2026-06-18T11:00:00.000Z',
      });
    },
    listUsers() {
      return Promise.resolve({
        items: [],
        page: 1,
        pageSize: 20,
        stores: [],
        summary: {
          active: 0,
          admin: 0,
          blocked: 0,
          invited: 0,
          total: 0,
        },
        total: 0,
        totalPages: 1,
      });
    },
  };

  const createHandler = createUsersAdminHandler(createHandlerService);
  const createResponse = createResponseRecorder();
  await createHandler({
    body: {
      email: 'novo@sfera.com',
      isActive: true,
      name: 'Novo Usuário',
      role: 'USER',
      storeIds: [10],
    },
    headers: { authorization: 'Bearer access-token', 'content-type': 'application/json' },
    method: 'POST',
    query: {},
  }, createResponse);
  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.body.invitationSent, false);
  assert.equal(createResponse.body.temporaryPassword, 'Temp#123456');

  const dataSandbox = createUsersDataSandbox();
  loadModule(path.join('public', 'js', 'pages', 'users', 'users-data.js'), dataSandbox);
  const dataResult = await dataSandbox.UsersDataModule.listUsers({
    page: 2,
    pageSize: 5,
    role: 'admin',
    search: 'Ana',
    status: 'active',
    storeId: '10',
  }, {
    getSb() {
      return {
        auth: {
          getSession() {
            return Promise.resolve({
              data: {
                session: {
                  access_token: 'access-token',
                },
              },
            });
          },
        },
      };
    },
  });

  assert.equal(dataSandbox.__requests.length, 1);
  const requestUrl = new URL(dataSandbox.__requests[0].url, 'http://localhost');
  assert.equal(requestUrl.pathname, '/api/admin/users');
  assert.equal(requestUrl.searchParams.get('page'), '2');
  assert.equal(requestUrl.searchParams.get('pageSize'), '5');
  assert.equal(requestUrl.searchParams.get('search'), 'Ana');
  assert.equal(requestUrl.searchParams.get('role'), 'admin');
  assert.equal(requestUrl.searchParams.get('status'), 'active');
  assert.equal(requestUrl.searchParams.get('storeId'), '10');
  assert.equal(dataSandbox.__requests[0].init.headers.Authorization, 'Bearer access-token');
  assert.equal(dataResult.items[0].role, 'admin');

  const uiSandbox = createUsersDataSandbox();
  const createCalls = [];
  uiSandbox.UsersDataModule = {
    listUsers(params) {
      uiSandbox.__calls.push({ ...params });
      return Promise.resolve({
        items: [
          {
            active: true,
            blocked: false,
            createdAt: '2026-06-18T09:00:00.000Z',
            email: 'ana@sfera.com',
            id: 'user-1',
            invitePending: false,
            lastSignInAt: '2026-06-18T10:00:00.000Z',
            name: 'Ana Souza',
            role: 'admin',
            status: 'active',
            stores: [{ id: 10, name: 'Loja Centro' }],
            updatedAt: '2026-06-18T10:30:00.000Z',
          },
        ],
        page: params.page,
        pageSize: params.pageSize,
        stores: [{ id: 10, name: 'Loja Centro' }],
        summary: {
          active: 1,
          admin: 1,
          blocked: 0,
          invited: 0,
          total: 1,
        },
        total: 1,
        totalPages: 2,
      });
    },
    createUser(payload) {
      createCalls.push({ ...payload });
      return Promise.resolve({
        active: payload.isActive,
        blocked: false,
        createdAt: '2026-06-18T11:00:00.000Z',
        email: payload.email,
        id: 'user-created',
        invitationSent: false,
        invitePending: false,
        lastSignInAt: null,
        name: payload.name,
        role: payload.role,
        status: 'active',
        temporaryPassword: 'Temp#987654',
        stores: payload.storeIds.map((id) => ({ id, name: id === 10 ? 'Loja Centro' : 'Loja Norte' })),
        updatedAt: '2026-06-18T11:00:00.000Z',
      });
    },
  };
  uiSandbox.__calls = [];
  loadModule(path.join('public', 'js', 'pages', 'users', 'users-module.js'), uiSandbox);

  await uiSandbox.UsersModule.afterRenderUsuarios({
    listUsers: uiSandbox.UsersDataModule.listUsers,
    createUser: uiSandbox.UsersDataModule.createUser,
    updateUser(payload, deps) {
      createCalls.push({ type: 'update', ...payload });
      return Promise.resolve({
        active: payload.isActive,
        blocked: false,
        createdAt: '2026-06-18T11:00:00.000Z',
        email: payload.email,
        id: 'user-1',
        invitationSent: false,
        invitePending: false,
        lastSignInAt: null,
        name: payload.name,
        role: payload.role,
        status: 'active',
        temporaryPassword: payload.password || '',
        stores: payload.storeIds.map((id) => ({ id, name: id === 10 ? 'Loja Centro' : 'Loja Norte' })),
        updatedAt: '2026-06-18T11:00:00.000Z',
      });
    },
    deleteUser(userId) {
      createCalls.push({ type: 'remove', userId: userId });
      return Promise.resolve({ removed: true, id: userId });
    },
    params: {},
    showToast() {},
  });

  assert.match(uiSandbox.document.getElementById('users-summary').innerHTML, /users-summary-total/);
  assert.match(uiSandbox.document.getElementById('users-summary').innerHTML, /Total de usuários/);
  assert.match(uiSandbox.document.getElementById('users-table-body').innerHTML, /Ana Souza/);
  assert.equal(uiSandbox.__calls.length >= 1, true);

  const searchInput = uiSandbox.document.getElementById('users-search');
  searchInput.value = 'Maria';
  searchInput.dispatchEvent({ type: 'input' });
  assert.equal(uiSandbox.__calls[uiSandbox.__calls.length - 1].search, 'Maria');

  const nextButton = uiSandbox.document.getElementById('users-next');
  nextButton.dispatchEvent({ type: 'click', preventDefault() {} });
  assert.equal(uiSandbox.__calls[uiSandbox.__calls.length - 1].page, 2);

  const modal = uiSandbox.document.getElementById('users-create-modal');
  const dropdown = uiSandbox.document.getElementById('users-create-store-dropdown');
  const trigger = uiSandbox.document.getElementById('users-create-store-trigger');
  modal.classList.add('hidden');
  uiSandbox.document.activeElement = uiSandbox.document.getElementById('users-create-open');
  uiSandbox.document.getElementById('users-create-open').dispatchEvent({ type: 'click', preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(uiSandbox.document.getElementById('users-create-name').focused, true);
  assert.match(uiSandbox.document.getElementById('users-create-title').textContent, /Novo usuário/);
  assert.equal(uiSandbox.document.getElementById('users-create-password').value.length > 0, true);
  assert.equal(dropdown.classList.contains('hidden'), true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.dispatchEvent({ type: 'click', preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dropdown.classList.contains('hidden'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(uiSandbox.document.getElementById('users-create-store-search').focused, true);

  uiSandbox.__documentListeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(dropdown.classList.contains('hidden'), true);
  assert.equal(modal.classList.contains('hidden'), false);

  trigger.dispatchEvent({ type: 'click', preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  modal.listeners.click({
    target: {
      closest() {
        return null;
      },
      getAttribute() {
        return '';
      },
    },
    type: 'click',
  });
  assert.equal(dropdown.classList.contains('hidden'), true);

  const createForm = uiSandbox.document.getElementById('users-create-form');
  createForm.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.match(uiSandbox.document.getElementById('users-create-error').textContent, /Corrija os campos destacados/);
  assert.equal(createCalls.length, 0);

  uiSandbox.document.getElementById('users-create-name').value = 'Maria Silva';
  uiSandbox.document.getElementById('users-create-email').value = 'maria@sfera.com';
  uiSandbox.document.getElementById('users-create-role').value = 'USER';
  uiSandbox.document.getElementById('users-create-store-search').value = '';
  uiSandbox.document.getElementById('users-create-store-list').listeners.change({
    target: { checked: true, type: 'checkbox', value: '10' },
    type: 'change',
  });
  assert.equal(uiSandbox.document.getElementById('users-create-store-count').textContent, '1 selecionada(s)');
  createForm.dispatchEvent({ type: 'submit', preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].email, 'maria@sfera.com');
  assert.equal(Array.isArray(createCalls[0].storeIds), true);
  assert.equal(createCalls[0].storeIds.length, 1);
  assert.equal(createCalls[0].storeIds[0], 10);
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(uiSandbox.document.getElementById('users-create-success').classList.contains('hidden'), false);
  assert.equal(uiSandbox.document.getElementById('users-create-success-email').textContent, 'maria@sfera.com');
  assert.equal(uiSandbox.document.getElementById('users-create-success-password').textContent, 'Temp#987654');
  assert.equal(uiSandbox.__calls.length > 2, true);

  const passwordToggle = uiSandbox.document.getElementById('users-create-toggle-password');
  assert.equal(passwordToggle.getAttribute('aria-label'), 'Ocultar senha');
  passwordToggle.dispatchEvent({ type: 'click', preventDefault() {} });
  assert.equal(passwordToggle.getAttribute('aria-label'), 'Mostrar senha');
  passwordToggle.dispatchEvent({ type: 'click', preventDefault() {} });
  assert.equal(passwordToggle.getAttribute('aria-label'), 'Ocultar senha');

  const tableBody = uiSandbox.document.getElementById('users-table-body');
  tableBody.listeners.click({
    target: {
      closest() {
        return this;
      },
      getAttribute(name) {
        if (name === 'data-user-action') return 'edit';
        if (name === 'data-user-id') return 'user-1';
        return '';
      },
    },
    type: 'click',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(uiSandbox.document.getElementById('users-create-title').textContent, /Editar usuário/);
  assert.equal(uiSandbox.document.getElementById('users-create-password').value, '');

  uiSandbox.document.getElementById('users-create-name').value = 'Ana Souza Atualizada';
  uiSandbox.document.getElementById('users-create-password').value = 'SenhaNova#123';
  createForm.dispatchEvent({ type: 'submit', preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createCalls.some((item) => item.type === 'update'), true);

  tableBody.listeners.click({
    target: {
      closest() {
        return this;
      },
      getAttribute(name) {
        if (name === 'data-user-action') return 'delete';
        if (name === 'data-user-id') return 'user-1';
        return '';
      },
    },
    type: 'click',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createCalls.some((item) => item.type === 'remove' && item.userId === 'user-1'), true);

  console.log('Users admin checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
