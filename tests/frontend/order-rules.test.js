const assert = require('node:assert/strict');
const test = (name, fn) => {
  fn();
  console.log(`✔ ${name}`);
};

const {
  buildOrderInput,
  canReviewOrder,
  isAllowedImageMimeType,
  isFinalStatus,
  mapRole,
  validateGeneralData,
  validateOrderForm,
  validateOrderItem,
  validateOrderItems,
} = require('../../public/js/shared/order-rules');

const {
  canApproveOrder,
  canDeleteOrder,
  canConfirmReceipt,
  canEditOrder,
  canMarkOrderPlaced,
  canRejectOrder,
  canRequestChangesOrder,
  canViewOrderImage,
  filterOrdersList,
  getPaginationMeta,
  isActiveUser,
  isAdminUser,
  isEditableOrderStatus,
  isOrderOwner,
  getStatusMeta,
  statusBadge,
} = require('../../public/js/shared/app-utils');

test('mapRole converte ADMIN para admin', () => {
  assert.equal(mapRole('ADMIN'), 'admin');
  assert.equal(mapRole('user'), 'loja');
});

test('canReviewOrder aceita somente PENDING_APPROVAL', () => {
  assert.equal(canReviewOrder('PENDING_APPROVAL'), true);
  assert.equal(canReviewOrder('DRAFT'), false);
});

test('isFinalStatus reconhece estados finais', () => {
  assert.equal(isFinalStatus('APPROVED'), false);
  assert.equal(isFinalStatus('REJECTED'), true);
  assert.equal(isFinalStatus('RECEIVED'), true);
  assert.equal(isFinalStatus('PENDING_APPROVAL'), false);
});

test('status mapping cobre novos estados e desconhecidos', () => {
  assert.equal(getStatusMeta('PENDING_APPROVAL').label, 'Aguardando aprovação');
  assert.equal(getStatusMeta('ORDER_PLACED').label, 'Pedido realizado');
  assert.equal(getStatusMeta('RECEIVED').label, 'Recebido');
  assert.equal(getStatusMeta('CHANGES_REQUESTED').label, 'Alterações solicitadas');
  assert.equal(getStatusMeta('qualquer-coisa').label, 'Status desconhecido');
});

test('statusBadge renderiza label e classe', () => {
  const badge = statusBadge('CHANGES_REQUESTED');
  assert.match(badge, /Alterações solicitadas/);
  assert.match(badge, /bg-violet-100/);
});

test('helpers de permissao cobrem ADMIN, dono e status editavel', () => {
  const admin = { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: true };
  const inactiveAdmin = { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: false };
  const owner = { id: 'user-1', papel: 'loja', role: 'USER', ativo: true };
  const otherUser = { id: 'user-2', papel: 'loja', role: 'USER', ativo: true };
  const draftOrder = { id: 'order-1', requester_id: 'user-1', status: 'DRAFT' };
  const pendingOrder = { id: 'order-1', requester_id: 'user-1', status: 'PENDING_APPROVAL' };
  const changesRequestedOrder = { id: 'order-1', requester_id: 'user-1', status: 'CHANGES_REQUESTED' };
  const approvedOrder = { id: 'order-1', requester_id: 'user-1', status: 'APPROVED' };
  const placedOrder = { id: 'order-1', requester_id: 'user-1', status: 'ORDER_PLACED', delivery_protocol: 'PR-123', delivery_date: '2026-06-26' };
  const receivedOrder = { id: 'order-1', requester_id: 'user-1', status: 'RECEIVED', delivery_protocol: 'PR-123', delivery_date: '2026-06-26' };

  assert.equal(isActiveUser(admin), true);
  assert.equal(isActiveUser(inactiveAdmin), false);
  assert.equal(isAdminUser(admin), true);
  assert.equal(isAdminUser(owner), false);
  assert.equal(isOrderOwner(owner, draftOrder), true);
  assert.equal(isOrderOwner(otherUser, draftOrder), false);
  assert.equal(isEditableOrderStatus('DRAFT'), true);
  assert.equal(isEditableOrderStatus('CHANGES_REQUESTED'), true);
  assert.equal(isEditableOrderStatus('APPROVED'), false);
  assert.equal(canEditOrder(owner, draftOrder), true);
  assert.equal(canEditOrder(owner, changesRequestedOrder), true);
  assert.equal(canEditOrder(owner, pendingOrder), false);
  assert.equal(canEditOrder(otherUser, draftOrder), false);
  assert.equal(canApproveOrder(admin, pendingOrder), true);
  assert.equal(canRejectOrder(admin, pendingOrder), true);
  assert.equal(canRequestChangesOrder(admin, pendingOrder), true);
  assert.equal(canMarkOrderPlaced(admin, approvedOrder), true);
  assert.equal(canMarkOrderPlaced(owner, approvedOrder), false);
  assert.equal(canConfirmReceipt(owner, placedOrder), true);
  assert.equal(canConfirmReceipt(otherUser, placedOrder), false);
  assert.equal(canConfirmReceipt(owner, receivedOrder), false);
  assert.equal(canApproveOrder(inactiveAdmin, pendingOrder), false);
  assert.equal(canRejectOrder(otherUser, pendingOrder), false);
  assert.equal(canViewOrderImage(owner, draftOrder), true);
});

