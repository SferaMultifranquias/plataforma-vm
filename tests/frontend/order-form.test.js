const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createErrorSlot(field) {
  return {
    classList: {
      add() {},
      remove() {},
    },
    textContent: '',
    field,
  };
}

function createElement(id, options = {}) {
  var elemClasses = [];
  var listeners = {};
  const element = {
    attributes: {},
    classList: {
      add(name) { if (!elemClasses.includes(name)) elemClasses.push(name); },
      remove(name) { elemClasses = elemClasses.filter(function(c) { return c !== name; }); },
      contains(name) { return elemClasses.includes(name); },
      toggle(name) {
        if (elemClasses.includes(name)) { elemClasses = elemClasses.filter(function(c) { return c !== name; }); return false; }
        elemClasses.push(name); return true;
      },
    },
    dataset: options.dataset || {},
    disabled: Boolean(options.disabled),
    files: options.files || [],
    id,
    innerHTML: options.innerHTML || '',
    listeners,
    querySelector(selector) {
      if (selector === '#btn-submit-label') {
        return element._submitLabel || null;
      }

      return null;
    },
    getAttribute(name) { return this.attributes[name] !== undefined ? this.attributes[name] : null; },
    selectedOptions: options.selectedOptions || [],
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    textContent: options.textContent || '',
    value: options.value || '',
    addEventListener(type, handler) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    click() {
      const handlers = listeners.click || [];
      handlers.forEach((handler) => handler({ preventDefault() {}, target: element }));
    },
  };

  return element;
}

function createItemRow() {
  const fields = {
    customerCode: createElement('customerCode', { value: 'ABC123' }),
    description: createElement('description', { value: 'Descricao do item' }),
    notes: createElement('notes', { value: 'Observacoes' }),
    quantity: createElement('quantity', { value: '2' }),
  };

  return {
    getAttribute(name) {
      if (name === 'data-item-id') return 'item-1';
      if (name === 'data-order-item') return 'true';
      return null;
    },
    querySelector(selector) {
      if (selector === '[data-field="customerCode"]' || selector === '[data-field="productCode"]') return fields.customerCode;
      if (selector === '[data-field="description"]') return fields.description;
      if (selector === '[data-field="notes"]') return fields.notes;
      if (selector === '[data-field="quantity"]') return fields.quantity;
      return null;
    },
  };
}

function createSandbox() {
  const elements = new Map();
  const errorSlots = new Map();
  const itemRows = [createItemRow()];

  const submitLabel = createElement('btn-submit-label', { textContent: 'Enviar Pedido' });
  const submitButton = createElement('btn-submit-form', { innerHTML: '<i data-lucide="send" class="w-4 h-4"></i> <span id="btn-submit-label">Enviar Pedido</span>' });
  submitButton._submitLabel = submitLabel;

  const document = {
    addEventListener() {},
    createElement(tag) {
      return createElement(tag);
    },
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);

      let element;
      if (id === 'btn-submit-form') {
        element = submitButton;
      } else if (id === 'btn-submit-label') {
        element = submitLabel;
      } else if (id === 'f-loja') {
        element = createElement(id, {
          selectedOptions: [
            {
              dataset: { brand: 'Marca VM', codigo: 'CC-10' },
              textContent: 'HALFELD',
            },
          ],
          value: '10',
        });
      } else if (id === 'f-tipo') {
        element = createElement(id, { value: 'Produto de Ciclo', selectedOptions: [{ text: 'Produto de Ciclo' }] });
      } else if (id === 'f-motivo') {
        element = createElement(id, { value: 'Falta de estoque', selectedOptions: [{ text: 'Falta de estoque' }] });
      } else if (id === 'foto-input') {
        element = createElement(id, { files: [] });
      } else if (id === 'upload-area' || id === 'upload-done' || id === 'items-container' || id === 'form-pedidos-recentes' || id === 'form-alertas-ativos' || id === 'btn-add-item' || id === 'btn-clear-form' || id === 'form-pedido' || id === 'f-brand' || id === 'f-cost-center' || id === 'f-purpose' || id === 'f-justification' || id === 'f-priority' || id === 'f-notes' || id === 'items-count' || id === 'foto-nome' || id === 'image-upload-label' || id === 'image-gallery' || id === 'image-gallery-count' || id === 'image-gallery-container') {
        element = createElement(id);
      } else if (id === 'btn-submit-label') {
        element = submitLabel;
      } else {
        element = createElement(id);
      }

      if (id === 'form-pedido') {
        element.querySelector = () => null;
      }

      elements.set(id, element);
      return element;
    },
    querySelector(selector) {
      const match = selector.match(/\[data-error-for="([^"]+)"\]/);
      if (match) {
        const field = match[1];
        if (!errorSlots.has(field)) {
          errorSlots.set(field, createErrorSlot(field));
        }
        return errorSlots.get(field);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-error-for]') {
        return Array.from(errorSlots.values());
      }

      if (selector === '#items-container [data-order-item="true"]') {
        return itemRows;
      }

      return [];
    },
  };

  var cleanHistory = { _url: '/', _state: null, replaceStateCount: 0 };

  const window = {
    OrderRules: null,
    console,
    crypto: {
      randomUUID() {
        return 'boot-test';
      },
      subtle: {
        digest() {
          return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
        },
      },
    },
    document,
    FormData,
    Promise,
    URL,
    setTimeout,
    clearTimeout,
    history: {
      get state() { return cleanHistory._state; },
      set state(val) { cleanHistory._state = val; },
      get _url() { return cleanHistory._url; },
      set _url(val) { cleanHistory._url = val; },
      get replaceStateCount() { return cleanHistory.replaceStateCount; },
      set replaceStateCount(val) { cleanHistory.replaceStateCount = val; },
      replaceState(state, title, url) {
        cleanHistory._state = state;
        cleanHistory._url = url || '/';
        cleanHistory.replaceStateCount += 1;
      },
    },
    location: {
      get href() { return 'http://localhost:3000' + cleanHistory._url; },
      set href(val) {
        var u = new URL(val, 'http://localhost:3000');
        cleanHistory._url = u.pathname + u.search + u.hash;
      },
    },
    lucide: {
      createIcons() {},
    },
    StoresModule: {
      findStoreById() {
        return null;
      },
      getStoreLoadState() {
        return { status: 'ready' };
      },
      getAllStores() {
        return [];
      },
    },
  };

  window.window = window;
  window.globalThis = window;
  window.addEventListener = function addEventListener() {};

  return { errorSlots, itemRows, submitButton, submitLabel, window };
}

