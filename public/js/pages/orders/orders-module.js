(function initOrdersModule(global) {
  var drawerActionDeps = null;
  var currentDrawerOrderId = null;

  function getElement(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showDrawerLoading() {
    getElement('drawer-overlay').classList.remove('hidden');
    getElement('drawer').style.transform = 'translateX(0)';
    getElement('drawer-protocolo').textContent = '...';
    getElement('drawer-titulo').textContent = 'Carregando...';
    getElement('drawer-status-bar').innerHTML = '';
    getElement('drawer-footer').innerHTML = '';
    var deliveryInfo = getElement('drawer-delivery-info');
    if (deliveryInfo) deliveryInfo.classList.add('hidden');
    var deliveryProtocol = getElement('drawer-delivery-protocol');
    if (deliveryProtocol) deliveryProtocol.textContent = '';
    var deliveryDate = getElement('drawer-delivery-date');
    if (deliveryDate) deliveryDate.textContent = '';
    var imageBlock = getElement('drawer-imagem');
    if (imageBlock) imageBlock.innerHTML = '<div class="text-slate-400 text-sm">Carregando imagens...</div>';
    getElement('drawer-itens').innerHTML = '<div class="text-slate-400 text-sm">Carregando...</div>';
    getElement('drawer-historico').innerHTML = '';
    var deleteBlock = getElement('drawer-delete-block');
    if (deleteBlock) deleteBlock.classList.add('hidden');
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function normalizeOrder(raw) {
    return {
      order: {
        id: raw.id,
        protocolo: raw.protocolo,
        requester_id: raw.requester_id || null,
        store_id: raw.store_id || null,
        loja: raw.lojas && raw.lojas.nome ? raw.lojas.nome : '-',
        data: raw.criado_em ? new Date(raw.criado_em).toLocaleDateString('pt-BR') : '-',
        delivery_date: raw.delivery_date || null,
        delivery_protocol: raw.delivery_protocol || null,
        valor: raw.valor_total ? ('R$ ' + Number(raw.valor_total).toFixed(2)) : '-',
        numero_antilhas: raw.numero_antilhas || raw.delivery_protocol || null,
        status: raw.status,
        placed_at: raw.placed_at || null,
        received_at: raw.received_at || null,
      },
      itens: raw.pedido_itens || [],
      historico: (raw.pedido_historico || []).map(function mapHistory(item, index) {
        return {
          data: new Date(item.criado_em).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          acao: item.acao,
          icone:
            index === 0 ? 'send'
            : item.acao.includes('NF') ? 'file-text'
            : item.acao.includes('ntrega') ? 'package-check'
            : item.acao.includes('provad') ? 'check-circle'
            : item.acao.includes('ejetad') || item.acao.includes('ancelad') ? 'x-circle'
          : 'clock',
        };
      }),
      images: raw.images || raw.order_images || [],
    };
  }

  function renderOrderImageSection(images) {
    var list = Array.isArray(images) ? images : [];
    if (!list.length) {
      return '<div class="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Nenhuma imagem disponível para este pedido.</div>';
    }

    var valid = list.filter(function keepValid(image) {
      return Boolean(image && image.signedUrl && !image.loadError);
    });

    if (!valid.length) {
      return '<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">Não foi possível carregar as imagens do pedido.</div>';
    }

    var count = valid.length;
    var gridClass = count === 1
      ? 'grid-cols-1'
      : count === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';

    var thumbnails = valid.map(function mapThumbnail(image, index) {
      var label = image.original_filename || 'Imagem ' + (index + 1);
      return (
        '<a href="' + escapeHtml(image.signedUrl) + '" target="_blank" rel="noopener noreferrer" class="group block rounded-lg border border-slate-200 bg-white overflow-hidden hover:border-blue-300 transition-colors">' +
          '<img src="' + escapeHtml(image.signedUrl) + '" alt="' + escapeHtml(label) + '" class="w-full h-28 object-cover bg-slate-100">' +
          '<div class="px-2 py-1.5 text-xs text-slate-500 truncate group-hover:text-blue-700">' + escapeHtml(label) + '</div>' +
        '</a>'
      );
    }).join('');

    return (
      '<div class="grid ' + gridClass + ' gap-3">' + thumbnails + '</div>' +
      '<div class="text-xs text-slate-400 mt-2">' + count + ' imagem(ns) - clique para ampliar</div>'
    );
  }

  function renderDrawerDeliveryInfo(order) {
    var hasDeliveryInfo = Boolean(order.delivery_protocol || order.delivery_date || order.placed_at || order.received_at);
    var protocol = order.delivery_protocol || '-';
    var deliveryDate = '-';
    if (order.delivery_date) {
      var dateValue = String(order.delivery_date);
      deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
        ? dateValue.split('-').reverse().join('/')
        : new Date(dateValue).toLocaleDateString('pt-BR');
    }

    return {
      html:
        '<div class="grid grid-cols-2 gap-3">' +
          '<div class="bg-slate-50 rounded-lg p-3">' +
            '<div class="text-xs text-slate-400 mb-0.5">Protocolo</div>' +
            '<div class="text-sm font-medium text-slate-900">' + escapeHtml(protocol) + '</div>' +
          '</div>' +
          '<div class="bg-slate-50 rounded-lg p-3">' +
            '<div class="text-xs text-slate-400 mb-0.5">Data de entrega</div>' +
            '<div class="text-sm font-medium text-slate-900">' + escapeHtml(deliveryDate) + '</div>' +
          '</div>' +
        '</div>',
      visible: hasDeliveryInfo,
    };
  }

  function renderOrderPlacedFooter(order, itens) {
    var itemsHtml = (itens || []).map(function(item, index) {
      var sku = escapeHtml(item.sku_digitado || '-');
      var nome = escapeHtml((item.produtos && item.produtos.nome) || item.sku_digitado || '-');
      var quantidade = Number(item.quantidade || 1);
      return (
        '<div class="border border-slate-200 rounded-lg p-3">' +
          '<div class="flex items-center gap-2 mb-2">' +
            '<span class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">' + sku + '</span>' +
            '<span class="text-sm text-slate-700 flex-1">' + nome + '</span>' +
            '<span class="text-xs text-slate-400">Qtd: ' + quantidade + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-xs text-slate-500">Valor unitario (R$):</label>' +
            '<input type="number" step="0.01" min="0" class="form-input text-sm flex-1 border border-slate-300 rounded-lg px-2 py-1.5 receipt-item-value" data-item-index="' + index + '" data-item-id="' + escapeHtml(item.id) + '" data-quantity="' + quantidade + '" placeholder="0,00" required />' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<form id="drawer-order-placed-form" class="space-y-4">' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
          '<div>' +
            '<label for="drawer-order-protocol" class="block text-sm font-medium text-slate-700 mb-1">Protocolo</label>' +
            '<input id="drawer-order-protocol" name="delivery_protocol" type="text" class="form-input text-sm border border-slate-300 rounded-lg w-full px-3 py-2" autocomplete="off" placeholder="Informe protocolo" />' +
            '<p id="drawer-order-protocol-error" class="mt-1 text-xs text-red-600 hidden"></p>' +
          '</div>' +
          '<div>' +
            '<label for="drawer-order-delivery-date" class="block text-sm font-medium text-slate-700 mb-1">Data de entrega</label>' +
            '<input id="drawer-order-delivery-date" name="delivery_date" type="date" class="form-input text-sm border border-slate-300 rounded-lg w-full px-3 py-2" />' +
            '<p id="drawer-order-delivery-date-error" class="mt-1 text-xs text-red-600 hidden"></p>' +
          '</div>' +
        '</div>' +
        '<div class="border-t border-slate-200 pt-4">' +
          '<div class="text-sm font-medium text-slate-700 mb-2">Valores por item</div>' +
          '<div class="max-h-60 overflow-y-auto space-y-2">' + itemsHtml + '</div>' +
          '<p id="drawer-order-placed-values-error" class="mt-1 text-xs text-red-600 hidden"></p>' +
        '</div>' +
        '<p id="drawer-order-placed-error" class="text-xs text-red-600 hidden"></p>' +
        '<button id="drawer-order-placed-submit" type="submit" class="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed">' +
          '<i data-lucide="package-check" class="w-4 h-4"></i> Pedido realizado' +
        '</button>' +
      '</form>'
    );
  }

  function setFieldError(id, message) {
    var element = getElement(id);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('hidden', !message);
  }

  function renderOrderPlacedMessage() {
    return (
      '<div class="flex items-center justify-center gap-2 text-emerald-600 text-sm font-medium py-1">' +
        '<i data-lucide="check-circle" class="w-4 h-4"></i> Entrega confirmada - nenhuma ação necessária' +
      '</div>'
    );
  }

  function renderOrderPlacedWaitingMessage() {
    return (
      '<div class="flex items-center justify-center gap-2 text-slate-500 text-sm py-1">' +
        '<i data-lucide="clock" class="w-4 h-4"></i> Aguardando confirmação do recebimento' +
      '</div>'
    );
  }

  function renderReceiptForm() {
    return (
      '<form id="drawer-receipt-form" class="space-y-4">' +
        '<div>' +
          '<label for="drawer-receipt-invoice" class="block text-sm font-medium text-slate-700 mb-1">Nota fiscal</label>' +
          '<input id="drawer-receipt-invoice" type="text" class="form-input text-sm border border-slate-300 rounded-lg w-full px-3 py-2" autocomplete="off" placeholder="Ex.: NF-123456" />' +
          '<p id="drawer-receipt-invoice-error" class="mt-1 text-xs text-red-600 hidden"></p>' +
        '</div>' +
        '<p id="drawer-receipt-server-error" class="text-xs text-red-600 hidden"></p>' +
        '<button id="drawer-receipt-confirm-btn" type="submit" class="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed">' +
          '<i data-lucide="package-check" class="w-4 h-4"></i> Confirmar recebimento' +
        '</button>' +
      '</form>'
    );
  }

  function bindOrderPlacedForm(order, itens, deps) {
    var form = getElement('drawer-order-placed-form');
    var protocolInput = getElement('drawer-order-protocol');
    var dateInput = getElement('drawer-order-delivery-date');
    var submitButton = getElement('drawer-order-placed-submit');
    var serverError = getElement('drawer-order-placed-error');
    var protocolError = getElement('drawer-order-protocol-error');
    var dateError = getElement('drawer-order-delivery-date-error');
    if (!form || !protocolInput || !dateInput || !submitButton) return;

    var busy = false;

    function resetErrors() {
      setFieldError('drawer-order-placed-error', '');
      setFieldError('drawer-order-placed-values-error', '');
      setFieldError('drawer-order-protocol-error', '');
      setFieldError('drawer-order-delivery-date-error', '');
      if (serverError) serverError.textContent = '';
      if (protocolError) protocolError.textContent = '';
      if (dateError) dateError.textContent = '';
    }

    function buildItemValues() {
      var values = [];
      document.querySelectorAll('.receipt-item-value').forEach(function(input) {
        var itemId = input.getAttribute('data-item-id');
        var unitValue = Number(input.value);
        if (unitValue > 0) {
          values.push({ order_item_id: itemId, unit_value: unitValue });
        }
      });
      return values;
    }

    function validate() {
      var protocol = String(protocolInput.value || '').trim();
      var deliveryDate = String(dateInput.value || '').trim();
      var valid = true;

      resetErrors();

      if (!protocol) {
        setFieldError('drawer-order-protocol-error', 'Protocolo obrigatorio.');
        valid = false;
      }
      if (!deliveryDate) {
        setFieldError('drawer-order-delivery-date-error', 'Data de entrega obrigatoria.');
        valid = false;
      }

      var itemValues = buildItemValues();
      if (!itemValues.length || itemValues.length < (itens || []).length) {
        setFieldError('drawer-order-placed-values-error', 'Informe o valor unitario de cada item.');
        valid = false;
      }

      submitButton.disabled = busy || !valid;
      return valid;
    }

    protocolInput.addEventListener('input', validate);
    dateInput.addEventListener('input', validate);
    document.querySelectorAll('.receipt-item-value').forEach(function(input) {
      input.addEventListener('input', validate);
    });

    form.addEventListener('submit', async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      if (!validate()) return;

      busy = true;
      submitButton.disabled = true;
      submitButton.innerHTML = '<span class="inline-flex items-center gap-2"><span class="animate-pulse">...</span> Salvando...</span>';

      try {
        if (!deps.API_OK()) {
          throw new Error('Sem conexao com o banco de dados.');
        }

        await deps.markOrderPlacedAPI({
          delivery_date: dateInput.value,
          delivery_protocol: protocolInput.value,
          id: order.id,
          order_id: order.id,
          itemValues: buildItemValues(),
        }, deps);

        deps.showToast('Pedido marcado como realizado com sucesso.');
        await loadOrdersPage(deps, ordersPageState.pagination ? ordersPageState.pagination.page : 1, { refresh: true });
        await openPedido(order.id, deps);
      } catch (error) {
        setFieldError('drawer-order-placed-error', error.message || 'Erro ao registrar pedido realizado.');
        submitButton.disabled = false;
      } finally {
        busy = false;
        submitButton.innerHTML = '<i data-lucide="package-check" class="w-4 h-4"></i> Pedido realizado';
        validate();
        if (global.lucide && typeof global.lucide.createIcons === 'function') {
          global.lucide.createIcons();
        }
      }
    });

    validate();
  }

  function bindReceiptForm(order, deps) {
    var form = getElement('drawer-receipt-form');
    if (!form) return;

    var busy = false;

    function setError(id, message) {
      setFieldError(id, message);
    }

    function validate() {
      var invoice = getElement('drawer-receipt-invoice');
      setError('drawer-receipt-invoice-error', '');

      if (!invoice || !String(invoice.value || '').trim()) {
        setError('drawer-receipt-invoice-error', 'Numero da nota fiscal obrigatorio.');
        return false;
      }

      return true;
    }

    var invoiceInput = getElement('drawer-receipt-invoice');
    if (invoiceInput) {
      invoiceInput.addEventListener('input', function() { setError('drawer-receipt-invoice-error', ''); });
    }

    form.addEventListener('submit', async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      if (!validate()) return;

      busy = true;
      var submitBtn = getElement('drawer-receipt-confirm-btn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="inline-flex items-center gap-2"><span class="animate-pulse">...</span> Confirmando...</span>';

      try {
        if (!deps.API_OK()) {
          throw new Error('Sem conexao com o banco de dados.');
        }

        var invoiceNumber = getElement('drawer-receipt-invoice').value;

        await deps.confirmReceiptAPI(order.id, deps, {
          invoiceNumber: invoiceNumber,
        });

        deps.showToast('Recebimento confirmado com sucesso.');
        await loadOrdersPage(deps, ordersPageState.pagination ? ordersPageState.pagination.page : 1, { refresh: true });
        await openPedido(order.id, deps);
      } catch (error) {
        setError('drawer-receipt-server-error', error.message || 'Erro ao confirmar recebimento.');
        submitBtn.disabled = false;
      } finally {
        busy = false;
        submitBtn.innerHTML = '<i data-lucide="package-check" class="w-4 h-4"></i> Confirmar recebimento';
        if (global.lucide && typeof global.lucide.createIcons === 'function') {
          global.lucide.createIcons();
        }
      }
    });
  }

  function renderPlacedValuesForm(order, itens) {
    var itemsHtml = (itens || []).map(function(item, index) {
      var sku = escapeHtml(item.sku_digitado || '-');
      var nome = escapeHtml((item.produtos && item.produtos.nome) || item.sku_digitado || '-');
      var quantidade = Number(item.quantidade || 1);
      var currentVal = item.placed_unit_value ? Number(item.placed_unit_value).toFixed(2) : '';
      return (
        '<div class="border border-slate-200 rounded-lg p-3">' +
          '<div class="flex items-center gap-2 mb-2">' +
            '<span class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">' + sku + '</span>' +
            '<span class="text-sm text-slate-700 flex-1">' + nome + '</span>' +
            '<span class="text-xs text-slate-400">Qtd: ' + quantidade + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-xs text-slate-500">Valor unitario (R$):</label>' +
            '<input type="number" step="0.01" min="0" class="form-input text-sm flex-1 border border-slate-300 rounded-lg px-2 py-1.5 receipt-item-value" data-item-index="' + index + '" data-item-id="' + escapeHtml(item.id) + '" data-quantity="' + quantidade + '" placeholder="0,00" value="' + escapeHtml(currentVal) + '" required />' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<form id="drawer-placed-values-form" class="space-y-4">' +
        '<div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 flex items-start gap-2">' +
          '<i data-lucide="alert-triangle" class="w-4 h-4 mt-0.5 shrink-0"></i>' +
          '<span>Este pedido foi realizado sem os valores dos itens. Preencha os valores abaixo para liberar o recebimento.</span>' +
        '</div>' +
        '<div class="border-t border-slate-200 pt-4">' +
          '<div class="text-sm font-medium text-slate-700 mb-2">Valores por item</div>' +
          '<div class="max-h-60 overflow-y-auto space-y-2">' + itemsHtml + '</div>' +
          '<p id="drawer-placed-values-values-error" class="mt-1 text-xs text-red-600 hidden"></p>' +
        '</div>' +
        '<p id="drawer-placed-values-error" class="text-xs text-red-600 hidden"></p>' +
        '<button id="drawer-placed-values-submit" type="submit" class="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed">' +
          '<i data-lucide="save" class="w-4 h-4"></i> Salvar valores' +
        '</button>' +
      '</form>'
    );
  }

  function bindPlacedValuesForm(order, itens, deps) {
    var form = getElement('drawer-placed-values-form');
    var submitButton = getElement('drawer-placed-values-submit');
    if (!form || !submitButton) return;

    var busy = false;

    function setError(id, message) {
      setFieldError(id, message);
    }

    function buildItemValues() {
      var values = [];
      document.querySelectorAll('.receipt-item-value').forEach(function(input) {
        var itemId = input.getAttribute('data-item-id');
        var unitValue = Number(input.value);
        if (unitValue > 0) {
          values.push({ order_item_id: itemId, unit_value: unitValue });
        }
      });
      return values;
    }

    function validate() {
      setError('drawer-placed-values-values-error', '');
      var itemValues = buildItemValues();
      if (!itemValues.length || itemValues.length < (itens || []).length) {
        setError('drawer-placed-values-values-error', 'Informe o valor unitario de cada item.');
        return false;
      }
      return true;
    }

    document.querySelectorAll('.receipt-item-value').forEach(function(input) {
      input.addEventListener('input', function() { setError('drawer-placed-values-values-error', ''); });
    });

    form.addEventListener('submit', async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      if (!validate()) return;

      busy = true;
      submitButton.disabled = true;
      submitButton.innerHTML = '<span class="inline-flex items-center gap-2"><span class="animate-pulse">...</span> Salvando...</span>';

      try {
        if (!deps.API_OK()) {
          throw new Error('Sem conexao com o banco de dados.');
        }

        await deps.fillPlacedValuesAPI({
          id: order.id,
          order_id: order.id,
          itemValues: buildItemValues(),
        }, deps);

        deps.showToast('Valores salvos com sucesso.');
        await loadOrdersPage(deps, ordersPageState.pagination ? ordersPageState.pagination.page : 1, { refresh: true });
        await openPedido(order.id, deps);
      } catch (error) {
        setError('drawer-placed-values-error', error.message || 'Erro ao salvar valores.');
        submitButton.disabled = false;
      } finally {
        busy = false;
        submitButton.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i> Salvar valores';
        if (global.lucide && typeof global.lucide.createIcons === 'function') {
          global.lucide.createIcons();
        }
      }
    });
  }

  function renderDrawer(orderData, deps) {
    drawerActionDeps = deps;
    var order = orderData.order;
    var itens = orderData.itens;
    var historico = orderData.historico;
    var images = orderData.images || [];
    var currentUser = deps.getCurrentUser ? deps.getCurrentUser() : null;
    var canApprove = deps.canApproveOrder ? deps.canApproveOrder(currentUser, order) : false;
    var canReject = deps.canRejectOrder ? deps.canRejectOrder(currentUser, order) : false;
    var canRequestChanges = deps.canRequestChangesOrder ? deps.canRequestChangesOrder(currentUser, order) : false;
    var canEdit = deps.canEditOrder ? deps.canEditOrder(currentUser, order) : false;
    var canDelete = deps.canDeleteOrder ? deps.canDeleteOrder(currentUser, order) : false;

    getElement('drawer-protocolo').textContent = order.protocolo || order.id;
    getElement('drawer-titulo').textContent = order.loja;

    var statusBar = deps.renderDrawerStatusBar(order);
    getElement('drawer-status-bar').className = statusBar.className;
    getElement('drawer-status-bar').innerHTML = statusBar.html;

    getElement('drawer-loja').textContent = order.loja;
    getElement('drawer-data').textContent = order.data;
    var deliveryInfo = renderDrawerDeliveryInfo(order);
    var deliveryBlock = getElement('drawer-delivery-info');
    if (deliveryBlock) {
      deliveryBlock.innerHTML = deliveryInfo.html;
      deliveryBlock.classList.toggle('hidden', !deliveryInfo.visible);
    }
    var deliveryProtocol = getElement('drawer-delivery-protocol');
    if (deliveryProtocol) deliveryProtocol.textContent = order.delivery_protocol || '-';
    var deliveryDate = getElement('drawer-delivery-date');
    if (deliveryDate) {
      var deliveryDateValue = order.delivery_date ? String(order.delivery_date) : '';
      deliveryDate.textContent = deliveryDateValue && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDateValue)
        ? deliveryDateValue.split('-').reverse().join('/')
        : deliveryDateValue
          ? new Date(deliveryDateValue).toLocaleDateString('pt-BR')
          : '-';
    }
    var imageBlock = getElement('drawer-imagem');
    if (imageBlock) {
      imageBlock.innerHTML = renderOrderImageSection(images);
    }
    getElement('drawer-itens').innerHTML = deps.renderDrawerItems(itens);
    getElement('drawer-historico').innerHTML = deps.renderDrawerHistory(historico);

    var needsDecision = order.status === 'PENDING_APPROVAL';
    var isApproved = String(order.status || '').toUpperCase() === 'APPROVED';
    var isOrderPlaced = String(order.status || '').toUpperCase() === 'ORDER_PLACED';
    var isReceived = String(order.status || '').toUpperCase() === 'RECEIVED';
    var canMarkOrderPlaced = deps.canMarkOrderPlaced ? deps.canMarkOrderPlaced(currentUser, order) : false;
    var canConfirmReceipt = deps.canConfirmReceipt ? deps.canConfirmReceipt(currentUser, order) : false;
    var canFillPlacedValues = deps.canFillPlacedValues ? deps.canFillPlacedValues(currentUser, order, itens) : false;

    if (needsDecision && (canApprove || canReject || canRequestChanges)) {
      getElement('drawer-justificativa-bloco').classList.remove('hidden');
      getElement('drawer-footer').innerHTML =
        '<div class="flex flex-col sm:flex-row gap-3">' +
          (canRequestChanges ? '<button type="button" data-order-action="solicitar" data-order-id="' + escapeHtml(order.id) + '" class="flex-1 flex items-center justify-center gap-2 bg-violet-50 hover:bg-violet-100 text-violet-700 font-medium px-4 py-2.5 rounded-lg transition-colors text-sm border border-violet-200">' +
            '<i data-lucide="message-square-warning" class="w-4 h-4"></i> Solicitar Edição' +
          '</button>' : '') +
          (canReject ? '<button type="button" data-order-action="rejeitar" data-order-id="' + escapeHtml(order.id) + '" class="flex-1 flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 font-medium px-4 py-2.5 rounded-lg transition-colors text-sm border border-red-200">' +
            '<i data-lucide="x-circle" class="w-4 h-4"></i> Rejeitar' +
          '</button>' : '') +
          (canApprove ? '<button type="button" data-order-action="aprovar" data-order-id="' + escapeHtml(order.id) + '" class="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm">' +
            '<i data-lucide="check-circle" class="w-4 h-4"></i> Aprovar' +
          '</button>' : '') +
        '</div>';
    } else if (canMarkOrderPlaced && isApproved) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML = renderOrderPlacedFooter(order, itens);
      bindOrderPlacedForm(order, itens, deps);
    } else if (canFillPlacedValues && isOrderPlaced) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML = renderPlacedValuesForm(order, itens);
      bindPlacedValuesForm(order, itens, deps);
    } else if (canConfirmReceipt && isOrderPlaced) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML = renderReceiptForm();
      bindReceiptForm(order, deps);
    } else if (isReceived) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML = renderOrderPlacedMessage();
    } else if (isOrderPlaced) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML = renderOrderPlacedWaitingMessage();
    } else if (canEdit) {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML =
        '<button type="button" data-order-action="edit" data-order-id="' + escapeHtml(order.id) + '" class="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors text-sm">' +
          '<i data-lucide="pencil-line" class="w-4 h-4"></i> Editar e reenviar' +
        '</button>';
    } else {
      getElement('drawer-justificativa-bloco').classList.add('hidden');
      getElement('drawer-footer').innerHTML =
        '<div class="flex items-center justify-center gap-2 text-slate-400 text-sm py-1">' +
          '<i data-lucide="clock" class="w-4 h-4"></i> Aguardando proxima etapa automatica' +
        '</div>';
    }

    if (canDelete) {
      var deleteBlock = getElement('drawer-delete-block');
      if (deleteBlock) deleteBlock.classList.remove('hidden');
    }

    getElement('drawer-overlay').classList.remove('hidden');
    getElement('drawer').style.transform = 'translateX(0)';
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  async function openPedido(id, deps) {
    bindDrawerShellListeners();
    showDrawerLoading();
    currentDrawerOrderId = id;

    var orderData = null;
    if (deps.API_OK()) {
      try {
        var raw = await deps.carregarPedido(id);
        if (raw) {
          orderData = normalizeOrder(raw);
        }
      } catch (error) {
        console.warn('openPedido error:', error);
      }
    }

    if (!orderData) {
      getElement('drawer-titulo').textContent = 'Pedido nao encontrado';
      getElement('drawer-protocolo').textContent = id;
      return;
    }

    renderDrawer(orderData, deps);
  }

  function editarPedido(id) {
    var deps = drawerActionDeps || {};
    if (typeof deps.navigateTo === 'function') {
      deps.navigateTo('/novo-pedido?orderId=' + encodeURIComponent(id));
    }
    closeDrawer();
  }

  function closeDrawer() {
    currentDrawerOrderId = null;
    getElement('drawer').style.transform = 'translateX(100%)';
    var deleteBlock = getElement('drawer-delete-block');
    if (deleteBlock) deleteBlock.classList.add('hidden');
    var deliveryInfo = getElement('drawer-delivery-info');
    if (deliveryInfo) deliveryInfo.classList.add('hidden');
    var deleteBtn = getElement('drawer-delete-btn');
    if (deleteBtn) deleteBtn.disabled = false;
    setTimeout(function hideOverlay() {
      getElement('drawer-overlay').classList.add('hidden');
    }, 300);
  }

  async function decidirPedido(id, action, deps) {
    var justification = (getElement('drawer-justificativa') || {}).value || '';
    justification = justification.trim();
    var justificationField = getElement('drawer-justificativa');
    if (justificationField) justificationField.classList.remove('orders-drawer-textarea--error');

    if ((action === 'rejeitar' || action === 'solicitar') && !justification) {
      justificationField?.focus();
      justificationField?.classList.add('orders-drawer-textarea--error');
      setTimeout(function clearHighlight() {
        var field = getElement('drawer-justificativa');
        if (field) field.classList.remove('orders-drawer-textarea--error');
      }, 2000);
      return;
    }

    var statusMap = { aprovar: 'APPROVED', rejeitar: 'REJECTED', solicitar: 'CHANGES_REQUESTED' };
    var messages = {
      aprovar: 'Pedido aprovado.',
      rejeitar: 'Pedido rejeitado.',
      solicitar: 'Alterações solicitadas.',
    };

    document.querySelectorAll('#drawer-footer button').forEach(function disableButton(button) {
      button.disabled = true;
    });

    try {
      if (!statusMap[action]) {
        deps.showToast('Acao nao suportada no fluxo atual.');
        return;
      }

      if (deps.API_OK()) {
        await deps.decidirPedidoAPI(id, statusMap[action], justification);
      } else {
        deps.showToast('Sem conexao com o banco de dados.');
        return;
      }

      closeDrawer();
      deps.showToast(messages[action]);
    } catch (error) {
      deps.showToast('Erro ao registrar decisao: ' + error.message);
      document.querySelectorAll('#drawer-footer button').forEach(function enableButton(button) {
        button.disabled = false;
      });
    }
  }

  function createInitialOrdersPageState() {
    return {
      error: null,
      filteredOrders: [],
      filters: {
        requesterId: '',
        search: '',
        status: '',
        storeId: '',
      },
      loadedAt: null,
      loading: false,
      orders: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
      },
      profile: null,
      refreshing: false,
    };
  }

  var ordersPageState = createInitialOrdersPageState();
  var ordersPageBound = false;

  function getUtils() {
    if (!global.AppUtils) {
      throw new Error('Utilitarios de pedidos indisponiveis.');
    }
    return global.AppUtils;
  }

  function setText(id, value) {
    var element = getElement(id);
    if (element) {
      element.textContent = value;
    }
  }

  function setVisible(id, visible) {
    var element = getElement(id);
    if (element) {
      element.classList.toggle('hidden', !visible);
    }
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function formatDate(value, includeTime) {
    if (!value) return '-';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR', includeTime ? {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
      year: 'numeric',
    } : {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function getRequesterLabel(order) {
    return order.requester_name || order.requester_email || order.requester_id || '-';
  }

  function getStoreLabel(order) {
    return order.store || '-';
  }

  function createStatusBadge(status) {
    var meta = getUtils().getStatusMeta(status);
    var badge = document.createElement('span');
    badge.className = 'status-badge ' + meta.cls;
    badge.textContent = meta.label;
    return badge;
  }

  function createActionButton(orderId) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary text-xs orders-action-button';
    button.setAttribute('aria-label', 'Visualizar pedido');
    button.addEventListener('click', function openOrder() {
      if (typeof global.openPedido === 'function') {
        global.openPedido(orderId);
      }
    });

    var icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'eye');
    icon.className = 'w-4 h-4';

    var label = document.createElement('span');
    label.textContent = 'Visualizar';

    button.appendChild(icon);
    button.appendChild(label);
    return button;
  }

  function renderSummaryCards() {
    var counts = {
      APPROVED: 0,
      CHANGES_REQUESTED: 0,
      PENDING_APPROVAL: 0,
      REJECTED: 0,
    };

    ordersPageState.filteredOrders.forEach(function countOrder(order) {
      if (counts[order.status] !== undefined) {
        counts[order.status] += 1;
      }
    });

    setText('orders-summary-pending', String(counts.PENDING_APPROVAL));
    setText('orders-summary-approved', String(counts.APPROVED));
    setText('orders-summary-changes', String(counts.CHANGES_REQUESTED));
    setText('orders-summary-rejected', String(counts.REJECTED));
  }

  function renderFilterOptions() {
    var storeFilter = getElement('orders-store-filter');
    var requesterFilter = getElement('orders-requester-filter');
    var isAdmin = ordersPageState.profile && ordersPageState.profile.papel === 'admin';
    var stores = new Map();
    var requesters = new Map();

    ordersPageState.orders.forEach(function collect(order) {
      var storeKey = String(order.store_id || order.store || '');
      if (storeKey && !stores.has(storeKey)) {
        stores.set(storeKey, {
          label: order.store || 'Loja sem nome',
          value: String(order.store_id || order.store || ''),
        });
      }

      if (order.requester_id && !requesters.has(order.requester_id)) {
        requesters.set(order.requester_id, {
          label: getRequesterLabel(order),
          value: order.requester_id,
        });
      }
    });

    if (storeFilter) {
      clearNode(storeFilter);
      var storeDefault = document.createElement('option');
      storeDefault.value = '';
      storeDefault.textContent = 'Todas as lojas';
      storeFilter.appendChild(storeDefault);

      Array.from(stores.values()).forEach(function appendStore(option) {
        var storeOption = document.createElement('option');
        storeOption.value = option.value;
        storeOption.textContent = option.label;
        storeFilter.appendChild(storeOption);
      });
      storeFilter.value = ordersPageState.filters.storeId || '';
    }

    if (requesterFilter) {
      clearNode(requesterFilter);
      var requesterDefault = document.createElement('option');
      requesterDefault.value = '';
      requesterDefault.textContent = 'Todos os solicitantes';
      requesterFilter.appendChild(requesterDefault);

      Array.from(requesters.values()).forEach(function appendRequester(option) {
        var requesterOption = document.createElement('option');
        requesterOption.value = option.value;
        requesterOption.textContent = option.label;
        requesterFilter.appendChild(requesterOption);
      });
      requesterFilter.value = ordersPageState.filters.requesterId || '';
      getElement('orders-requester-filter-wrap')?.classList.toggle('hidden', !isAdmin);
    }
  }

  function renderPagination() {
    var utils = getUtils();
    var meta = utils.getPaginationMeta(
      ordersPageState.pagination.page,
      ordersPageState.pagination.total,
      ordersPageState.pagination.pageSize
    );

    setText('orders-page-indicator', 'Página ' + meta.currentPage + ' de ' + meta.totalPages);
    setText('orders-pagination-label', ordersPageState.filteredOrders.length + ' pedido(s) na página atual');

    var prev = getElement('orders-prev-page');
    var next = getElement('orders-next-page');
    if (prev) prev.disabled = !meta.hasPrevious || ordersPageState.loading || ordersPageState.refreshing;
    if (next) next.disabled = !meta.hasNext || ordersPageState.loading || ordersPageState.refreshing;
  }

  function createOrderRow(order) {
    var tr = document.createElement('tr');
    tr.className = 'table-row';

    var cols = [
      order.internal_number || '-',
      formatDate(order.created_at, false),
      getRequesterLabel(order),
      getStoreLabel(order),
      order.priority || '-',
      null,
      formatDate(order.updated_at, true),
      null,
    ];

    cols.forEach(function appendCell(value, index) {
      var td = document.createElement('td');
      td.className = 'table-td align-top text-center';

      if (index === 5) {
        td.appendChild(createStatusBadge(order.status));
      } else if (index === 7) {
        td.appendChild(createActionButton(order.id));
      } else if (index === 0) {
        var number = document.createElement('div');
        number.className = 'orders-order-number';
        number.textContent = value;
        td.appendChild(number);
      } else if (index === 1 || index === 6) {
        td.classList.add('orders-meta');
        td.textContent = value;
      } else {
        td.textContent = value;
      }

      tr.appendChild(td);
    });

    return tr;
  }

  function createMobileCard(order) {
    var card = document.createElement('article');
    card.className = 'orders-mobile-card';

    var top = document.createElement('div');
    top.className = 'flex items-start justify-between gap-3';

    var titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0';

    var number = document.createElement('div');
    number.className = 'text-sm font-semibold text-slate-900 truncate';
    number.textContent = order.internal_number || '-';

    var store = document.createElement('div');
    store.className = 'text-xs text-slate-500 mt-0.5 truncate';
    store.textContent = getStoreLabel(order);

    titleWrap.appendChild(number);
    titleWrap.appendChild(store);

    var badgeWrap = document.createElement('div');
    badgeWrap.appendChild(createStatusBadge(order.status));

    top.appendChild(titleWrap);
    top.appendChild(badgeWrap);

    var grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-3 text-sm';

    var items = [
      ['Data', formatDate(order.created_at, false)],
      ['Solicitante', getRequesterLabel(order)],
      ['Prioridade', order.priority || '-'],
      ['Atualizado em', formatDate(order.updated_at, true)],
    ];

    items.forEach(function appendItem(pair) {
      var box = document.createElement('div');
      box.className = 'bg-slate-50 rounded-xl p-3 min-w-0';

      var label = document.createElement('div');
      label.className = 'text-xs text-slate-400 mb-0.5';
      label.textContent = pair[0];

      var value = document.createElement('div');
      value.className = 'text-sm font-medium text-slate-900 break-words';
      value.textContent = pair[1];

      box.appendChild(label);
      box.appendChild(value);
      grid.appendChild(box);
    });

    var actionWrap = document.createElement('div');
    actionWrap.className = 'pt-1';
    actionWrap.appendChild(createActionButton(order.id));

    card.appendChild(top);
    card.appendChild(grid);
    card.appendChild(actionWrap);
    return card;
  }

  function showOrdersLoading() {
    setVisible('orders-loading', true);
    setVisible('orders-error', false);
    setVisible('orders-empty', false);
    setVisible('orders-results', false);
    renderPagination();
  }

  function showOrdersError(error) {
    setVisible('orders-loading', false);
    setVisible('orders-error', true);
    setVisible('orders-empty', false);
    setVisible('orders-results', false);
    setText('orders-error-message', error?.message || String(error || 'Erro desconhecido.'));
    console.error('[orders-page] load failed:', error);
    renderPagination();
  }

  function showOrdersEmpty() {
    var currentUser = ordersPageState.profile;
    var isAdmin = currentUser && currentUser.papel === 'admin';
    setVisible('orders-loading', false);
    setVisible('orders-error', false);
    setVisible('orders-empty', true);
    setVisible('orders-results', false);
    setText(
      'orders-empty-message',
      isAdmin
        ? 'Nenhum pedido encontrado.'
        : 'Nenhum pedido foi encontrado para as lojas às quais você tem acesso.'
    );
    renderPagination();
  }

  function renderOrdersList() {
    var tableBody = getElement('orders-table-body');
    var mobileList = getElement('orders-mobile-list');
    var filtered = ordersPageState.filteredOrders;

    if (tableBody) clearNode(tableBody);
    if (mobileList) clearNode(mobileList);

    filtered.forEach(function appendOrder(order) {
      if (tableBody) tableBody.appendChild(createOrderRow(order));
      if (mobileList) mobileList.appendChild(createMobileCard(order));
    });

    renderSummaryCards();
    renderFilterOptions();
    renderPagination();

    setVisible('orders-loading', false);
    setVisible('orders-error', false);
    setVisible('orders-empty', false);
    setVisible('orders-results', true);

    if (!filtered.length) {
      showOrdersEmpty();
      return;
    }

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function applyCurrentFilters() {
    var utils = getUtils();
    ordersPageState.filteredOrders = utils.filterOrdersList(ordersPageState.orders, ordersPageState.filters);
  }

  function syncFiltersFromDom() {
    ordersPageState.filters.search = getElement('orders-search')?.value?.trim() || '';
    ordersPageState.filters.status = getElement('orders-status-filter')?.value || '';
    ordersPageState.filters.storeId = getElement('orders-store-filter')?.value || '';
    ordersPageState.filters.requesterId = getElement('orders-requester-filter')?.value || '';
  }

  async function loadOrdersPage(deps, page, options) {
    var isRefresh = options && options.refresh;
    ordersPageState.loading = !isRefresh;
    ordersPageState.refreshing = !!isRefresh;
    ordersPageState.error = null;

    if (!isRefresh) {
      showOrdersLoading();
    }

    try {
      var result = await deps.listOrdersForCurrentProfile({
        page: page,
        pageSize: ordersPageState.pagination.pageSize,
      });

      ordersPageState.orders = result.items || [];
      ordersPageState.pagination.page = result.page || page;
      ordersPageState.pagination.pageSize = result.pageSize || ordersPageState.pagination.pageSize;
      ordersPageState.pagination.total = result.total || 0;
      ordersPageState.loadedAt = new Date().toISOString();
      applyCurrentFilters();
      renderOrdersList();
    } catch (error) {
      ordersPageState.error = error;
      showOrdersError(error);
    } finally {
      ordersPageState.loading = false;
      ordersPageState.refreshing = false;
      renderPagination();
    }
  }

  function scheduleReload(page, deps, options) {
    ordersPageState.pagination.page = page;
    return loadOrdersPage(deps, page, options);
  }

  function handleFilterChange(deps) {
    syncFiltersFromDom();
    ordersPageState.pagination.page = 1;
    return loadOrdersPage(deps, 1, { refresh: false });
  }

  function bindOrdersPageListeners(deps) {
    if (ordersPageBound) {
      return;
    }

    var search = getElement('orders-search');
    var status = getElement('orders-status-filter');
    var store = getElement('orders-store-filter');
    var requester = getElement('orders-requester-filter');
    var refresh = getElement('orders-refresh-btn');
    var retry = getElement('orders-retry-btn');
    var searchFocus = getElement('orders-search-focus');
    var prev = getElement('orders-prev-page');
    var next = getElement('orders-next-page');

    if (search) {
      search.addEventListener('input', function onSearchInput() {
        handleFilterChange(deps);
      });
    }

    if (status) {
      status.addEventListener('change', function onStatusChange() {
        handleFilterChange(deps);
      });
    }

    if (store) {
      store.addEventListener('change', function onStoreChange() {
        handleFilterChange(deps);
      });
    }

    if (requester) {
      requester.addEventListener('change', function onRequesterChange() {
        handleFilterChange(deps);
      });
    }

    if (refresh) {
      refresh.addEventListener('click', function onRefresh() {
        loadOrdersPage(deps, ordersPageState.pagination.page, { refresh: true });
      });
    }

    if (retry) {
      retry.addEventListener('click', function onRetry() {
        loadOrdersPage(deps, ordersPageState.pagination.page, { refresh: false });
      });
    }

    if (searchFocus) {
      searchFocus.addEventListener('click', function focusSearch() {
        search?.focus();
      });
    }

    if (prev) {
      prev.addEventListener('click', function onPrev() {
        var meta = getUtils().getPaginationMeta(
          ordersPageState.pagination.page,
          ordersPageState.pagination.total,
          ordersPageState.pagination.pageSize
        );
        if (!meta.hasPrevious) return;
        ordersPageState.pagination.page = meta.currentPage - 1;
        loadOrdersPage(deps, ordersPageState.pagination.page, { refresh: false });
      });
    }

    if (next) {
      next.addEventListener('click', function onNext() {
        var meta = getUtils().getPaginationMeta(
          ordersPageState.pagination.page,
          ordersPageState.pagination.total,
          ordersPageState.pagination.pageSize
        );
        if (!meta.hasNext) return;
        ordersPageState.pagination.page = meta.currentPage + 1;
        loadOrdersPage(deps, ordersPageState.pagination.page, { refresh: false });
      });
    }

    ordersPageBound = true;
  }

  async function afterRenderPedidos(deps) {
    bindDrawerShellListeners();
    ordersPageState = createInitialOrdersPageState();
    ordersPageState.profile = deps.getCurrentUser ? deps.getCurrentUser() : null;
    ordersPageBound = false;
    bindOrdersPageListeners(deps);
    await loadOrdersPage(deps, 1, { refresh: false });
  }

  async function excluirPedido(id, deps) {
    if (!deps) deps = drawerActionDeps || {};
    var actualId = id || currentDrawerOrderId;
    if (!actualId) {
      deps.showToast('Nenhum pedido selecionado.');
      return;
    }

    var protocol = getElement('drawer-protocolo') ? getElement('drawer-protocolo').textContent : actualId;
    var password = await ConfirmModal.confirmPassword(
      'Excluir pedido',
      'Esta ação excluirá permanentemente o pedido ' + protocol + ' e todas as imagens relacionadas. O registro da exclusão será mantido no histórico de auditoria. Digite sua senha de login para confirmar.'
    );
    if (!password) return;

    document.querySelectorAll('#drawer-footer button, #drawer-delete-block button').forEach(function disable(b) {
      b.disabled = true;
    });

    try {
      if (deps.API_OK()) {
        await deps.deletarPedidoAPI(actualId, deps, password);
      } else {
        deps.showToast('Sem conexao com o banco de dados.');
        return;
      }

      closeDrawer();
      deps.showToast('Pedido excluído com sucesso. A exclusão foi registrada no histórico de auditoria.');
      await loadOrdersPage(deps, ordersPageState.pagination ? ordersPageState.pagination.page : 1, { refresh: true });
    } catch (error) {
      deps.showToast(error.message);
      document.querySelectorAll('#drawer-footer button, #drawer-delete-block button').forEach(function enable(b) {
        b.disabled = false;
      });
    }
  }

  var ALLOWED_FOOTER_ACTIONS = {
    aprovar: true,
    rejeitar: true,
    solicitar: true,
    edit: true,
  };

  function bindDrawerShellListeners() {
    var drawerOverlay = getElement('drawer-overlay');
    if (drawerOverlay && !drawerOverlay.dataset.bound) {
      drawerOverlay.addEventListener('click', closeDrawer);
      drawerOverlay.dataset.bound = 'true';
    }

    var drawerCloseBtn = getElement('drawer-close-btn');
    if (drawerCloseBtn && !drawerCloseBtn.dataset.bound) {
      drawerCloseBtn.addEventListener('click', closeDrawer);
      drawerCloseBtn.dataset.bound = 'true';
    }

    var drawerDeleteBtn = getElement('drawer-delete-btn');
    if (drawerDeleteBtn && !drawerDeleteBtn.dataset.bound) {
      drawerDeleteBtn.addEventListener('click', function onDeleteOrder() {
        excluirPedido();
      });
      drawerDeleteBtn.dataset.bound = 'true';
    }

    var drawerFooter = getElement('drawer-footer');
    if (drawerFooter && !drawerFooter.dataset.boundActions) {
      drawerFooter.addEventListener('click', function onDrawerFooterClick(event) {
        var button = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-order-action]') : null;
        if (!button || button.disabled) return;

        var action = button.getAttribute('data-order-action');
        if (!action) return;

        var orderId = button.getAttribute('data-order-id');
        if (!orderId || !String(orderId).trim()) return;

        if (!ALLOWED_FOOTER_ACTIONS[String(action).toLowerCase()]) {
          console.warn('Acao nao permitida no footer:', action);
          return;
        }

        var deps = drawerActionDeps || {};

        if (action === 'edit') {
          editarPedido(orderId);
        } else {
          decidirPedido(orderId, action, deps);
        }
      });
      drawerFooter.dataset.boundActions = 'true';
    }
  }

  global.OrdersModule = {
    closeDrawer: closeDrawer,
    decidirPedido: decidirPedido,
    afterRenderPedidos: afterRenderPedidos,
    editarPedido: editarPedido,
    excluirPedido: excluirPedido,
    openPedido: openPedido,
    bindDrawerShellListeners: bindDrawerShellListeners,
  };

  global.editarPedido = editarPedido;
  global.decidirPedido = function(id, action) {
    return decidirPedido(id, action, drawerActionDeps || {});
  };
  global.excluirPedido = function(id) {
    return excluirPedido(id || currentDrawerOrderId, drawerActionDeps || {});
  };
})(window);