test('canDeleteOrder mostra botao ADMIN para qualquer status', () => {
  const admin = { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: true };
  const inactiveAdmin = { id: 'admin-1', papel: 'admin', role: 'ADMIN', ativo: false };
  const user = { id: 'user-1', papel: 'loja', role: 'USER', ativo: true };

  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'DRAFT' }), true);
  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'PENDING_APPROVAL' }), true);
  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'APPROVED' }), true);
  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'REJECTED' }), true);
  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'CHANGES_REQUESTED' }), true);
  assert.equal(canDeleteOrder(admin, { id: 'ord-1', status: 'QUALQUER_COISA' }), true);
  assert.equal(canDeleteOrder(admin, null), false);
  assert.equal(canDeleteOrder(admin, {}), false);
  assert.equal(canDeleteOrder(admin, { status: 'DRAFT' }), false);
  assert.equal(canDeleteOrder(user, { id: 'ord-1', status: 'DRAFT' }), false);
  assert.equal(canDeleteOrder(user, { id: 'ord-1', status: 'PENDING_APPROVAL' }), false);
  assert.equal(canDeleteOrder(user, { id: 'ord-1', status: 'APPROVED' }), false);
  assert.equal(canDeleteOrder(user, { id: 'ord-1', status: 'REJECTED' }), false);
  assert.equal(canDeleteOrder(user, { id: 'ord-1', status: 'CHANGES_REQUESTED' }), false);
  assert.equal(canDeleteOrder(inactiveAdmin, { id: 'ord-1', status: 'DRAFT' }), false);
  assert.equal(canDeleteOrder(inactiveAdmin, { id: 'ord-1', status: 'PENDING_APPROVAL' }), false);
});

test('isAllowedImageMimeType valida tipos aceitos', () => {
  assert.equal(isAllowedImageMimeType('image/jpeg'), true);
  assert.equal(isAllowedImageMimeType('image/png'), true);
  assert.equal(isAllowedImageMimeType('application/pdf'), false);
});

test('buildOrderInput monta payload coerente para criacao do pedido', () => {
  const payload = buildOrderInput({
    items: [
      {
        customerCode: ' sb-001 ',
        description: 'Sabonete liquido',
        notes: 'Primeira caixa',
        quantity: 2,
      },
      {
        description: 'Papel toalha',
        customerCode: 'pt-002',
        quantity: 3,
      },
    ],
    loja: { codigo: 'LOJ-12', marca: 'QDB', nome: 'Shopping Central' },
    notes: 'Pedido de reposicao',
    priority: 'HIGH',
    purpose: 'Reposicao de estoque',
    justification: 'Quebra de estoque.',
  });

  assert.equal(payload.brand, 'QDB');
  assert.equal(payload.store, 'Shopping Central');
  assert.equal(payload.cost_center, 'LOJ-12');
  assert.equal(payload.purpose, 'Reposicao de estoque');
  assert.equal(payload.priority, 'HIGH');
  assert.equal(payload.items.length, 2);
  assert.deepEqual(payload.items[0], {
    description: 'Sabonete liquido',
    notes: 'Primeira caixa',
    product_code: 'SB-001',
    quantity: 2,
  });
  assert.deepEqual(payload.items[1], {
    description: 'Papel toalha',
    notes: null,
    product_code: 'PT-002',
    quantity: 3,
  });
});

test('buildOrderInput falha sem loja ou sem item valido', () => {
  assert.throws(() => buildOrderInput({ loja: null, itens: [] }), /Loja obrigatoria/);
  assert.throws(
    () => buildOrderInput({ loja: { nome: 'Loja A' }, items: [{ productCode: '', description: '', quantity: 1 }] }),
    /Pelo menos um item valido/
  );
  assert.throws(
    () => buildOrderInput({ loja: { nome: 'Loja A' }, items: [{ description: 'Produto sem codigo', quantity: 1 }] }),
    /Pelo menos um item valido/
  );
});

