const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createElement(id) {
  const listeners = {};
  const el = {
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    dataset: {},
    id,
    innerHTML: '',
    listeners,
    style: {},
    textContent: '',
    addEventListener(type, handler) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
  };
  el.appendChild = function appendChild(child) {
    if (child && typeof child === 'object') {
      this.innerHTML += child.innerHTML || '';
    }
    return child;
  };
  el.className = '';
  return el;
}

function createSandbox() {
  const elements = new Map();

  const document = {
    createElement(tag) {
      const el = createElement(tag);
      el.className = '';
      el.innerHTML = '';
      el.appendChild = function appendChild(child) {
        if (child && typeof child === 'object') {
          this.innerHTML += child.innerHTML || '';
        }
        return child;
      };
      return el;
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement(id));
      }
      return elements.get(id);
    },
    querySelectorAll(sel) {
      if (sel === '.receipt-item-value') return [];
      return [];
    },
    querySelector(sel) {
      if (sel && sel.includes && sel.includes('.receipt-item-value')) return null;
      return null;
    },
  };

  const window = {
    console,
    crypto: {
      randomUUID() {
        return 'uuid-test';
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
    lucide: {
      createIcons() {},
    },
  };

  window.window = window;
  window.globalThis = window;

  return { elements, window };
}

function loadModule(file, window) {
  vm.runInNewContext(read(file), window, { filename: file });
  return window;
}

function createOrderResponse() {
  return {
    approved_at: null,
    brand: 'Marca VM',
    created_at: '2026-06-19T12:00:00.000Z',
    delivery_date: null,
    delivery_protocol: null,
    id: 'order-1',
    internal_number: 'ORD-1',
    order_images: [
      {
        bucket_name: 'order-images',
        created_at: '2026-06-19T12:01:00.000Z',
        file_hash: 'hash-1',
        file_size: 1234,
        id: 'img-1',
        mime_type: 'image/webp',
        order_id: 'order-1',
        order_item_id: null,
        original_filename: 'produto.webp',
        storage_path: 'orders/user-1/order-1/img.webp',
        uploaded_by_id: 'user-1',
      },
    ],
    order_items: [
      {
        id: 'item-1',
        product_code: 'ABC123',
        description: 'Produto 1',
        quantity: 2,
        unit: 'un',
        notes: 'Obs',
      },
    ],
    pending: false,
    priority: 'NORMAL',
    placed_at: null,
    placed_by_id: null,
    requester_id: 'user-1',
    rejected_at: null,
    rejection_reason: null,
    received_at: null,
    received_by_id: null,
    status: 'PENDING_APPROVAL',
    store_id: 10,
    store: 'Loja Centro',
    submitted_at: '2026-06-19T12:05:00.000Z',
    status_history: [
      {
        comment: 'Order created',
        created_at: '2026-06-19T12:00:00.000Z',
        new_status: 'DRAFT',
        previous_status: null,
      },
    ],
    updated_at: '2026-06-19T12:05:00.000Z',
  };
}

async function run() {
  const sandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), sandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), sandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), sandbox.window);

  const orderResponse = createOrderResponse();
  const sb = {
    from(table) {
      if (table !== 'orders') {
        return {
          insert() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      return {
        select() {
          return {
            eq() {
              return {
                single() {
                  return Promise.resolve({ data: orderResponse, error: null });
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from(bucketName) {
        return {
          createSignedUrl(storagePath) {
            assert.equal(bucketName, 'order-images');
            assert.equal(storagePath, 'orders/user-1/order-1/img.webp');
            return Promise.resolve({
              data: { signedUrl: 'https://signed.example/image.webp' },
              error: null,
            });
          },
        };
      },
    },
  };

  const loadedOrder = await sandbox.window.OrdersDataModule.carregarPedido('order-1', {
    API_OK() {
      return true;
    },
    getSb() {
      return sb;
    },
    mapOrderRecord: sandbox.window.AppUtils.mapOrderRecord,
  });

  assert.equal(loadedOrder.images.length, 1);
  assert.equal(loadedOrder.images[0].signedUrl, 'https://signed.example/image.webp');
  assert.equal(loadedOrder.foto_url, 'https://signed.example/image.webp');

  const currentUser = { id: 'user-1', papel: 'loja', role: 'USER', ativo: true };
  await sandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() {
      return true;
    },
    canApproveOrder(user, order) {
      return sandbox.window.AppUtils.canApproveOrder(user, order);
    },
    canRejectOrder(user, order) {
      return sandbox.window.AppUtils.canRejectOrder(user, order);
    },
    canRequestChangesOrder(user, order) {
      return sandbox.window.AppUtils.canRequestChangesOrder(user, order);
    },
    carregarPedido() {
      return Promise.resolve(loadedOrder);
    },
    getCurrentUser() {
      return currentUser;
    },
    navigateTo() {},
    renderDrawerHistory: sandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: sandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: sandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.ok(sandbox.window.document.getElementById('drawer-loja').textContent);
  assert.ok(sandbox.window.document.getElementById('drawer-data').textContent);
  assert.match(sandbox.window.document.getElementById('drawer-imagem').innerHTML, /clique para ampliar|Clique para ampliar/);
  assert.doesNotMatch(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Aprovar/);
  assert.doesNotMatch(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Rejeitar/);

  await sandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() {
      return true;
    },
    canApproveOrder(user, order) {
      return sandbox.window.AppUtils.canApproveOrder(user, order);
    },
    canRejectOrder(user, order) {
      return sandbox.window.AppUtils.canRejectOrder(user, order);
    },
    canRequestChangesOrder(user, order) {
      return sandbox.window.AppUtils.canRequestChangesOrder(user, order);
    },
    carregarPedido() {
      return Promise.resolve(loadedOrder);
    },
    getCurrentUser() {
      return { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: true };
    },
    navigateTo() {},
    renderDrawerHistory: sandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: sandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: sandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Aprovar/);
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Rejeitar/);
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Solicitar Edição/);
  assert.ok(sandbox.window.document.getElementById('drawer-justificativa-bloco'));
  assert.ok(sandbox.window.document.getElementById('drawer-justificativa'));

  const placedOrder = createOrderResponse();
  placedOrder.status = 'APPROVED';
  placedOrder.internal_number = 'ORD-PLACED';
  placedOrder.pedido_itens = placedOrder.order_items;

  var valueInput = {
    value: '10',
    addEventListener() {},
    getAttribute(name) {
      if (name === 'data-item-id') return 'item-1';
      return null;
    },
  };
  sandbox.window.document.querySelectorAll = function(sel) {
    if (sel === '.receipt-item-value') return [valueInput];
    return [];
  };
  sandbox.window.document.querySelector = function(sel) {
    if (sel === '[data-item-id="item-1"].receipt-item-value') return valueInput;
    return null;
  };

  let markCall = null;
  await sandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() {
      return true;
    },
    canApproveOrder() { return false; },
    canConfirmReceipt() { return false; },
    canDeleteOrder(user, order) { return sandbox.window.AppUtils.canDeleteOrder(user, order); },
    canEditOrder() { return false; },
    canMarkOrderPlaced(user, order) { return sandbox.window.AppUtils.canMarkOrderPlaced(user, order); },
    carregarPedido() { return Promise.resolve(placedOrder); },
    confirmReceiptAPI() { return Promise.resolve({ id: 'order-1', status: 'RECEIVED' }); },
    getCurrentUser() { return { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: true }; },
    listOrdersForCurrentProfile() { return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }); },
    markOrderPlacedAPI(payload) {
      markCall = payload;
      placedOrder.status = 'ORDER_PLACED';
      placedOrder.delivery_protocol = String(payload.delivery_protocol || '').trim();
      placedOrder.delivery_date = String(payload.delivery_date || '').trim();
      return Promise.resolve({ id: 'order-1', status: 'ORDER_PLACED', delivery_protocol: payload.delivery_protocol, delivery_date: payload.delivery_date });
    },
    navigateTo() {},
    renderDrawerHistory: sandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: sandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: sandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Pedido realizado/);
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /drawer-order-protocol/);
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /drawer-order-delivery-date/);
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Valor unitario/);
  assert.doesNotMatch(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Entrega confirmada - nenhuma ação necessária/);

  const protocolInput = sandbox.window.document.getElementById('drawer-order-protocol');
  const dateInput = sandbox.window.document.getElementById('drawer-order-delivery-date');
  const submitButton = sandbox.window.document.getElementById('drawer-order-placed-submit');
  assert.equal(submitButton.disabled, true);

  protocolInput.value = '  PR-100  ';
  protocolInput.listeners.input[0]();
  assert.equal(submitButton.disabled, true);

  dateInput.value = '2026-06-26';
  dateInput.listeners.input[0]();
  assert.equal(submitButton.disabled, false);

  const form = sandbox.window.document.getElementById('drawer-order-placed-form');
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.ok(markCall);
  assert.equal(markCall.delivery_date, '2026-06-26');
  assert.equal(markCall.delivery_protocol, '  PR-100  ');
  assert.equal(markCall.id, 'order-1');
  assert.equal(markCall.order_id, 'order-1');
  assert.match(sandbox.window.document.getElementById('drawer-footer').innerHTML, /Aguardando confirmação do recebimento/);

  const justif = sandbox.window.document.getElementById('drawer-justificativa');
  justif.value = 'Ajustar descricao';

  let requested = null;
  await sandbox.window.OrdersModule.decidirPedido('order-1', 'solicitar', {
    API_OK() {
      return true;
    },
    decidirPedidoAPI(id, status, justification) {
      requested = { id, status, justification };
      return Promise.resolve();
    },
    showToast() {},
  });

  assert.deepEqual(requested, {
    id: 'order-1',
    status: 'CHANGES_REQUESTED',
    justification: 'Ajustar descricao',
  });

  const changeRequestCalls = [];
  await sandbox.window.OrdersDataModule.decidirPedidoAPI('order-1', 'CHANGES_REQUESTED', 'Precisa ajustar', {
    getSb() {
      return {
        rpc(name, payload) {
          changeRequestCalls.push({ name, payload });
          return Promise.resolve({ data: { id: 'order-1' }, error: null });
        },
      };
    },
  });

  assert.equal(changeRequestCalls.length, 1);
  assert.equal(changeRequestCalls[0].name, 'request_order_changes');
  assert.equal(changeRequestCalls[0].payload.p_order_id, 'order-1');
  assert.equal(changeRequestCalls[0].payload.p_comment, 'Precisa ajustar');

  const placedCalls = [];
  const placedResult = await sandbox.window.OrdersDataModule.markOrderPlacedAPI({
    delivery_date: '2026-06-26',
    delivery_protocol: 'PR-123',
    id: 'order-1',
    order_id: 'order-1',
    itemValues: [{ order_item_id: 'item-1', unit_value: 10 }],
  }, {
    getSb() {
      return {
        rpc(name, payload) {
          placedCalls.push({ name, payload });
          return Promise.resolve({ data: { id: 'order-1', internal_number: 'ORD-9', delivery_date: '2026-06-26', delivery_protocol: 'PR-123', status: 'ORDER_PLACED' }, error: null });
        },
      };
    },
  });

  assert.equal(placedCalls.length, 1);
  assert.equal(placedCalls[0].name, 'mark_order_placed');
  assert.equal(placedCalls[0].payload.p_order_id, 'order-1');
  assert.equal(placedCalls[0].payload.p_delivery_protocol, 'PR-123');
  assert.equal(placedCalls[0].payload.p_delivery_date, '2026-06-26');
  assert.equal(placedCalls[0].payload.p_item_values.length, 1);
  assert.equal(placedCalls[0].payload.p_item_values[0].order_item_id, 'item-1');
  assert.equal(placedCalls[0].payload.p_item_values[0].unit_value, 10);
  assert.equal(placedResult.status, 'ORDER_PLACED');

  const receiptCalls = [];
  const receiptResult = await sandbox.window.OrdersDataModule.confirmReceiptAPI('order-1', {
    getSb() {
      return {
        rpc(name, payload) {
          receiptCalls.push({ name, payload });
          return Promise.resolve({ data: { id: 'order-1', internal_number: 'ORD-9', delivery_date: '2026-06-26', delivery_protocol: 'PR-123', status: 'RECEIVED' }, error: null });
        },
      };
    },
  }, { invoiceNumber: 'NF-001' });

  assert.equal(receiptCalls.length, 1);
  assert.equal(receiptCalls[0].name, 'confirm_order_received');
  assert.equal(receiptCalls[0].payload.p_order_id, 'order-1');
  assert.equal(receiptCalls[0].payload.p_invoice_number, 'NF-001');
  assert.equal(receiptCalls[0].payload.p_item_values, null);
  assert.equal(receiptResult.status, 'RECEIVED');

  const changesOrder = createOrderResponse();
  changesOrder.status = 'CHANGES_REQUESTED';
  const loadedChangesOrder = {
    ...loadedOrder,
    status: 'CHANGES_REQUESTED',
  };

  const changesSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), changesSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), changesSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), changesSandbox.window);

  const changesSb = {
    from: function from(table) {
      return {
        select: function select() {
          return {
            eq: function eq() {
              return {
                single: function single() {
                  return Promise.resolve({ data: changesOrder, error: null });
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from: function from(name) {
        return {
          createSignedUrl: function createSignedUrl(path) {
            return Promise.resolve({ data: { signedUrl: 'https://signed.example/img.webp' }, error: null });
          },
        };
      },
    },
  };

  const mappedChangesOrder = await changesSandbox.window.OrdersDataModule.carregarPedido('order-1', {
    API_OK() { return true; },
    getSb() { return changesSb; },
    mapOrderRecord: changesSandbox.window.AppUtils.mapOrderRecord,
  });

  await changesSandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() { return true; },
    canApproveOrder() { return false; },
    canRejectOrder() { return false; },
    canRequestChangesOrder() { return false; },
    canEditOrder(user, order) { return changesSandbox.window.AppUtils.canEditOrder(user, order); },
    isAdminUser(user) { return changesSandbox.window.AppUtils.isAdminUser(user); },
    carregarPedido() { return Promise.resolve(mappedChangesOrder); },
    getCurrentUser() { return { id: 'user-1', papel: 'loja', role: 'USER', ativo: true }; },
    renderDrawerHistory: changesSandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: changesSandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: changesSandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(changesSandbox.window.document.getElementById('drawer-footer').innerHTML, /Editar e reenviar/);
  assert.doesNotMatch(changesSandbox.window.document.getElementById('drawer-footer').innerHTML, /Aprovar/);
  assert.doesNotMatch(changesSandbox.window.document.getElementById('drawer-footer').innerHTML, /Alterar status/);

  const adminOverrideSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), adminOverrideSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), adminOverrideSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), adminOverrideSandbox.window);

  const draftOrder = createOrderResponse();
  draftOrder.status = 'DRAFT';
  const mappedDraftOrder = {
    ...loadedOrder,
    status: 'DRAFT',
  };

  await adminOverrideSandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() { return true; },
    canApproveOrder() { return false; },
    canRejectOrder() { return false; },
    canRequestChangesOrder() { return false; },
    canEditOrder(user, order) { return adminOverrideSandbox.window.AppUtils.canEditOrder(user, order); },
    isAdminUser(user) { return adminOverrideSandbox.window.AppUtils.isAdminUser(user); },
    carregarPedido() { return Promise.resolve(mappedDraftOrder); },
    getCurrentUser() { return { id: 'user-1', papel: 'admin', role: 'ADMIN', ativo: true }; },
    navigateTo() {},
    renderDrawerHistory: adminOverrideSandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: adminOverrideSandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: adminOverrideSandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(adminOverrideSandbox.window.document.getElementById('drawer-footer').innerHTML, /Editar e reenviar/);
  assert.doesNotMatch(adminOverrideSandbox.window.document.getElementById('drawer-footer').innerHTML, /Alterar status/);
  assert.doesNotMatch(adminOverrideSandbox.window.document.getElementById('drawer-footer').innerHTML, /drawer-status-override/);

  const orderPlacedOrder = createOrderResponse();
  orderPlacedOrder.status = 'ORDER_PLACED';
  orderPlacedOrder.delivery_protocol = 'PR-200';
  orderPlacedOrder.delivery_date = '2026-06-27';
  orderPlacedOrder.placed_at = '2026-06-26T12:00:00.000Z';
  orderPlacedOrder.placed_by_id = 'admin-1';

  const placedSandbox = createSandbox();
  loadModule(path.join('public', 'js', 'shared', 'app-utils.js'), placedSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-data.js'), placedSandbox.window);
  loadModule(path.join('public', 'js', 'pages', 'orders', 'orders-module.js'), placedSandbox.window);

  await placedSandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() { return true; },
    canApproveOrder() { return false; },
    canConfirmReceipt(user, order) { return placedSandbox.window.AppUtils.canConfirmReceipt(user, order); },
    canDeleteOrder(user, order) { return placedSandbox.window.AppUtils.canDeleteOrder(user, order); },
    canEditOrder() { return false; },
    canMarkOrderPlaced() { return false; },
    carregarPedido() { return Promise.resolve(orderPlacedOrder); },
    confirmReceiptAPI() { return Promise.resolve({ id: 'order-1', status: 'RECEIVED' }); },
    getCurrentUser() { return { id: 'user-1', papel: 'loja', role: 'USER', ativo: true }; },
    listOrdersForCurrentProfile() { return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }); },
    markOrderPlacedAPI() { return Promise.resolve(); },
    navigateTo() {},
    renderDrawerHistory: placedSandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: placedSandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: placedSandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(placedSandbox.window.document.getElementById('drawer-delivery-info').innerHTML, /PR-200/);
  assert.match(placedSandbox.window.document.getElementById('drawer-delivery-info').innerHTML, /27\/06\/2026/);
  assert.ok(placedSandbox.window.document.getElementById('drawer-receipt-invoice'), 'drawer must have invoice input');
  assert.match(placedSandbox.window.document.getElementById('drawer-footer').innerHTML, /Confirmar recebimento/);
  assert.doesNotMatch(placedSandbox.window.document.getElementById('drawer-footer').innerHTML, /Entrega confirmada - nenhuma ação necessária/);

  await placedSandbox.window.OrdersModule.openPedido('order-1', {
    API_OK() { return true; },
    canApproveOrder() { return false; },
    canConfirmReceipt() { return false; },
    canDeleteOrder(user, order) { return placedSandbox.window.AppUtils.canDeleteOrder(user, order); },
    canEditOrder() { return false; },
    canMarkOrderPlaced() { return false; },
    carregarPedido() { return Promise.resolve({ ...orderPlacedOrder, status: 'RECEIVED' }); },
    confirmReceiptAPI() { return Promise.resolve({ id: 'order-1', status: 'RECEIVED' }); },
    getCurrentUser() { return { id: 'user-1', papel: 'loja', role: 'USER', ativo: true }; },
    listOrdersForCurrentProfile() { return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }); },
    markOrderPlacedAPI() { return Promise.resolve(); },
    navigateTo() {},
    renderDrawerHistory: placedSandbox.window.AppUtils.renderDrawerHistory,
    renderDrawerItems: placedSandbox.window.AppUtils.renderDrawerItems,
    renderDrawerStatusBar: placedSandbox.window.AppUtils.renderDrawerStatusBar,
    showToast() {},
  });

  assert.match(placedSandbox.window.document.getElementById('drawer-footer').innerHTML, /Entrega confirmada - nenhuma ação necessária/);

  console.log('Orders module checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
