(function initUsersModule(global) {
  function escapeHtml(value) {
    return global.AppUtils ? global.AppUtils.escapeHtml(value) : String(value ?? '');
  }

  function isValidUUID(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  var DEFAULT_PAGE_SIZE = 20;
  var FIELD_ERROR_IDS = {
    email: 'users-create-email-error',
    name: 'users-create-name-error',
    role: 'users-create-role-error',
    stores: 'users-create-stores-error',
    password: 'users-create-password-error',
  };

  var pageState = {
    filters: {
      role: '',
      search: '',
      status: '',
      storeId: '',
    },
    loading: false,
    pageSize: DEFAULT_PAGE_SIZE,
    page: 1,
    stores: [],
    total: 0,
    totalPages: 1,
    users: [],
  };

  var exportMenuOpen = false;
  var exportMenuTrigger = null;

  var importState = {
    open: false,
    step: 'file',
    file: null,
    fileName: '',
    rows: [],
    validation: null,
    result: null,
    importing: false,
    error: '',
    trigger: null,
  };

  var createState = {
    active: true,
    email: '',
    error: '',
    editingUser: null,
    success: null,
    fieldErrors: {
      email: '',
      name: '',
      role: '',
      stores: '',
      password: '',
    },
    name: '',
    open: false,
    password: '',
    passwordVisible: false,
    mode: 'create',
    role: 'USER',
    saving: false,
    search: '',
    selectedStoreIds: [],
    storesOpen: false,
    trigger: null,
  };

  var currentDeps = null;
  var currentLoadToken = 0;
  var listeners = [];

  function requireElement(id) {
    var element = document.getElementById(id);
    if (!element) {
      throw new Error('Required users element not found: #' + id);
    }
    return element;
  }

  function bindListener(el, event, handler) {
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener(event, handler);
    listeners.push({ el: el, event: event, handler: handler });
  }

  function resetListeners() {
    listeners.forEach(function remove(listener) {
      if (listener && listener.el && typeof listener.el.removeEventListener === 'function') {
        listener.el.removeEventListener(listener.event, listener.handler);
      }
    });
    listeners = [];
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
  }

  function generateTemporaryPassword() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    var password = '';
    var bytes = [];

    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
    } else {
      bytes = Array.from({ length: 16 }, function createByte() {
        return Math.floor(Math.random() * 256);
      });
    }

    for (var index = 0; index < bytes.length; index += 1) {
      password += alphabet[bytes[index] % alphabet.length];
    }

    return password;
  }

  function setPasswordVisibility(visible) {
    createState.passwordVisible = Boolean(visible);
    var input = document.getElementById('users-create-password');
    var button = document.getElementById('users-create-toggle-password');
    if (input) {
      input.type = createState.passwordVisible ? 'text' : 'password';
    }
    if (button) {
      button.innerHTML = createState.passwordVisible
        ? '<i data-lucide="eye-off" class="w-4 h-4"></i>'
        : '<i data-lucide="eye" class="w-4 h-4"></i>';
      button.setAttribute('aria-label', createState.passwordVisible ? 'Ocultar senha' : 'Mostrar senha');
    }
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function getStoreDropdownElements() {
    return {
      dropdown: document.getElementById('users-create-store-dropdown'),
      list: document.getElementById('users-create-store-list'),
      search: document.getElementById('users-create-store-search'),
      trigger: document.getElementById('users-create-store-trigger'),
    };
  }

  function setStoreCheckboxDisabledState(disabled) {
    var elements = getStoreDropdownElements();
    if (elements.search) {
      elements.search.disabled = Boolean(disabled);
    }
    if (elements.trigger) {
      elements.trigger.disabled = Boolean(disabled);
      elements.trigger.setAttribute('aria-expanded', createState.storesOpen ? 'true' : 'false');
    }

    if (elements.list && typeof elements.list.querySelectorAll === 'function') {
      Array.prototype.forEach.call(elements.list.querySelectorAll('input[type="checkbox"]'), function setCheckboxState(checkbox) {
        checkbox.disabled = Boolean(disabled);
      });
    }
  }

  function syncStoresDropdownState(options) {
    var elements = getStoreDropdownElements();
    var open = createState.storesOpen;

    if (elements.trigger) {
      elements.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      elements.trigger.disabled = Boolean(createState.saving);
    }

    if (elements.dropdown) {
      elements.dropdown.classList.toggle('hidden', !open);
      elements.dropdown.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    if (elements.search) {
      elements.search.disabled = Boolean(createState.saving);
    }

    setStoreCheckboxDisabledState(createState.saving);

    if (open && options && options.focusSearch !== false) {
      window.setTimeout(function focusStoreSearch() {
        var search = document.getElementById('users-create-store-search');
        if (search && typeof search.focus === 'function' && !search.disabled) {
          search.focus();
        }
      }, 0);
    }

    if (!open && options && options.focusTrigger) {
      window.setTimeout(function focusStoreTrigger() {
        var trigger = document.getElementById('users-create-store-trigger');
        if (trigger && typeof trigger.focus === 'function' && !trigger.disabled) {
          trigger.focus();
        }
      }, 0);
    }
  }

  function setStoresDropdownOpen(open, options) {
    createState.storesOpen = Boolean(open);
    syncStoresDropdownState(options || {});
    if (createState.storesOpen) {
      renderCreateStoreList();
    }
  }

  function isStoreDropdownTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest('#users-create-store-trigger') || target.closest('#users-create-store-dropdown'));
  }

  function setCreateModalMode(mode) {
    createState.mode = mode === 'edit' ? 'edit' : 'create';
    var title = requireElement('users-create-title');
    var subtitle = requireElement('users-create-subtitle');
    var submitLabel = requireElement('users-create-submit-label');
    var passwordNote = requireElement('users-create-password-note');
    var passwordLabel = requireElement('users-create-password-label');

    if (createState.mode === 'edit') {
      title.textContent = 'Editar usuário';
      subtitle.textContent = 'Edite os dados, as lojas vinculadas e defina uma nova senha se necessário.';
      submitLabel.textContent = 'Salvar alterações';
      passwordLabel.textContent = 'Nova senha';
      passwordNote.textContent = 'Deixe em branco para manter a senha atual. A senha atual não pode ser exibida por segurança.';
    } else {
      title.textContent = 'Novo usuário';
      subtitle.textContent = 'O usuário receberá uma senha temporária para acessar a plataforma.';
      submitLabel.textContent = 'Criar usuário';
      passwordLabel.textContent = 'Senha temporária';
      passwordNote.textContent = 'Você pode editar a senha antes de salvar.';
    }
  }

  function formatDate(value) {
    if (!value) return 'Não disponível';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Não disponível';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function roleLabel(role) {
    var map = {
      admin: 'Administrador',
      loja: 'Loja',
    };
    return map[String(role || '').toLowerCase()] || '-';
  }

  function statusLabel(status) {
    var map = {
      active: 'Ativo',
      blocked: 'Bloqueado',
      invited: 'Convite pendente',
      removed: 'Removido',
    };
    return map[String(status || '').toLowerCase()] || 'Ativo';
  }

  function statusClass(status) {
    var map = {
      active: 'users-status-badge--active',
      blocked: 'users-status-badge--blocked',
      invited: 'users-status-badge--invited',
      removed: 'users-status-badge--removed',
    };
    return map[String(status || '').toLowerCase()] || map.active;
  }

  function summaryClass(key) {
    return 'users-summary-icon users-summary-icon--' + key;
  }

  function renderSummaryCard(id, icon, label, value, key) {
    return (
      '<div class="users-summary-card">' +
        '<div class="users-summary-card-header">' +
          '<div class="' + summaryClass(key) + '">' +
            '<i data-lucide="' + icon + '" class="w-4 h-4"></i>' +
          '</div>' +
          '<div class="users-summary-title">' + label + '</div>' +
        '</div>' +
        '<div id="' + id + '" class="users-summary-value">' + value + '</div>' +
      '</div>'
    );
  }

  function renderSummary(summary) {
    var total = summary && typeof summary.total === 'number' ? summary.total : 0;
    var active = summary && typeof summary.active === 'number' ? summary.active : 0;
    var blocked = summary && typeof summary.blocked === 'number' ? summary.blocked : 0;
    var admin = summary && typeof summary.admin === 'number' ? summary.admin : 0;

    return (
      renderSummaryCard('users-summary-total', 'users-round', 'Total de usuários', total, 'total') +
      renderSummaryCard('users-summary-active', 'user-check', 'Usuários ativos', active, 'active') +
      renderSummaryCard('users-summary-blocked', 'user-x', 'Usuários bloqueados', blocked, 'blocked') +
      renderSummaryCard('users-summary-admin', 'shield-check', 'Administradores', admin, 'admin')
    );
  }

  function renderStoreOptions(stores, selectedStoreId) {
    var select = requireElement('users-store');
    var options = ['<option value="">Todas as lojas</option>'];

    (Array.isArray(stores) ? stores : []).forEach(function mapStore(store) {
      var selected = String(store.id) === String(selectedStoreId) ? ' selected' : '';
      options.push('<option value="' + escapeHtml(store.id) + '"' + selected + '>' + escapeHtml(store.name || '-') + '</option>');
    });

    select.innerHTML = options.join('');
  }

  function renderPagination(totalPages, page) {
    var prev = requireElement('users-prev');
    var next = requireElement('users-next');
    var info = requireElement('users-page-info');

    info.textContent = 'Página ' + page + ' de ' + totalPages;
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
  }

  function renderEmptyState(visible) {
    requireElement('users-empty').classList.toggle('hidden', !visible);
    requireElement('users-loading').classList.add('hidden');
    requireElement('users-error').classList.add('hidden');
  }

  function renderLoadingState(visible) {
    requireElement('users-loading').classList.toggle('hidden', !visible);
    requireElement('users-error').classList.add('hidden');
    requireElement('users-empty').classList.add('hidden');
  }

  function renderErrorState(message) {
    var errorPanel = requireElement('users-error');
    requireElement('users-loading').classList.add('hidden');
    requireElement('users-empty').classList.add('hidden');
    errorPanel.classList.remove('hidden');
    requireElement('users-error-message').textContent = message || 'Não foi possível carregar os usuários.';
  }

  function renderUsersTable(users) {
    var tbody = requireElement('users-table-body');

    if (!users.length) {
      tbody.innerHTML = '';
      renderEmptyState(true);
      return;
    }

    renderEmptyState(false);
    tbody.innerHTML = users.map(function mapUser(user) {
      var safeName = escapeHtml(String(user.name || '-'));
      var safeEmail = escapeHtml(String(user.email || '-'));
      var safeId = escapeHtml(String(user.id || ''));
      var idIsValid = isValidUUID(user.id);

      var initials = String(user.name || user.email || '-')
        .split(' ')
        .filter(Boolean)
        .map(function getInitial(part) {
          return part[0];
        })
        .slice(0, 2)
        .join('')
        .toUpperCase() || '-';

      var storesLabel = '-';
      if (Array.isArray(user.stores) && user.stores.length) {
        var firstStores = user.stores.slice(0, 2).map(function mapStore(store) {
          return escapeHtml(String(store.name));
        }).join(', ');
        storesLabel = firstStores + (user.stores.length > 2 ? ' +' + (user.stores.length - 2) : '');
      }

      var safeRoleLabel = roleLabel(user.role);
      var safeStatusLabel = statusLabel(user.status);
      var safeStatusClass = statusClass(user.status);

      var actionsHtml = '';
      if (idIsValid && user.status !== 'removed') {
        actionsHtml =
          '<button type="button" class="users-row-action users-row-action--edit" data-user-action="edit" data-user-id="' + safeId + '">' +
            '<i data-lucide="pencil" class="w-4 h-4" aria-hidden="true"></i>' +
            '<span>Editar</span>' +
          '</button>' +
          '<button type="button" class="users-row-action users-row-action--delete" data-user-action="delete" data-user-id="' + safeId + '">' +
            '<i data-lucide="user-x" class="w-4 h-4" aria-hidden="true"></i>' +
            '<span>Remover</span>' +
          '</button>';
      }

      return (
        '<tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">' +
          '<td class="table-td text-center">' +
            '<div class="flex items-center justify-center gap-3 min-w-0">' +
              '<div class="users-avatar">' + escapeHtml(initials) + '</div>' +
              '<div class="min-w-0 text-left">' +
                '<div class="font-medium text-slate-900 truncate">' + safeName + '</div>' +
                '<div class="text-xs text-slate-400 truncate">ID ' + safeId + '</div>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '<td class="table-td text-center text-slate-600">' + safeEmail + '</td>' +
          '<td class="table-td text-center">' +
            '<span class="users-role-badge">' + safeRoleLabel + '</span>' +
          '</td>' +
          '<td class="table-td text-center text-slate-600">' + storesLabel + '</td>' +
          '<td class="table-td text-center">' +
            '<span class="users-status-badge ' + safeStatusClass + '">' + safeStatusLabel + '</span>' +
          '</td>' +
          '<td class="table-td text-center text-slate-600">' + formatDate(user.lastSignInAt) + '</td>' +
          '<td class="table-td text-center text-slate-600">' + formatDate(user.createdAt) + '</td>' +
          '<td class="table-td text-center">' +
            '<div class="users-row-actions' + (idIsValid ? ' data-user-actions="' + safeId + '"' : '') + '">' +
              actionsHtml +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function syncFiltersToControls() {
    requireElement('users-search').value = pageState.filters.search;
    requireElement('users-role').value = pageState.filters.role;
    requireElement('users-status').value = pageState.filters.status;
    requireElement('users-store').value = pageState.filters.storeId;
  }

  function readFiltersFromControls() {
    pageState.filters.search = normalizeText(requireElement('users-search').value);
    pageState.filters.role = normalizeText(requireElement('users-role').value);
    pageState.filters.status = normalizeText(requireElement('users-status').value);
    pageState.filters.storeId = normalizeText(requireElement('users-store').value);
  }

  function updateStoreFilter(stores, selectedStoreId) {
    pageState.stores = Array.isArray(stores) ? stores.slice() : [];
    renderStoreOptions(pageState.stores, selectedStoreId);
    renderCreateStoreList();
  }

  function getSelectedStoreIds() {
    return createState.selectedStoreIds.slice().sort(function sortNumeric(a, b) {
      return Number(a) - Number(b);
    });
  }

  function setCreateFieldError(field, message) {
    var elementId = FIELD_ERROR_IDS[field];
    if (!elementId) return;
    requireElement(elementId).textContent = message || '';
  }

  function clearCreateFieldErrors() {
    Object.keys(FIELD_ERROR_IDS).forEach(function clearField(field) {
      setCreateFieldError(field, '');
    });
  }

  function setCreateError(message) {
    createState.error = message || '';
    requireElement('users-create-error').textContent = createState.error;
    requireElement('users-create-error').classList.toggle('hidden', !createState.error);
  }

  function setCreateSuccess(success) {
    createState.success = success || null;
    var panel = requireElement('users-create-success');

    if (!createState.success) {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
      return;
    }

    requireElement('users-create-success-email').textContent = createState.success.email || '-';
    requireElement('users-create-success-password').textContent = createState.success.temporaryPassword || '-';
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
  }

  function setCreateSaving(saving) {
    createState.saving = Boolean(saving);
    var submit = requireElement('users-create-submit');
    var cancel = requireElement('users-create-cancel');
    var form = requireElement('users-create-form');
    submit.disabled = createState.saving;
    cancel.disabled = createState.saving;
    form.setAttribute('aria-busy', createState.saving ? 'true' : 'false');
    requireElement('users-create-submit-label').textContent = createState.saving ? 'Salvando...' : 'Criar usuário';
    syncStoresDropdownState({ focusSearch: false });
  }

  function renderCreateStoreCount() {
    var count = getSelectedStoreIds().length;
    requireElement('users-create-store-count').textContent = count + ' selecionada(s)';
  }

  function renderCreateStoreList() {
    var container = requireElement('users-create-store-list');
    var search = normalizeText(createState.search).toLowerCase();
    var filtered = pageState.stores.filter(function filterStore(store) {
      if (!search) return true;
      return String(store.name || '').toLowerCase().includes(search);
    });

    if (pageState.loading && !pageState.stores.length) {
      container.innerHTML = '<div class="users-create-loading">Carregando lojas...</div>';
      renderCreateStoreCount();
      setStoreCheckboxDisabledState(createState.saving);
      return;
    }

    if (!filtered.length) {
      container.innerHTML = '<div class="users-create-empty">Nenhuma loja encontrada.</div>';
      renderCreateStoreCount();
      setStoreCheckboxDisabledState(createState.saving);
      return;
    }

    container.innerHTML = filtered.map(function mapStore(store) {
      var checked = createState.selectedStoreIds.indexOf(Number(store.id)) >= 0 ? ' checked' : '';
      return (
        '<label class="users-create-store-item">' +
          '<input type="checkbox" class="users-create-store-checkbox" value="' + escapeHtml(store.id) + '"' + checked + '>' +
          '<span>' + escapeHtml(store.name || '-') + '</span>' +
        '</label>'
      );
    }).join('');

    renderCreateStoreCount();
    setStoreCheckboxDisabledState(createState.saving);
  }

  function syncCreateFormControls() {
    requireElement('users-create-name').value = createState.name;
    requireElement('users-create-email').value = createState.email;
    requireElement('users-create-role').value = createState.role;
    requireElement('users-create-active').checked = createState.active;
    requireElement('users-create-store-search').value = createState.search;
    requireElement('users-create-password').value = createState.password;
    renderCreateStoreList();
    renderCreateStoreCount();
    setPasswordVisibility(createState.passwordVisible);
    syncStoresDropdownState({ focusSearch: false });
  }

  function openCreateModal() {
    createState.open = true;
    createState.error = '';
    createState.success = null;
    createState.editingUser = null;
    createState.fieldErrors = {
      email: '',
      name: '',
      role: '',
      stores: '',
      password: '',
    };
    createState.name = '';
    createState.email = '';
    createState.role = 'USER';
    createState.active = true;
    createState.search = '';
    createState.selectedStoreIds = [];
    createState.password = generateTemporaryPassword();
    createState.passwordVisible = true;
    createState.storesOpen = false;
    createState.trigger = document.activeElement;

    var modal = requireElement('users-create-modal');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    setCreateError('');
    setCreateSuccess(null);
    clearCreateFieldErrors();
    setCreateSaving(false);
    setCreateModalMode('create');
    syncCreateFormControls();

    window.setTimeout(function focusName() {
      var nameInput = document.getElementById('users-create-name');
      if (nameInput && typeof nameInput.focus === 'function') {
        nameInput.focus();
      }
    }, 0);
  }

  function openEditModal(user) {
    if (!user) return;

    createState.open = true;
    createState.error = '';
    createState.success = null;
    createState.editingUser = user;
    createState.fieldErrors = {
      email: '',
      name: '',
      role: '',
      stores: '',
      password: '',
    };
    createState.name = user.name || '';
    createState.email = user.email || '';
    createState.role = String(user.role || 'USER').toUpperCase();
    createState.active = user.status !== 'blocked' && user.active !== false;
    createState.search = '';
    createState.selectedStoreIds = Array.isArray(user.stores) ? user.stores.map(function mapStore(store) {
      return Number(store.id);
    }).filter(function validStoreId(id) {
      return Number.isInteger(id) && id > 0;
    }) : [];
    createState.password = '';
    createState.passwordVisible = false;
    createState.storesOpen = false;
    createState.trigger = document.activeElement;

    var modal = requireElement('users-create-modal');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    setCreateError('');
    setCreateSuccess(null);
    clearCreateFieldErrors();
    setCreateSaving(false);
    setCreateModalMode('edit');
    syncCreateFormControls();

    window.setTimeout(function focusName() {
      var nameInput = document.getElementById('users-create-name');
      if (nameInput && typeof nameInput.focus === 'function') {
        nameInput.focus();
      }
    }, 0);
  }

  function closeCreateModal() {
    var modal = document.getElementById('users-create-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }

    createState.open = false;
    createState.storesOpen = false;
    setCreateSaving(false);
    setCreateError('');
    setCreateSuccess(null);
    createState.editingUser = null;
    clearCreateFieldErrors();
    syncStoresDropdownState({ focusSearch: false });

    if (createState.trigger && typeof createState.trigger.focus === 'function') {
      createState.trigger.focus();
    }

    createState.trigger = null;
  }

  function updateCreateStateFromControls() {
    createState.name = normalizeText(requireElement('users-create-name').value);
    createState.email = normalizeText(requireElement('users-create-email').value);
    createState.role = normalizeText(requireElement('users-create-role').value).toUpperCase() || 'USER';
    createState.active = Boolean(requireElement('users-create-active').checked);
    createState.search = normalizeText(requireElement('users-create-store-search').value);
    createState.password = normalizeText(requireElement('users-create-password').value);
    if (createState.success) {
      setCreateSuccess(null);
    }
  }

  function validateCreateForm() {
    updateCreateStateFromControls();
    clearCreateFieldErrors();
    setCreateError('');

    var hasError = false;
    var payload = {
      email: normalizeEmail(createState.email),
      isActive: createState.active,
      name: createState.name,
      role: createState.role,
      storeIds: getSelectedStoreIds(),
      password: normalizeText(createState.password),
    };

    if (!payload.name) {
      setCreateFieldError('name', 'Informe o nome completo.');
      hasError = true;
    } else if (payload.name.length > 120) {
      setCreateFieldError('name', 'Nome muito longo.');
      hasError = true;
    }

    if (!payload.email) {
      setCreateFieldError('email', 'Informe o e-mail.');
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      setCreateFieldError('email', 'E-mail inválido.');
      hasError = true;
    }

    if (!['USER', 'ADMIN'].includes(payload.role)) {
      setCreateFieldError('role', 'Selecione um perfil válido.');
      hasError = true;
    }

    if (payload.password && payload.password.length < 8) {
      setCreateFieldError('password', 'A senha deve ter ao menos 8 caracteres.');
      hasError = true;
    }

    if (payload.role === 'USER' && !payload.storeIds.length) {
      setCreateFieldError('stores', 'Selecione pelo menos uma loja para o perfil Loja.');
      hasError = true;
    }

    if (hasError) {
      setCreateError('Corrija os campos destacados.');
      return null;
    }

    if (!payload.password) {
      payload.password = createState.mode === 'create' ? generateTemporaryPassword() : '';
      createState.password = payload.password;
      syncCreateFormControls();
    }

    return payload;
  }

  async function submitCreateUser(event) {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    var actionName = createState.mode === 'edit' ? 'updateUser' : 'createUser';
    if (!currentDeps || typeof currentDeps[actionName] !== 'function') {
      setCreateError('Dependência de salvamento ausente.');
      return;
    }

    if (createState.saving) return;

    var payload = validateCreateForm();
    if (!payload) return;

    try {
      setCreateSaving(true);
      var saved;
      if (createState.mode === 'edit') {
        saved = await currentDeps.updateUser(createState.editingUser && createState.editingUser.id, payload, currentDeps);
        setCreateSaving(false);
        closeCreateModal();
        if (currentDeps.showToast) {
          currentDeps.showToast('Usuário atualizado com sucesso.');
        }
      } else {
        saved = await currentDeps.createUser(payload, currentDeps);
        setCreateSaving(false);
        setCreateError('');
        setCreateSuccess({
          email: saved.email,
          temporaryPassword: saved.temporaryPassword || payload.password,
        });
        if (currentDeps.showToast) {
          currentDeps.showToast('Usuário criado. Senha temporária gerada.');
        }
      }

      pageState.page = 1;
      await loadUsers();
      return saved;
    } catch (error) {
      setCreateSaving(false);
      var code = String(error && error.code || '').toUpperCase();
      var rawMessage = String(error && error.message || '');
      if (!code && /rate limit/i.test(rawMessage)) {
        code = 'RATE_LIMITED';
      }
      var messageMap = {
        EMAIL_ALREADY_EXISTS: 'Já existe um usuário cadastrado com este e-mail.',
        INVALID_EMAIL: 'E-mail inválido.',
        INVALID_ROLE: 'Selecione um perfil válido.',
        INVALID_STORE: 'Uma das lojas selecionadas não está disponível.',
        RATE_LIMITED: 'Ação temporariamente limitada. Aguarde alguns minutos e tente novamente.',
        MANUAL_RECOVERY_REQUIRED: 'O cadastro não foi concluído. Verifique os logs administrativos.',
        STORE_REQUIRED: 'Selecione pelo menos uma loja para o perfil Loja.',
      };

      var message = messageMap[code] || '';
      if (!message && /rate limit/i.test(rawMessage)) {
        message = messageMap.RATE_LIMITED;
      }

      if (message) {
        if (code === 'INVALID_EMAIL') {
          setCreateFieldError('email', message);
        } else if (code === 'INVALID_ROLE') {
          setCreateFieldError('role', message);
        } else if (code === 'INVALID_STORE' || code === 'STORE_REQUIRED') {
          setCreateFieldError('stores', message);
        } else if (code === 'INVALID_NAME') {
          setCreateFieldError('name', message);
        } else if (code === 'EMAIL_ALREADY_EXISTS') {
          setCreateFieldError('email', message);
        }
        setCreateError(message);
      } else {
        setCreateError(rawMessage || 'Não foi possível criar o usuário.');
      }

      if (currentDeps.showToast) {
        currentDeps.showToast(createState.error || 'Não foi possível criar o usuário.');
      }
    }
  }

  function toggleExportMenu() {
    exportMenuOpen = !exportMenuOpen;
    var menu = document.getElementById('users-export-menu');
    if (!menu) return;
    menu.classList.toggle('hidden', !exportMenuOpen);
    menu.setAttribute('aria-hidden', exportMenuOpen ? 'false' : 'true');
    if (!exportMenuOpen) {
      if (exportMenuTrigger && typeof exportMenuTrigger.focus === 'function') {
        exportMenuTrigger.focus();
      }
      exportMenuTrigger = null;
    }
  }

  function downloadCsv(content, filename) {
    var blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'usuarios.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function escapeCsv(value) {
    var str = String(value ?? '');
    if (/[";\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    if (/^[=+\-@\t\r]/.test(str)) {
      return "'" + str;
    }
    return str;
  }

  async function handleExport(allUsers) {
    if (!currentDeps || typeof currentDeps.exportUsers !== 'function') {
      showImportError('Dependencia exportUsers ausente.');
      return;
    }

    try {
      var filters = allUsers ? {} : {
        search: pageState.filters.search,
        role: pageState.filters.role,
        status: pageState.filters.status,
        storeId: pageState.filters.storeId,
      };
      var users = await currentDeps.exportUsers(filters, currentDeps);
      if (!Array.isArray(users) || !users.length) {
        if (currentDeps.showToast) {
          currentDeps.showToast('Nenhum usuario encontrado para exportar.');
        }
        return;
      }

      var header = ['nome', 'email', 'perfil', 'status', 'ativo', 'lojas_codigos', 'lojas_ids', 'lojas_nomes', 'criado_em', 'ultimo_acesso'];
      var rows = users.map(function mapUser(u) {
        var storeCodes = (u.stores || []).map(function mapStore(s) { return s.codigo; }).filter(Boolean).join(';');
        var storeIds = (u.stores || []).map(function mapStore(s) { return s.id; }).join(';');
        var storeNames = (u.stores || []).map(function mapStore(s) { return s.name; }).join(';');
        return [
          escapeCsv(u.name), escapeCsv(u.email), escapeCsv(u.role),
          escapeCsv(u.status), u.active ? 'sim' : 'nao',
          escapeCsv(storeCodes), escapeCsv(storeIds), escapeCsv(storeNames),
          escapeCsv(u.createdAt || ''), escapeCsv(u.lastSignInAt || ''),
        ].join(';');
      });

      var csv = header.join(';') + '\n' + rows.join('\n');
      var label = allUsers ? 'todos' : 'filtrados';
      downloadCsv(csv, 'usuarios-' + label + '-' + new Date().toISOString().slice(0, 10) + '.csv');
      toggleExportMenu();

      if (currentDeps.showToast) {
        currentDeps.showToast(users.length + ' usuario(s) exportado(s).');
      }
    } catch (error) {
      showImportError(error && error.message ? error.message : 'Falha ao exportar usuarios.');
    }
  }

  function showImportError(message) {
    importState.error = message || '';
    var el = document.getElementById('users-import-error');
    if (!el) return;
    el.textContent = importState.error;
    el.classList.toggle('hidden', !importState.error);
  }

  function setImportStep(step) {
    importState.step = step;
    var steps = ['file', 'preview', 'result'];
    steps.forEach(function eachStep(s) {
      var el = document.getElementById('users-import-step-' + s);
      if (el) el.classList.toggle('hidden', s !== step);
    });

    var confirmBtn = document.getElementById('users-import-confirm');
    var backBtn = document.getElementById('users-import-back');
    var closeBtn = document.getElementById('users-import-close');
    var cancelBtn = document.getElementById('users-import-cancel');

    if (confirmBtn) confirmBtn.classList.toggle('hidden', step !== 'preview');
    if (backBtn) backBtn.classList.toggle('hidden', step !== 'preview');
    if (closeBtn) closeBtn.classList.toggle('hidden', step !== 'result');
    if (cancelBtn) cancelBtn.classList.toggle('hidden', step === 'result');
  }

  function resetImportState() {
    importState.file = null;
    importState.fileName = '';
    importState.rows = [];
    importState.validation = null;
    importState.result = null;
    importState.importing = false;
    importState.error = '';
    showImportError('');
    setImportStep('file');

    var fileInput = document.getElementById('users-import-file');
    if (fileInput) fileInput.value = '';
  }

  function closeImportModal() {
    var modal = document.getElementById('users-import-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    importState.open = false;
    resetImportState();
    if (importState.trigger && typeof importState.trigger.focus === 'function') {
      importState.trigger.focus();
    }
    importState.trigger = null;
  }

  function openImportModal() {
    importState.open = true;
    importState.trigger = document.activeElement;
    resetImportState();

    var modal = document.getElementById('users-import-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }

    window.setTimeout(function focusImport() {
      var dz = document.getElementById('users-import-dropzone');
      if (dz && typeof dz.focus === 'function') dz.focus();
    }, 0);
  }

  function parseFileRows(data) {
    if (!data || !data.length) return [];
    var header = data[0].map(function mapCell(c) { return String(c || '').trim().toLowerCase(); });
    var colMap = {};
    var aliases = {
      nome: 'nome', name: 'nome', 'nome completo': 'nome', 'nome*': 'nome',
      email: 'email', 'e-mail': 'email', e_mail: 'email', 'email*': 'email',
      perfil: 'perfil', role: 'perfil', perfil_usuário: 'perfil', 'perfil*': 'perfil',
      status: 'status', ativo: 'status',
      lojas: 'lojas', stores: 'lojas', 'lojas vinculadas': 'lojas', 'ids lojas': 'lojas',
    };
    header.forEach(function eachCol(col, idx) {
      var key = aliases[col];
      if (key) colMap[key] = idx;
    });

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row || !row.length) continue;
      var isEmpty = row.every(function checkEmpty(cell) { return !String(cell || '').trim(); });
      if (isEmpty) continue;
      var obj = {};
      Object.keys(colMap).forEach(function eachKey(key) {
        var index = colMap[key];
        obj[key] = index < row.length ? String(row[index] || '').trim() : '';
      });
      rows.push(obj);
    }
    return rows;
  }

  function handleImportFile(file) {
    importState.file = file;
    importState.fileName = file ? file.name : '';

    if (!file) {
      showImportError('Nenhum arquivo selecionado.');
      return;
    }

    var ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      showImportError('Formato invalido. Use .xlsx ou .csv.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showImportError('Arquivo excede 2 MB.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function onFileLoad(e) {
      try {
        var raw = e.target.result;
        var data;

        if (ext === 'csv') {
          var text = typeof raw === 'string' ? raw : new TextDecoder('utf-8').decode(raw);
          var lines = text.split(/\r?\n/).filter(Boolean);
          var delim = lines.length && lines[0].indexOf(';') >= 0 ? ';' : ',';
          data = lines.map(function mapLine(line) {
            var cells = [];
            var current = '';
            var inQuotes = false;
            for (var c = 0; c < line.length; c++) {
              var ch = line[c];
              if (ch === '"') {
                inQuotes = !inQuotes;
              } else if (ch === delim && !inQuotes) {
                cells.push(current);
                current = '';
              } else {
                current += ch;
              }
            }
            cells.push(current);
            return cells.map(function trimCell(cell) { return cell.trim(); });
          });
        } else {
          if (typeof XLSX === 'undefined') {
            showImportError('Biblioteca XLSX nao carregada.');
            return;
          }
          var workbook = XLSX.read(raw, { type: 'array' });
          var sheetName = workbook.SheetNames[0];
          var sheet = workbook.Sheets[sheetName];
          data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        }

        importState.rows = parseFileRows(data);
        if (!importState.rows.length) {
          showImportError('Nenhuma linha de dados encontrada no arquivo.');
          return;
        }

        if (importState.rows.length > 200) {
          showImportError('Maximo de 200 linhas por importacao.');
          return;
        }

        showImportError('');
        validateAndShowPreview();
      } catch (parseError) {
        showImportError('Erro ao ler arquivo: ' + (parseError.message || 'formato invalido.'));
      }
    };

    if (ext === 'csv') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  async function validateAndShowPreview() {
    if (!currentDeps || typeof currentDeps.validateImport !== 'function') {
      showImportError('Dependencia validateImport ausente.');
      return;
    }

    try {
      var validation = await currentDeps.validateImport(importState.rows, currentDeps);
      importState.validation = validation;
      renderImportPreview(validation);
      setImportStep('preview');
    } catch (error) {
      showImportError(error && error.message ? error.message : 'Falha ao validar dados.');
    }
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderImportPreview(validation) {
    var validCount = document.getElementById('users-import-count-valid');
    var invalidCount = document.getElementById('users-import-count-invalid');
    var tbody = document.getElementById('users-import-preview-body');

    if (validCount) validCount.textContent = (validation.validCount || 0) + ' valido(s)';
    if (invalidCount) invalidCount.textContent = (validation.invalidCount || 0) + ' invalido(s)';

    if (!tbody) return;

    var invalidByEmail = {};
    (validation.invalid || []).forEach(function eachInvalid(row) {
      invalidByEmail[escapeAttr(row.row.email || row.original?.email || '')] = true;
    });
    var invalidMap = {};
    (validation.invalid || []).forEach(function each(r) {
      var email = r.row.email || r.original?.email || '';
      invalidMap[email] = (invalidMap[email] || []).concat(r.errors || []);
    });

    var html = '';
    var combined = [];

    (validation.valid || []).forEach(function eachValid(row) {
      combined.push({ email: row.email, name: row.name, role: row.role, storeCodes: row.storeCodes || row.storeIds, isActive: row.isActive, valid: true, errors: [] });
    });
    (validation.invalid || []).forEach(function eachInvalid(r) {
      combined.push({ email: r.row.email || r.original?.email || '', name: r.row.name || r.original?.nome || '', role: r.row.role || '', storeCodes: r.row.storeCodes || r.row.storeIds || [], isActive: r.row.isActive, valid: false, errors: r.errors });
    });

    combined.forEach(function eachRow(item, idx) {
      var roleLabel = item.role === 'ADMIN' ? 'Administrador' : 'Loja';
      var statusIcon = item.isActive !== false ? 'Ativo' : 'Bloqueado';
      var storesStr = Array.isArray(item.storeCodes) ? item.storeCodes.join('; ') : '';
      var rowClass = item.valid ? '' : ' users-import-row--invalid';
      var errorsHtml = '';
      if (item.errors && item.errors.length) {
        errorsHtml = '<span class="users-import-error-msg">' + item.errors.map(function mapErr(e) {
          return escapeAttr(e.field ? e.field + ': ' + e.message : e.message || e);
        }).join(', ') + '</span>';
      }
      html += '<tr class="' + rowClass + '">' +
        '<td>' + (idx + 1) + '</td>' +
        '<td>' + escapeAttr(item.name) + errorsHtml + '</td>' +
        '<td>' + escapeAttr(item.email) + '</td>' +
        '<td>' + roleLabel + '</td>' +
        '<td>' + escapeAttr(storesStr) + '</td>' +
        '<td>' + statusIcon + '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
  }

  async function handleImportConfirm() {
    if (importState.importing) return;
    if (!currentDeps || typeof currentDeps.importUsers !== 'function') {
      showImportError('Dependencia importUsers ausente.');
      return;
    }

    try {
      importState.importing = true;
      var confirmBtn = document.getElementById('users-import-confirm');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.querySelector('span').textContent = 'Importando...';
      }

      var result = await currentDeps.importUsers(importState.rows, currentDeps);
      importState.result = result;
      renderImportResult(result);
      setImportStep('result');

      if (currentDeps.showToast) {
        currentDeps.showToast(result.created + ' usuario(s) importado(s).');
      }

      pageState.page = 1;
      await loadUsers();
    } catch (error) {
      showImportError(error && error.message ? error.message : 'Falha ao importar usuarios.');
    } finally {
      importState.importing = false;
    }
  }

  function renderImportResult(result) {
    var createdEl = document.getElementById('users-import-result-created');
    var failedEl = document.getElementById('users-import-result-failed');
    var skippedEl = document.getElementById('users-import-result-skipped');
    var tbody = document.getElementById('users-import-result-body');

    if (createdEl) createdEl.textContent = (result.created || 0) + ' criado(s)';
    if (failedEl) failedEl.textContent = (result.failed || 0) + ' falha(s)';
    if (skippedEl) skippedEl.textContent = (result.skipped || 0) + ' ignorado(s)';

    if (!tbody) return;

    var html = '';
    (result.results || []).forEach(function eachResult(r) {
      var statusLabel, statusClass;
      if (r.status === 'created') {
        statusLabel = 'Criado';
        statusClass = 'users-import-status--created';
      } else if (r.status === 'failed') {
        statusLabel = 'Falha';
        statusClass = 'users-import-status--failed';
      } else {
        statusLabel = 'Ignorado';
        statusClass = 'users-import-status--skipped';
      }

      var details = '';
      if (r.temporaryPassword) {
        details = 'Senha temporaria gerada.';
      } else if (r.errorMessage) {
        details = escapeAttr(r.errorMessage);
      } else if (r.errors && r.errors.length) {
        details = escapeAttr(r.errors.join('; '));
      }

      html += '<tr>' +
        '<td>' + escapeAttr(r.name) + '</td>' +
        '<td>' + escapeAttr(r.email) + '</td>' +
        '<td><span class="users-import-status ' + statusClass + '">' + statusLabel + '</span></td>' +
        '<td class="users-import-details">' + details + '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html;

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function downloadTemplate() {
    var header = ['nome', 'email', 'perfil', 'status', 'lojas'];
    var example = ['Maria Silva', 'maria@exemplo.com', 'Loja', 'ativo', '21477'];
    var csv = '\uFEFF' + header.join(';') + '\n' + example.join(';') + '\n';
    downloadCsv(csv, 'modelo-importacao-usuarios.csv');
  }

  function onModalClick(event) {
    var target = event.target;
    var closer = target && typeof target.closest === 'function'
      ? target.closest('[data-close-create-modal="true"]')
      : target && target.getAttribute && target.getAttribute('data-close-create-modal') === 'true'
        ? target
        : null;
    if (closer) {
      closeCreateModal();
      return;
    }

    if (createState.open && createState.storesOpen && !isStoreDropdownTarget(target)) {
      setStoresDropdownOpen(false, { focusTrigger: false });
    }
  }

  function onModalKeydown(event) {
    if (importState.open && event.key === 'Escape') {
      event.preventDefault();
      closeImportModal();
      return;
    }

    if (!createState.open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (createState.storesOpen) {
        setStoresDropdownOpen(false, { focusTrigger: true });
        return;
      }

      closeCreateModal();
      return;
    }

    if (event.key !== 'Tab') return;

    var modal = document.getElementById('users-create-modal');
    if (!modal || typeof modal.querySelectorAll !== 'function') return;

    var focusables = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    focusables = focusables.filter(function filterFocusable(element) {
      return element && typeof element.getClientRects === 'function' && element.getClientRects().length > 0;
    });

    if (!focusables.length) return;

    var current = document.activeElement;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var modalContains = typeof modal.contains === 'function' ? modal.contains(current) : false;

    if (!modalContains) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if (event.shiftKey) {
      if (current === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onCreateStoreToggle(event) {
    var target = event.target;
    if (!target || target.type !== 'checkbox') return;
    var storeId = Number(target.value);
    if (!Number.isInteger(storeId) || storeId <= 0) return;

    if (target.checked) {
      if (createState.selectedStoreIds.indexOf(storeId) === -1) {
        createState.selectedStoreIds.push(storeId);
      }
    } else {
      createState.selectedStoreIds = createState.selectedStoreIds.filter(function filterSelected(id) {
        return Number(id) !== storeId;
      });
    }

    clearCreateFieldErrors();
    setCreateError('');
    renderCreateStoreCount();
  }

  function findUserById(userId) {
    var targetId = String(userId || '');
    for (var index = 0; index < pageState.users.length; index += 1) {
      if (String(pageState.users[index].id) === targetId) {
        return pageState.users[index];
      }
    }
    return null;
  }

  async function handleTableAction(event) {
    var target = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-user-action]')
      : null;
    if (!target) return;

    var userId = target.getAttribute('data-user-id');
    var action = target.getAttribute('data-user-action');
    var user = findUserById(userId);
    if (!user) return;

    if (action === 'edit') {
      openEditModal(user);
      return;
    }

    if (action === 'delete') {
      if (!currentDeps || typeof currentDeps.deleteUser !== 'function') {
        setCreateError('Dependência deleteUser ausente.');
        return;
      }

      var confirmed = await ConfirmModal.confirm(
        'Remover usuário',
        'Este usuário perderá o acesso à plataforma, mas continuará identificado nos pedidos e registros históricos.'
      );
      if (!confirmed) return;

      currentDeps.deleteUser(user.id, currentDeps)
        .then(function afterRemove() {
          if (currentDeps.showToast) {
            currentDeps.showToast('Usuário removido com sucesso.');
          }
          pageState.page = 1;
          return loadUsers();
        })
        .catch(function onRemoveError(error) {
          setCreateError(error && error.message ? error.message : 'Não foi possível remover o usuário.');
          if (currentDeps.showToast) {
            currentDeps.showToast(error && error.message ? error.message : 'Não foi possível remover o usuário.');
          }
        });
    }
  }

  async function loadUsers() {
    if (!currentDeps || typeof currentDeps.listUsers !== 'function') {
      throw new Error('Dependencia listUsers ausente.');
    }

    var loadToken = ++currentLoadToken;
    pageState.loading = true;
    renderLoadingState(true);

    try {
      var response = await currentDeps.listUsers({
        page: pageState.page,
        pageSize: pageState.pageSize,
        role: pageState.filters.role,
        search: pageState.filters.search,
        status: pageState.filters.status,
        storeId: pageState.filters.storeId,
      }, currentDeps);

      if (loadToken !== currentLoadToken) return;

      pageState.users = response.items || [];
      pageState.total = Number(response.total) || 0;
      pageState.totalPages = Number(response.totalPages) || 1;
      pageState.page = Number(response.page) || 1;
      pageState.pageSize = Number(response.pageSize) || DEFAULT_PAGE_SIZE;

      updateStoreFilter(response.stores || [], pageState.filters.storeId);
      requireElement('users-count').textContent = pageState.total + ' usuário(s) encontrado(s)';
      requireElement('users-summary').innerHTML = renderSummary(response.summary || {});
      renderPagination(pageState.totalPages, pageState.page);
      renderUsersTable(pageState.users);

      if (global.lucide && typeof global.lucide.createIcons === 'function') {
        global.lucide.createIcons();
      }
    } catch (error) {
      if (loadToken !== currentLoadToken) return;
      pageState.users = [];
      pageState.total = 0;
      pageState.totalPages = 1;
      renderErrorState(error && error.message ? error.message : 'Não foi possível carregar os usuários.');
      requireElement('users-count').textContent = '0 usuário(s) encontrado(s)';
    } finally {
      if (loadToken === currentLoadToken) {
        pageState.loading = false;
      }
    }
  }

  function refreshUsers(resetPage) {
    if (resetPage !== false) {
      pageState.page = 1;
    }
    readFiltersFromControls();
    loadUsers();
  }

  function goToPreviousPage() {
    if (pageState.page <= 1) return;
    pageState.page -= 1;
    loadUsers();
  }

  function goToNextPage() {
    if (pageState.page >= pageState.totalPages) return;
    pageState.page += 1;
    loadUsers();
  }

  function beforeLeave() {
    resetListeners();
    currentDeps = null;
    currentLoadToken += 1;
    createState.open = false;
    createState.storesOpen = false;
    createState.trigger = null;
    importState.open = false;
    importState.step = 'file';
    importState.file = null;
    importState.rows = [];
    importState.validation = null;
    importState.result = null;
    importState.importing = false;
    importState.error = '';
    importState.trigger = null;
    exportMenuOpen = false;
    exportMenuTrigger = null;
  }

  async function afterRenderUsuarios(deps) {
    beforeLeave();
    currentDeps = deps || {};
    pageState.filters = {
      role: '',
      search: '',
      status: '',
      storeId: '',
    };
    pageState.loading = false;
    pageState.page = 1;
    pageState.pageSize = DEFAULT_PAGE_SIZE;
    pageState.total = 0;
    pageState.totalPages = 1;
    pageState.users = [];
    pageState.stores = [];

    createState.active = true;
    createState.email = '';
    createState.error = '';
    createState.editingUser = null;
    createState.success = null;
    createState.fieldErrors = {
      email: '',
      name: '',
      role: '',
      stores: '',
      password: '',
    };
    createState.name = '';
    createState.open = false;
    createState.password = '';
    createState.passwordVisible = false;
    createState.mode = 'create';
    createState.role = 'USER';
    createState.saving = false;
    createState.search = '';
    createState.selectedStoreIds = [];
    createState.storesOpen = false;
    createState.trigger = null;

    requireElement('users-summary').innerHTML = renderSummary({});
    requireElement('users-count').textContent = 'Carregando usuários...';
    setCreateModalMode('create');
    renderStoreOptions([], '');
    syncStoresDropdownState({ focusSearch: false });
    syncFiltersToControls();
    renderLoadingState(true);

    bindListener(requireElement('users-search'), 'input', function onSearchInput() {
      refreshUsers();
    });
    bindListener(requireElement('users-role'), 'change', function onRoleChange() {
      refreshUsers();
    });
    bindListener(requireElement('users-status'), 'change', function onStatusChange() {
      refreshUsers();
    });
    bindListener(requireElement('users-store'), 'change', function onStoreChange() {
      refreshUsers();
    });
    bindListener(requireElement('users-refresh'), 'click', function onRefreshClick(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      refreshUsers(false);
    });
    bindListener(requireElement('users-prev'), 'click', function onPreviousClick(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      goToPreviousPage();
    });
    bindListener(requireElement('users-next'), 'click', function onNextClick(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      goToNextPage();
    });
    bindListener(requireElement('users-error-retry'), 'click', function onRetryClick(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      loadUsers();
    });
    bindListener(requireElement('users-create-open'), 'click', function onCreateOpen(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      openCreateModal();
    });
    bindListener(requireElement('users-create-modal'), 'click', onModalClick);
    bindListener(document, 'keydown', onModalKeydown);
    bindListener(requireElement('users-create-form'), 'submit', submitCreateUser);
    bindListener(requireElement('users-table-body'), 'click', handleTableAction);
    bindListener(requireElement('users-create-copy-password'), 'click', function onCopyPassword(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }

      var password = String(createState.success && createState.success.temporaryPassword || '');
      if (!password) return;

      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(password).catch(function ignoreClipboardError() {});
      }

      if (currentDeps.showToast) {
        currentDeps.showToast('Senha temporária copiada.');
      }
    });
    bindListener(requireElement('users-create-cancel'), 'click', function onCancelCreate(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      closeCreateModal();
    });
    bindListener(requireElement('users-create-role'), 'change', function onCreateRoleChange() {
      updateCreateStateFromControls();
      clearCreateFieldErrors();
      setCreateError('');
      renderCreateStoreList();
    });
    bindListener(requireElement('users-create-store-trigger'), 'click', function onStoreTriggerClick(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }

      if (createState.saving) return;

      setStoresDropdownOpen(!createState.storesOpen, {
        focusSearch: true,
      });
    });
    bindListener(requireElement('users-create-toggle-password'), 'click', function onTogglePassword(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      setPasswordVisibility(!createState.passwordVisible);
    });
    bindListener(requireElement('users-create-active'), 'change', function onCreateActiveChange() {
      updateCreateStateFromControls();
    });
    bindListener(requireElement('users-create-store-search'), 'input', function onCreateStoreSearch() {
      updateCreateStateFromControls();
      renderCreateStoreList();
    });
    bindListener(requireElement('users-create-store-list'), 'change', onCreateStoreToggle);

    bindListener(requireElement('users-import-open'), 'click', function onImportOpen(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      openImportModal();
    });
    bindListener(requireElement('users-import-modal'), 'click', function onImportModalClick(event) {
      var target = event.target;
      var closer = target && typeof target.closest === 'function'
        ? target.closest('[data-close-import-modal="true"]')
        : null;
      if (closer) { closeImportModal(); return; }
    });
    bindListener(requireElement('users-import-cancel'), 'click', function onImportCancel(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      closeImportModal();
    });
    bindListener(requireElement('users-import-close'), 'click', function onImportClose(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      closeImportModal();
    });
    bindListener(requireElement('users-import-back'), 'click', function onImportBack(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      setImportStep('file');
    });
    bindListener(requireElement('users-import-confirm'), 'click', function onImportConfirm(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      handleImportConfirm();
    });
    bindListener(requireElement('users-import-file'), 'change', function onImportFileChange(event) {
      var files = event.target && event.target.files;
      if (files && files.length) handleImportFile(files[0]);
    });

    var dropzone = document.getElementById('users-import-dropzone');
    if (dropzone) {
      bindListener(dropzone, 'click', function onDropzoneClick() {
        var input = document.getElementById('users-import-file');
        if (input) input.click();
      });
      bindListener(dropzone, 'dragover', function onDragOver(event) {
        event.preventDefault();
        dropzone.classList.add('users-import-dropzone--active');
      });
      bindListener(dropzone, 'dragleave', function onDragLeave() {
        dropzone.classList.remove('users-import-dropzone--active');
      });
      bindListener(dropzone, 'drop', function onDrop(event) {
        event.preventDefault();
        dropzone.classList.remove('users-import-dropzone--active');
        var files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) handleImportFile(files[0]);
      });
    }

    bindListener(requireElement('users-import-template'), 'click', function onDownloadTemplate(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      downloadTemplate();
    });

    bindListener(requireElement('users-export-btn'), 'click', function onExportToggle(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      exportMenuTrigger = document.activeElement;
      toggleExportMenu();
    });
    bindListener(requireElement('users-export-filtered'), 'click', function onExportFiltered(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      handleExport(false);
    });
    bindListener(requireElement('users-export-all'), 'click', function onExportAll(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      handleExport(true);
    });

    document.addEventListener('click', function onDocumentClick(event) {
      if (!exportMenuOpen) return;
      var target = event.target;
      var btn = document.getElementById('users-export-btn');
      var menu = document.getElementById('users-export-menu');
      var isBtn = btn && (target === btn || btn.contains(target));
      var isMenu = menu && (target === menu || menu.contains(target));
      if (!isBtn && !isMenu) toggleExportMenu();
    });

    if (deps && deps.params) {
      pageState.filters.search = normalizeText(deps.params.search || '');
      pageState.filters.role = normalizeText(deps.params.role || '');
      pageState.filters.status = normalizeText(deps.params.status || '');
      pageState.filters.storeId = normalizeText(deps.params.storeId || '');
      pageState.page = Math.max(1, Number(deps.params.page) || 1);
      syncFiltersToControls();
    }

    await loadUsers();
  }

  global.UsersModule = {
    afterRenderUsuarios: afterRenderUsuarios,
    beforeLeave: beforeLeave,
    getState: function getState() {
      return {
        filters: {
          role: pageState.filters.role,
          search: pageState.filters.search,
          status: pageState.filters.status,
          storeId: pageState.filters.storeId,
        },
        loading: pageState.loading,
        page: pageState.page,
        pageSize: pageState.pageSize,
        stores: pageState.stores.slice(),
        total: pageState.total,
        totalPages: pageState.totalPages,
        users: pageState.users.slice(),
      };
    },
  };
})(window);