test('validateGeneralData acusa campos obrigatorios faltando', () => {
  const result = validateGeneralData({
    brand: '',
    costCenter: '',
    justification: '',
    lojaId: '',
    priority: '',
    purpose: '',
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.lojaId, 'Selecione a loja.');
  assert.equal(result.errors.brand, 'Marca obrigatoria.');
  assert.equal(result.errors.costCenter, 'Centro de custo obrigatorio.');
  assert.equal(result.errors.purpose, 'Informe a finalidade.');
  assert.equal(result.errors.justification, 'Informe a justificativa.');
  assert.equal(result.errors.priority, 'Prioridade obrigatoria.');
});

test('validateOrderItem acusa campos invalidos', () => {
  const result = validateOrderItem({ description: ' ', productCode: ' ', quantity: 0 });

  assert.equal(result.valid, false);
  assert.equal(result.errors.productCode, 'Informe o cod. cliente.');
  assert.equal(result.errors.description, 'Informe a descricao.');
  assert.equal(result.errors.quantity, 'Quantidade maior que zero.');
});

test('validateOrderItem aceita cod. cliente opcional e normaliza alias', () => {
  const result = validateOrderItem({
    customerCode: '  ab-12 ',
    description: 'Produto X',
    quantity: 1,
  });

  assert.equal(result.valid, true);
  assert.equal(result.item.productCode, 'AB-12');
});

test('validateOrderItem acusa item sem cod. cliente mesmo com observacoes opcionais', () => {
  const result = validateOrderItem({
    description: 'Produto Y',
    notes: 'Observacao livre',
    quantity: 4,
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.productCode, 'Informe o cod. cliente.');
  assert.equal(result.item.productCode, '');
  assert.equal(result.item.notes, 'Observacao livre');
});

test('validateOrderItem acusa descricao vazia, quantidade faltando ou invalida', () => {
  const missingDescription = validateOrderItem({
    description: '   ',
    quantity: 1,
  });
  assert.equal(missingDescription.valid, false);
  assert.equal(missingDescription.errors.description, 'Informe a descricao.');

  const missingQuantity = validateOrderItem({
    description: 'Produto Z',
  });
  assert.equal(missingQuantity.valid, false);
  assert.equal(missingQuantity.errors.quantity, 'Quantidade maior que zero.');

  const zeroQuantity = validateOrderItem({
    description: 'Produto Z',
    quantity: 0,
  });
  assert.equal(zeroQuantity.valid, false);
  assert.equal(zeroQuantity.errors.quantity, 'Quantidade maior que zero.');

  const negativeQuantity = validateOrderItem({
    description: 'Produto Z',
    quantity: -1,
  });
  assert.equal(negativeQuantity.valid, false);
  assert.equal(negativeQuantity.errors.quantity, 'Quantidade maior que zero.');

  const nonNumericQuantity = validateOrderItem({
    description: 'Produto Z',
    quantity: 'abc',
  });
  assert.equal(nonNumericQuantity.valid, false);
  assert.equal(nonNumericQuantity.errors.quantity, 'Quantidade maior que zero.');
});

test('validateOrderItems acusa lista vazia e normaliza itens validos', () => {
  const empty = validateOrderItems([]);
  assert.equal(empty.valid, false);
  assert.equal(empty.errors.items, 'Adicione pelo menos um item.');

  const filled = validateOrderItems([
    {
      description: 'Produto X',
      customerCode: 'abc123',
      quantity: '2',
    },
  ]);
  assert.equal(filled.valid, true);
  assert.equal(filled.items[0].productCode, 'ABC123');
  assert.equal(filled.items[0].quantity, 2);
});

test('validateOrderForm combina erros de dados gerais e itens', () => {
  const result = validateOrderForm({
    generalData: {
      brand: '',
      costCenter: '',
      justification: '',
      lojaId: '',
      priority: '',
      purpose: '',
    },
    items: [{ description: ' ', productCode: '', quantity: 0 }],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.lojaId, 'Selecione a loja.');
  assert.equal(result.errors['item-1.productCode'], 'Informe o cod. cliente.');
  assert.equal(result.errors['item-1.description'], 'Informe a descricao.');
  assert.equal(result.errors['item-1.quantity'], 'Quantidade maior que zero.');
});

test('filterOrdersList aplica busca e filtros por status, loja e solicitante', () => {
  const orders = [
    {
      brand: 'QDB',
      internal_number: 'ORD-1',
      requester_email: 'ana@loja.com',
      requester_id: 'u1',
      requester_name: 'Ana',
      status: 'APPROVED',
      store: 'Loja A',
      store_id: '10',
    },
    {
      brand: 'OB',
      internal_number: 'ORD-2',
      requester_email: 'bruno@loja.com',
      requester_id: 'u2',
      requester_name: 'Bruno',
      status: 'REJECTED',
      store: 'Loja B',
      store_id: '20',
    },
  ];

  assert.equal(filterOrdersList(orders, { search: 'ORD-1' }).length, 1);
  assert.equal(filterOrdersList(orders, { status: 'REJECTED' }).length, 1);
  assert.equal(filterOrdersList(orders, { storeId: '10' }).length, 1);
  assert.equal(filterOrdersList(orders, { requesterId: 'u2' }).length, 1);
  assert.equal(filterOrdersList(orders, { search: 'Loja', status: 'APPROVED' }).length, 1);
});

test('getPaginationMeta respeita limites de pagina', () => {
  const first = getPaginationMeta(1, 41, 20);
  assert.equal(first.currentPage, 1);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.totalPages, 3);

  const last = getPaginationMeta(99, 41, 20);
  assert.equal(last.currentPage, 3);
  assert.equal(last.hasPrevious, true);
  assert.equal(last.hasNext, false);
});