function loadModule(file, window) {
  const code = read(file);
  vm.runInNewContext(code, window, { filename: file });
  return window;
}

function fillValidForm(window, includePhoto = true) {
  window.document.getElementById('f-loja').value = '10';
  window.document.getElementById('f-loja').selectedOptions = [
    {
      dataset: { brand: 'Marca VM', codigo: 'CC-10' },
      textContent: 'HALFELD',
    },
  ];
  window.document.getElementById('f-tipo').value = 'Produto de Ciclo';
  window.document.getElementById('f-tipo').selectedOptions = [{ text: 'Produto de Ciclo' }];
  window.document.getElementById('f-motivo').value = 'Falta de estoque';
  window.document.getElementById('f-motivo').selectedOptions = [{ text: 'Falta de estoque' }];

  const photoInput = window.document.getElementById('foto-input');
  const photoFiles = includePhoto
    ? [{
        name: 'foto.webp',
        size: 2048,
        type: 'image/webp',
        lastModified: 1000000,
      }]
    : [];
  photoInput.files = photoFiles;
  if (includePhoto && typeof window.FormModule?.addNewImages === 'function') {
    window.FormModule.addNewImages(photoFiles);
  }
}

function buildDeps(overrides = {}) {
  return {
    API_OK() {
      return true;
    },
    afterRenderForm() {
      return Promise.resolve();
    },
    carregarLojas() {
      return Promise.resolve([
        { id: 10, codigo: 'CC-10', marca: 'Marca VM', nome: 'HALFELD' },
      ]);
    },
    carregarPedidos() {
      return Promise.resolve([]);
    },
    currentUser: { id: 'user-1', papel: 'admin' },
    getCurrentUser() {
      return { id: 'user-1', papel: 'admin' };
    },
    showToast() {},
    ...overrides,
  };
}

function countOptionTags(select) {
  return ((select && select.innerHTML) || '').match(/<option value="[^"]+"/g)?.length || 0;
}

function makeUserStoresSb(rows, error) {
  return {
    from(table) {
      assert.equal(table, 'user_stores');
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: error ? null : rows,
                error: error || null,
              });
            },
          };
        },
      };
    },
  };
}

async function run() {
  const sandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), sandbox.window);
  loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), sandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), sandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), sandbox.window);

  const deps = buildDeps({
    enviarPedidoAPI() {
      return Promise.resolve({ protocolo: 'ORD-1', status: 'DRAFT' });
    },
  });

  await sandbox.window.FormModule.afterRenderFormulario(deps);

  const form = sandbox.window.document.getElementById('form-pedido');
  const submitButton = sandbox.window.document.getElementById('btn-submit-form');

  assert.equal((form.listeners.submit || []).length, 1);
  assert.equal((submitButton.listeners.click || []).length, 0);

  fillValidForm(sandbox.window, true);

  let submitCallCount = 0;
  deps.enviarPedidoAPI = function enviarPedidoAPI(payload) {
    submitCallCount += 1;
    assert.equal(payload.get('p_store_id'), null);
    assert.equal(payload.get('loja_id'), '10');
    return Promise.resolve({ protocolo: 'ORD-2', status: 'PENDING_APPROVAL' });
  };

  await sandbox.window.FormModule.submitForm(deps);
  assert.equal(submitCallCount, 1);

  fillValidForm(sandbox.window, true);
  const pendingCalls = [];
  deps.enviarPedidoAPI = function enviarPedidoAPI() {
    pendingCalls.push(Date.now());
    return new Promise((resolve) => {
      deps._resolveSubmit = resolve;
    });
  };

  const firstSubmit = sandbox.window.FormModule.submitForm(deps);
  const secondSubmit = sandbox.window.FormModule.submitForm(deps);
  assert.equal(pendingCalls.length, 1);
  assert.equal(submitButton.disabled, true);
  assert.equal(sandbox.window.document.getElementById('btn-submit-label').textContent, 'Enviando...');

  deps._resolveSubmit({ protocolo: 'ORD-3', status: 'DRAFT' });
  await firstSubmit;
  await secondSubmit;

  assert.equal(submitButton.disabled, false);
  assert.equal(sandbox.window.document.getElementById('btn-submit-label').textContent, 'Enviar Pedido');

  const editSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), editSandbox.window);
  loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), editSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), editSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), editSandbox.window);

  const editableOrder = {
    id: 'order-edit-1',
    internal_number: 'ORD-99',
    brand: 'Marca VM',
    cost_center: 'CC-10',
    justification: 'Falta de estoque',
    notes: 'Observacoes',
    pedido_itens: [
      {
        id: 'item-edit-1',
        product_code: 'ABC123',
        description: 'Produto 1',
        quantity: 2,
        notes: 'Obs',
      },
    ],
    purpose: 'Produto de Ciclo',
    requester_id: 'user-1',
    status: 'CHANGES_REQUESTED',
    store_id: 10,
    lojas: { nome: 'HALFELD' },
  };

  let resubmitPayload = null;
  await editSandbox.window.FormModule.afterRenderFormulario(buildDeps({
    carregarPedido() {
      return Promise.resolve(editableOrder);
    },
    carregarPedidos() {
      return Promise.resolve([]);
    },
    getCurrentUser() {
      return { id: 'user-1', papel: 'loja', role: 'USER', ativo: true };
    },
    params: { orderId: 'order-edit-1' },
    resubmitChangedOrderAPI(payload) {
      resubmitPayload = payload;
      return Promise.resolve({ protocolo: 'ORD-99', status: 'PENDING_APPROVAL' });
    },
  }));

  assert.match(editSandbox.window.document.getElementById('order-edit-banner').textContent, /Editando pedido ORD-99/);
  assert.equal(editSandbox.window.document.getElementById('btn-submit-label').textContent, 'Reenviar alterações');

  await editSandbox.window.OrdersDataModule.resubmitChangedOrderAPI({
    foto: null,
    items: editableOrder.pedido_itens.map((item) => ({
      description: item.description,
      notes: item.notes,
      productCode: item.product_code,
      quantity: item.quantity,
    })),
    justification: editableOrder.justification,
    notes: editableOrder.notes,
    order_id: 'order-edit-1',
    priority: 'NORMAL',
    purpose: editableOrder.purpose,
    store_id: '10',
  }, {
    API_OK() {
      return true;
    },
    getCurrentUser() {
      return { id: 'user-1', papel: 'loja', role: 'USER', ativo: true };
    },
    getSb() {
      return {
        rpc(name, payload) {
          if (name === 'resubmit_changed_order_multi_image') {
            resubmitPayload = payload;
          }
          return Promise.resolve({ data: { id: 'order-edit-1', internal_number: 'ORD-99', status: 'PENDING_APPROVAL' }, error: null });
        },
        storage: {
          from() {
            return {
              upload() {
                return Promise.resolve({ data: null, error: null });
              },
              remove() {
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        },
      };
    },
  });

  assert.equal(resubmitPayload.p_order_id, 'order-edit-1');
  assert.equal(resubmitPayload.p_images_metadata.length, 0);
  assert.equal(resubmitPayload.p_remove_image_ids.length, 0);
  assert.equal(editSandbox.window.document.getElementById('btn-submit-label').textContent, 'Reenviar alterações');

  fillValidForm(sandbox.window, false);
  submitCallCount = 0;
  deps.enviarPedidoAPI = function shouldNotRun() {
    submitCallCount += 1;
    return Promise.resolve();
  };

  await sandbox.window.FormModule.submitForm(deps);
  assert.equal(submitCallCount, 0);
  assert.equal(sandbox.window.document.querySelector('[data-error-for="foto"]').textContent, 'Selecione pelo menos uma foto do produto.');

  fillValidForm(sandbox.window, true);
  let lastToast = '';
  deps.showToast = function showToast(message) {
    lastToast = message;
  };
  deps.enviarPedidoAPI = function failSubmit() {
    return Promise.reject({
      code: 'ORDER_SUBMIT_FAILED',
      message: 'boom',
      stage: 'submit-order',
      orderId: 'draft-1',
    });
  };

  await sandbox.window.FormModule.submitForm(deps);
  assert.equal(submitButton.disabled, false);
  assert.equal(sandbox.window.document.getElementById('btn-submit-label').textContent, 'Tentar enviar novamente');
  assert.equal(lastToast, 'O pedido foi criado como rascunho, mas nao pode ser enviado para aprovacao.');

  let retryPayload = null;
  deps.enviarPedidoAPI = function retrySubmit(payload) {
    retryPayload = payload;
    return Promise.resolve({ protocolo: 'ORD-4', status: 'PENDING_APPROVAL' });
  };

  await sandbox.window.FormModule.submitForm(deps);
  assert.equal(retryPayload.get('draft_order_id'), 'draft-1');
  assert.equal(sandbox.window.document.getElementById('btn-submit-label').textContent, 'Enviar Pedido');

  const dataSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), dataSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), dataSandbox.window);

  const lojaSelect = dataSandbox.window.document.getElementById('f-loja');
  lojaSelect.value = '10';
  lojaSelect.selectedOptions = [
    {
      dataset: { brand: 'Marca VM', codigo: 'CC-10' },
      textContent: 'HALFELD',
    },
  ];

  const formData = new FormData();
  formData.append('loja_id', '10');
  formData.append('brand', 'Marca VM');
  formData.append('cost_center', 'CC-10');
  formData.append('purpose', 'Produto de Ciclo');
  formData.append('justification', 'Falta de estoque');
  formData.append('priority', 'NORMAL');
  formData.append('notes', 'Observacoes');
  formData.append('itens', JSON.stringify([]));

  const sb = {
    auth: {
      getUser() {
        return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null });
      },
    },
    from(table) {
      if (table === 'orders') {
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: 77, internal_number: 'ORD-77' }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      return {
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc(name) {
      if (name === 'create_order') {
        return Promise.resolve({ data: { id: 77, internal_number: 'ORD-77' }, error: null });
      }

      if (name === 'submit_order') {
        return Promise.resolve({ data: null, error: { message: 'submit failed' } });
      }

      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          upload() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };

  await assert.rejects(
    dataSandbox.window.OrdersDataModule.enviarPedidoAPI(formData, {
      API_OK() {
        return true;
      },
      getCurrentUser() {
        return { id: 'user-1', papel: 'admin' };
      },
      getSb() {
        return sb;
      },
    }),
    (error) => {
      assert.equal(error.stage, 'submit-order');
      assert.equal(error.code, 'ORDER_SUBMIT_FAILED');
      return true;
    }
  );

  const normalizeCalls = { create: 0, submit: 0 };
  const normalizeSb = {
    from(table) {
      if (table === 'orders') {
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: 77, internal_number: 'ORD-77' }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      return {
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc(name, payload) {
      if (name === 'create_order') {
        normalizeCalls.create += 1;
        return Promise.resolve({ data: [{ id: 88, internal_number: 'ORD-88' }], error: null });
      }

      if (name === 'submit_order') {
        normalizeCalls.submit += 1;
        assert.equal(payload.p_order_id, 88);
        return Promise.resolve({ data: [{ id: 88, internal_number: 'ORD-88', status: 'PENDING_APPROVAL' }], error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          upload() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };

  const normalizedFormData = new FormData();
  normalizedFormData.append('loja_id', '10');
  normalizedFormData.append('brand', 'Marca VM');
  normalizedFormData.append('cost_center', 'CC-10');
  normalizedFormData.append('purpose', 'Produto de Ciclo');
  normalizedFormData.append('justification', 'Falta de estoque');
  normalizedFormData.append('priority', 'NORMAL');
  normalizedFormData.append('notes', 'Observacoes');
  normalizedFormData.append('itens', JSON.stringify([]));

  const normalizedResult = await dataSandbox.window.OrdersDataModule.enviarPedidoAPI(normalizedFormData, {
    API_OK() {
      return true;
    },
    getCurrentUser() {
      return { id: 'user-1', papel: 'admin' };
    },
    getSb() {
      return normalizeSb;
    },
  });

  assert.equal(normalizeCalls.create, 1);
  assert.equal(normalizeCalls.submit, 1);
  assert.equal(normalizedResult.id, 88);
  assert.equal(normalizedResult.protocolo, 'ORD-88');
  assert.equal(normalizedResult.status, 'PENDING_APPROVAL');

  const retryCalls = { create: 0, submit: 0 };
  const retrySb = {
    from() {
      return {
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc(name, payload) {
      if (name === 'create_order') {
        retryCalls.create += 1;
        return Promise.resolve({ data: { id: 99, internal_number: 'ORD-99' }, error: null });
      }

      if (name === 'submit_order') {
        retryCalls.submit += 1;
        assert.equal(payload.p_order_id, 'draft-123');
        return Promise.resolve({ data: { id: 'draft-123', internal_number: 'ORD-99', status: 'PENDING_APPROVAL' }, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          upload() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };

  const retryFormData = new FormData();
  retryFormData.append('draft_order_id', 'draft-123');

  const retryResult = await dataSandbox.window.OrdersDataModule.enviarPedidoAPI(retryFormData, {
    API_OK() {
      return true;
    },
    getCurrentUser() {
      return { id: 'user-1', papel: 'admin' };
    },
    getSb() {
      return retrySb;
    },
  });

  assert.equal(retryCalls.create, 0);
  assert.equal(retryCalls.submit, 1);
  assert.equal(retryResult.id, 'draft-123');
  assert.equal(retryResult.protocolo, 'ORD-99');
  assert.equal(retryResult.status, 'PENDING_APPROVAL');

  async function renderFormStoresScenario(options) {
    const scenarioSandbox = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), scenarioSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), scenarioSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), scenarioSandbox.window);

    const depsScenario = buildDeps({
      carregarLojas() {
        return Promise.resolve(options.stores || []);
      },
      currentUser: options.currentUser || { id: 'user-1', papel: 'loja' },
      getCurrentUser() {
        return options.currentUser || { id: 'user-1', papel: 'loja' };
      },
      getSb() {
        return makeUserStoresSb(options.accessRows || [], options.accessError || null);
      },
    });

    await scenarioSandbox.window.FormModule.afterRenderFormulario(depsScenario);
    return { depsScenario, scenarioSandbox };
  }

  let scenario = await renderFormStoresScenario({
    currentUser: { id: 'admin-1', papel: 'admin' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
      { id: 11, codigo: 'CC-11', marca: 'Marca B', nome: 'Loja B', ativo: true },
      { id: 12, codigo: 'CC-12', marca: 'Marca C', nome: 'Loja C', ativo: false },
    ],
  });
  let select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  let submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  let status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, false);
  assert.equal(submit.disabled, false);
  assert.equal(countOptionTags(select), 2);
  assert.match(select.innerHTML, /Loja A/);
  assert.match(select.innerHTML, /Loja B/);
  assert.doesNotMatch(select.innerHTML, /Loja C/);
  assert.match(status.textContent, /2 loja\(s\) carregada\(s\)/);

  scenario = await renderFormStoresScenario({
    currentUser: { id: 'user-1', papel: 'loja' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
      { id: 11, codigo: 'CC-11', marca: 'Marca B', nome: 'Loja B', ativo: true },
    ],
    accessRows: [{ store_id: 10 }],
  });
  select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, false);
  assert.equal(submit.disabled, false);
  assert.equal(countOptionTags(select), 1);
  assert.match(select.innerHTML, /Loja A/);
  assert.doesNotMatch(select.innerHTML, /Loja B/);
  assert.match(status.textContent, /1 loja\(s\) carregada\(s\)/);

  scenario = await renderFormStoresScenario({
    currentUser: { id: 'user-1', papel: 'loja' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
      { id: 11, codigo: 'CC-11', marca: 'Marca B', nome: 'Loja B', ativo: true },
      { id: 12, codigo: 'CC-12', marca: 'Marca C', nome: 'Loja C', ativo: true },
    ],
    accessRows: [{ store_id: 10 }, { store_id: 12 }],
  });
  select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, false);
  assert.equal(submit.disabled, false);
  assert.equal(countOptionTags(select), 2);
  assert.match(select.innerHTML, /Loja A/);
  assert.match(select.innerHTML, /Loja C/);
  assert.doesNotMatch(select.innerHTML, /Loja B/);
  assert.match(status.textContent, /2 loja\(s\) carregada\(s\)/);

  scenario = await renderFormStoresScenario({
    currentUser: { id: 'user-1', papel: 'loja' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
    ],
    accessRows: [],
  });
  select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, true);
  assert.equal(submit.disabled, true);
  assert.equal(countOptionTags(select), 0);
  assert.match(status.textContent, /Nenhuma loja vinculada ao seu usuário/);

  scenario = await renderFormStoresScenario({
    currentUser: { id: 'user-1', papel: 'loja' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
    ],
    accessError: { message: 'boom' },
  });
  select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, true);
  assert.equal(submit.disabled, true);
  assert.equal(countOptionTags(select), 0);
  assert.match(status.textContent, /Não foi possível carregar suas lojas vinculadas/);

  scenario = await renderFormStoresScenario({
    currentUser: { id: 'user-1', papel: 'loja' },
    stores: [
      { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
      { id: 11, codigo: 'CC-11', marca: 'Marca B', nome: 'Loja B', ativo: false },
    ],
    accessRows: [{ store_id: 11 }],
  });
  select = scenario.scenarioSandbox.window.document.getElementById('f-loja');
  submit = scenario.scenarioSandbox.window.document.getElementById('btn-submit-form');
  status = scenario.scenarioSandbox.window.document.getElementById('store-status-message');
  assert.equal(select.disabled, true);
  assert.equal(submit.disabled, true);
  assert.equal(countOptionTags(select), 0);
  assert.match(status.textContent, /Nenhuma loja vinculada ao seu usuário/);

  const tamperSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), tamperSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), tamperSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), tamperSandbox.window);
  const tamperDeps = buildDeps({
    carregarLojas() {
      return Promise.resolve([
        { id: 10, codigo: 'CC-10', marca: 'Marca A', nome: 'Loja A', ativo: true },
      ]);
    },
    getCurrentUser() {
      return { id: 'user-1', papel: 'loja' };
    },
    getSb() {
      return makeUserStoresSb([{ store_id: 10 }], null);
    },
  });
  await tamperSandbox.window.FormModule.afterRenderFormulario(tamperDeps);
  fillValidForm(tamperSandbox.window, true);
  const tamperSelect = tamperSandbox.window.document.getElementById('f-loja');
  tamperSelect.value = '999';
  tamperSelect.selectedOptions = [
    {
      dataset: { brand: 'Ghost', codigo: 'BAD' },
      textContent: 'Ghost store',
      value: '999',
    },
  ];
  let tamperSubmitCalls = 0;
  tamperDeps.enviarPedidoAPI = function tamperedSubmit() {
    tamperSubmitCalls += 1;
    return Promise.resolve({ protocolo: 'ORD-X', status: 'DRAFT' });
  };
  await tamperSandbox.window.FormModule.submitForm(tamperDeps);
  assert.equal(tamperSubmitCalls, 0);
  assert.match(tamperSandbox.window.document.querySelector('[data-error-for="f-loja"]').textContent, /Selecione a loja\./);

  const createOrderFailureCalls = { ordersInsert: 0, itemsInsert: 0, upload: 0, submit: 0 };
  const createOrderFailureSb = {
    from(table) {
      if (table === 'orders') {
        return {
          insert() {
            createOrderFailureCalls.ordersInsert += 1;
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: 77, internal_number: 'ORD-77' }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'order_items') {
        return {
          insert() {
            createOrderFailureCalls.itemsInsert += 1;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      if (table === 'order_images') {
        return {
          insert() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      return {
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc(name) {
      if (name === 'create_order') {
        return Promise.resolve({ data: null, error: { message: 'permission denied' } });
      }

      if (name === 'submit_order') {
        createOrderFailureCalls.submit += 1;
        return Promise.resolve({ data: null, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          upload() {
            createOrderFailureCalls.upload += 1;
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };
  const createOrderFailureFormData = new FormData();
  createOrderFailureFormData.append('loja_id', '10');
  createOrderFailureFormData.append('brand', 'Marca VM');
  createOrderFailureFormData.append('cost_center', 'CC-10');
  createOrderFailureFormData.append('purpose', 'Produto de Ciclo');
  createOrderFailureFormData.append('justification', 'Falta de estoque');
  createOrderFailureFormData.append('priority', 'NORMAL');
  createOrderFailureFormData.append('notes', 'Observacoes');
  createOrderFailureFormData.append('itens', JSON.stringify([]));
  await assert.rejects(
    dataSandbox.window.OrdersDataModule.enviarPedidoAPI(createOrderFailureFormData, {
      API_OK() { return true; },
      getCurrentUser() { return { id: 'user-1', papel: 'loja' }; },
      getSb() { return createOrderFailureSb; },
    }),
    (error) => {
      assert.equal(createOrderFailureCalls.ordersInsert, 0);
      assert.equal(createOrderFailureCalls.itemsInsert, 0);
      assert.equal(createOrderFailureCalls.upload, 0);
      assert.equal(createOrderFailureCalls.submit, 0);
      assert.equal(error.stage, 'create-order');
      assert.equal(error.code, 'ORDER_CREATE_FAILED');
      return true;
    }
  );

  // URL cleanup after successful resubmit
  {
    var urlSandbox = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), urlSandbox.window);
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), urlSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), urlSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), urlSandbox.window);

    var urlLastToast = '';
    var urlEditBanner = urlSandbox.window.document.getElementById('order-edit-banner');

    // Use admin user so loadStoresIntoSelect doesn't need getSb
    var urlDeps = buildDeps({
      carregarPedido() {
        return Promise.resolve({
          id: 'resubmit-url-test-1',
          internal_number: 'ORD-URL',
          brand: 'Marca VM',
          cost_center: 'CC-99',
          justification: 'Teste',
          notes: 'Obs',
          pedido_itens: [
            { id: 'item-u1', product_code: 'SKU1', description: 'Item 1', quantity: 2, notes: '' },
          ],
          purpose: 'Produto de Ciclo',
          requester_id: 'user-1',
          status: 'CHANGES_REQUESTED',
          store_id: 10,
          lojas: { nome: 'HALFELD' },
        });
      },
      carregarPedidos() { return Promise.resolve([]); },
      getCurrentUser() { return { id: 'user-1', papel: 'admin', role: 'ADMIN', ativo: true }; },
      params: { orderId: 'resubmit-url-test-1' },
      resubmitChangedOrderAPI() { return Promise.resolve({ protocolo: 'ORD-URL', status: 'PENDING_APPROVAL' }); },
      showToast: function showToast(msg) { urlLastToast = msg; },
      afterRenderForm: function afterRenderForm() { return Promise.resolve(); },
    });

    urlSandbox.window.location.href = '/novo-pedido?orderId=resubmit-url-test-1&keep=yes#section';
    var initialHistoryState = {};
    urlSandbox.window.history.state = initialHistoryState;
    var replaceCountBefore = urlSandbox.window.history.replaceStateCount || 0;

    await urlSandbox.window.FormModule.afterRenderFormulario(urlDeps);

    // Verify edit mode was entered
    assert.ok(urlEditBanner && urlEditBanner.textContent.includes('Editando pedido'), 'edit banner should show');
    assert.equal(urlSandbox.window.document.getElementById('btn-submit-label').textContent, 'Reenviar alterações');

    // Set f-loja value to match store in cachedStores
    urlSandbox.window.document.getElementById('f-loja').value = '10';

    await urlSandbox.window.FormModule.submitForm(urlDeps);

    assert.equal(urlLastToast, 'Pedido enviado! Protocolo ORD-URL');

    var finalUrl = urlSandbox.window.history._url;

    // orderId removed
    assert.ok(!finalUrl.includes('orderId'), 'orderId should be removed from URL: ' + finalUrl);

    // Unrelated params preserved
    assert.ok(finalUrl.includes('keep=yes'), 'unrelated query params should remain: ' + finalUrl);

    // Hash preserved
    assert.ok(finalUrl.includes('#section'), 'hash should be preserved: ' + finalUrl);

    // replaceState was called
    assert.ok(urlSandbox.window.history.replaceStateCount > replaceCountBefore, 'replaceState should have been called');

    // History state preserved
    assert.equal(urlSandbox.window.history.state, initialHistoryState, 'history state should be preserved');

    // Edit banner hidden after re-init
    assert.ok(urlEditBanner.classList.contains('hidden'), 'edit banner should be hidden after reset');

    // Form in clean CREATE mode
    assert.equal(urlSandbox.window.document.getElementById('btn-submit-label').textContent, 'Enviar Pedido');
  }

  // No URL replacement when orderId absent
  {
    var noOrderIdSandbox = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), noOrderIdSandbox.window);
    loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), noOrderIdSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), noOrderIdSandbox.window);

    var noIdDeps = buildDeps({
      afterRenderForm: function afterRenderForm() { return Promise.resolve(); },
    });

    fillValidForm(noOrderIdSandbox.window, true);
    var repCountBefore = noOrderIdSandbox.window.history.replaceStateCount || 0;

    noIdDeps.enviarPedidoAPI = function noIdEnviar() {
      return Promise.resolve({ protocolo: 'ORD-NOID', status: 'PENDING_APPROVAL' });
    };

    await noOrderIdSandbox.window.FormModule.submitForm(noIdDeps);

    // replaceState should NOT have been called (no orderId in URL)
    assert.equal(noOrderIdSandbox.window.history.replaceStateCount, repCountBefore, 'replaceState should not be called when orderId absent');
  }

  // Legitimate edit-load errors still produce error notification
  {
    var errorSandbox = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), errorSandbox.window);
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), errorSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), errorSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), errorSandbox.window);

    var errorToastMsg = '';
    var errorDeps = buildDeps({
      carregarPedido() { return Promise.resolve(null); },
      carregarPedidos() { return Promise.resolve([]); },
      getCurrentUser() { return { id: 'user-2', papel: 'loja', role: 'USER', ativo: true }; },
      params: { orderId: 'nonexistent-order' },
      showToast: function showToast(msg) { errorToastMsg = msg; },
      resubmitChangedOrderAPI() { return Promise.resolve({}); },
    });

    await errorSandbox.window.FormModule.afterRenderFormulario(errorDeps);

    assert.equal(errorToastMsg, 'Nao foi possivel abrir pedido para edicao.');
  }

  // Multi-image upload control: persistent trigger and append behavior
  {
    var miSandbox = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), miSandbox.window);
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), miSandbox.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), miSandbox.window);

    var miForm = miSandbox.window.FormModule;
    var miDoc = miSandbox.window.document;

    // Initial state: upload area visible, label set by code
    var uploadAreaBefore = miDoc.getElementById('upload-area');
    assert.equal(uploadAreaBefore.classList.contains('hidden'), false, 'upload area should be visible initially');
    // Call resetForm to trigger updateUploadLabel (HTML partial not loaded in sandbox)
    miForm.resetForm();
    var labelBefore = miDoc.getElementById('image-upload-label');
    // updateUploadLabel uses placeholder text when no new images
    assert.equal(labelBefore.textContent, 'Arraste as fotos ou clique para selecionar', 'label should be placeholder text after resetForm');

    // 2. Select one image
    var img1 = { name: 'photo1.jpg', size: 1024, type: 'image/jpeg', lastModified: 100 };
    var added1 = miForm.addNewImages([img1]);
    assert.equal(added1, 1, 'first image should be added');
    assert.equal(miForm._getState ? miForm._getState().newImages.length : miSandbox.window.document.getElementById('image-gallery').classList.contains('hidden') === false, true, 'preview should appear');
    // Check gallery is visible
    var galleryEl = miDoc.getElementById('image-gallery');
    assert.equal(galleryEl.classList.contains('hidden'), false, 'gallery should be visible after add');

    // 4. Upload control remains visible after first image
    assert.equal(uploadAreaBefore.classList.contains('hidden'), false, 'upload area should still be visible after first image');

    // 5. Label changes
    assert.equal(labelBefore.textContent, 'Adicionar mais imagens', 'label should change to Adicionar mais imagens after first image');

    // 6. Select two more images later
    var img2 = { name: 'photo2.jpg', size: 2048, type: 'image/png', lastModified: 200 };
    var img3 = { name: 'photo3.jpg', size: 3072, type: 'image/webp', lastModified: 300 };
    var added2 = miForm.addNewImages([img2, img3]);
    assert.equal(added2, 2, 'two more images should be appended');
    assert.equal(uploadAreaBefore.classList.contains('hidden'), false, 'upload area still visible after more images');

    // 7. Verify state has 3 images
    var galleryContainer = miDoc.getElementById('image-gallery-container');
    var imgCount = (galleryContainer.innerHTML.match(/data-image-id/g) || []).length;
    assert.equal(imgCount, 3, 'gallery should contain 3 image cards');

    // 8. Remove one image and verify control remains
    var firstImgId = miForm._getState ? miForm._getState().newImages[0].id : null;
    // Find first image ID from the rendered data attributes
    var imgMatch = galleryContainer.innerHTML.match(/data-image-id="([^"]+)"/);
    var removeId = imgMatch ? imgMatch[1] : null;
    if (removeId) {
      miForm.removeNewImage(removeId);
      assert.equal(uploadAreaBefore.classList.contains('hidden'), false, 'upload area visible after removal');
      // Label back to initial after all removed, or still "Adicionar mais" if remaining
    }

    // 9. Input value cleared after processing
    var mockInput = { files: [img1], value: 'C:\\fakepath\\photo1.jpg' };
    miForm.handleImagesUpload(mockInput);
    assert.equal(mockInput.value, '', 'input value should be cleared after processing');

    // 10. Edit mode: upload control visible — same code path as create mode
    var editSb = createSandbox();
    loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), editSb.window);
    loadModule(path.join('public', 'js', 'shared', 'order-rules.js'), editSb.window);
    loadModule(path.join('public', 'js', 'pages', 'order-form', 'order-form-module.js'), editSb.window);
    var editForm = editSb.window.FormModule;
    var editDoc = editSb.window.document;

    editForm.resetForm();
    var editUploadArea = editDoc.getElementById('upload-area');
    assert.equal(editUploadArea.classList.contains('hidden'), false, 'upload area should be visible in edit mode');
    var editLabel = editDoc.getElementById('image-upload-label');
    assert.equal(editLabel.textContent, 'Arraste as fotos ou clique para selecionar', 'label should be placeholder after resetForm in edit mode');

    editForm.addNewImages([{ name: 'local.jpg', size: 512, type: 'image/jpeg', lastModified: 400 }]);
    assert.equal(editUploadArea.classList.contains('hidden'), false, 'upload area visible after adding local image');
    assert.equal(editLabel.textContent, 'Adicionar mais imagens', 'label updated after adding local image');
    assert.equal((editDoc.getElementById('image-gallery-container').innerHTML.match(/data-image-id/g) || []).length, 1, 'one local image shown in gallery');
  }

  console.log('Order form checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
