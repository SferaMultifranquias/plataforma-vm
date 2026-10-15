(function initStockCheckModule(global) {
  var allChecks = [];
  var allReceipts = [];
  var filteredChecks = [];
  var filteredReceipts = [];
  var loadToken = 0;
  var currentDeps = null;
  var exportMenuOpen = false;
  var isAdmin = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getStoreLabel(item) {
    if (item.lojas && item.lojas.nome) {
      return escapeHtml(item.lojas.nome);
    }
    return 'Loja #' + item.store_id;
  }

  function statusLabel(s) {
    var labels = {
      pending_check: 'Pendente',
      in_stock: 'Em estoque',
      partial_stock: 'Parcial',
      out_of_stock: 'Sem estoque',
      needs_purchase: 'Necessita compra',
    };
    return labels[s] || s;
  }

  function showLoading() {
    document.getElementById('sc-loading').classList.remove('hidden');
    document.getElementById('sc-error').classList.add('hidden');
    document.getElementById('sc-empty').classList.add('hidden');
    document.getElementById('sc-received-section').classList.add('hidden');
  }

  function showError(msg) {
    document.getElementById('sc-loading').classList.add('hidden');
    document.getElementById('sc-error').classList.remove('hidden');
    document.getElementById('sc-error-msg').textContent = msg;
    document.getElementById('sc-empty').classList.add('hidden');
    document.getElementById('sc-received-section').classList.add('hidden');
  }

  function showEmpty() {
    document.getElementById('sc-loading').classList.add('hidden');
    document.getElementById('sc-error').classList.add('hidden');
    document.getElementById('sc-empty').classList.remove('hidden');
    document.getElementById('sc-received-section').classList.add('hidden');
  }

  function renderReceivedTable(receipts) {
    var tbody = document.getElementById('sc-received-tbody');
    if (!tbody) return;
    var counter = document.getElementById('sc-received-counter');
    if (counter) counter.textContent = receipts.length + ' item(ns) recebido(s)';
    var actionTh = document.getElementById('sc-received-action-th');
    if (actionTh) actionTh.style.display = isAdmin ? '' : 'none';
    if (!receipts.length) {
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = receipts.map(function(item) {
      var receivedAt = item.received_at ? new Date(item.received_at).toLocaleString('pt-BR') : '-';
      var invoiceNumber = item.order_receipts ? item.order_receipts.invoice_number : null;
      var unitValue = item.received_unit_value != null ? 'R$ ' + Number(item.received_unit_value).toFixed(2) : '-';
      var totalValue = item.received_total_value != null ? 'R$ ' + Number(item.received_total_value).toFixed(2) : '-';
      var actionsCell = '';
      if (isAdmin) {
        actionsCell = '<td class="table-td text-center" data-receipt-id="' + escapeHtml(item.id) + '">' +
          '<button type="button" class="sc-receipt-action-btn sc-receipt-action-btn--edit" data-sr-action="edit" title="Editar">Editar</button>' +
          ' <button type="button" class="sc-receipt-action-btn sc-receipt-action-btn--void" data-sr-action="void" title="Anular">Anular</button>' +
          '</td>';
      }
      return '<tr data-receipt-id="' + escapeHtml(item.id) + '">' +
        '<td class="table-td text-center">' + getStoreLabel(item) + '</td>' +
        '<td class="table-td text-center"><code class="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">' + escapeHtml(item.product_code) + '</code></td>' +
        '<td class="table-td text-center">' + escapeHtml(item.description || '-') + '</td>' +
        '<td class="table-td text-center">' + Number(item.received_quantity).toFixed(2) + '</td>' +
        '<td class="table-td text-center">' + escapeHtml(item.unit || 'un') + '</td>' +
        '<td class="table-td text-center">' + escapeHtml(invoiceNumber || '-') + '</td>' +
        '<td class="table-td text-center">' + unitValue + '</td>' +
        '<td class="table-td text-center">' + totalValue + '</td>' +
        '<td class="table-td text-center text-xs text-slate-400">' + receivedAt + '</td>' +
        actionsCell +
        '</tr>';
    }).join('');
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function showReceived(receipts) {
    document.getElementById('sc-loading').classList.add('hidden');
    document.getElementById('sc-error').classList.add('hidden');
    document.getElementById('sc-empty').classList.add('hidden');
    document.getElementById('sc-received-section').classList.remove('hidden');
    renderReceivedTable(receipts);
  }

  function updateChecksActionCol() {
    var col = document.getElementById('sc-checks-action-col');
    var th = document.getElementById('sc-checks-action-th');
    var display = isAdmin ? '' : 'none';
    if (col) col.style.display = display;
    if (th) th.style.display = display;
  }

  function renderChecksTable(checks) {
    var tbody = document.getElementById('sc-checks-tbody');
    if (!tbody) return;
    var counter = document.getElementById('sc-checks-counter');
    if (counter) counter.textContent = checks.length + ' item(ns) solicitado(s)';
    updateChecksActionCol();
    if (!checks.length) {
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = checks.map(function(item) {
      var checkedAt = item.checked_at ? new Date(item.checked_at).toLocaleString('pt-BR') : '-';
      var actionCell = isAdmin
        ? '<td class="table-td text-center"><button type="button" class="sc-edit-row-btn text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50" data-inv-action="edit" title="Editar verificação">Editar</button></td>'
        : '<td class="table-td text-center"></td>';
      return '<tr data-order-item-id="' + escapeHtml(item.order_item_id) + '">' +
        '<td class="table-td text-center">' + getStoreLabel(item) + '</td>' +
        '<td class="table-td text-center"><code class="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">' + escapeHtml(item.product_code) + '</code></td>' +
        '<td class="table-td text-center">' + escapeHtml(item.description || '-') + '</td>' +
        '<td class="table-td text-center">' + Number(item.requested_quantity).toFixed(2) + '</td>' +
        '<td class="table-td text-center"><span class="stock-badge stock-badge--' + (item.stock_status || 'pending_check') + '">' + escapeHtml(statusLabel(item.stock_status)) + '</span></td>' +
        '<td class="table-td text-center">' + (item.available_quantity != null ? Number(item.available_quantity).toFixed(2) : '-') + '</td>' +
        '<td class="table-td text-center text-xs text-slate-400">' + checkedAt + '</td>' +
        actionCell +
        '</tr>';
    }).join('');
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function showChecks(checks) {
    var section = document.getElementById('sc-checks-section');
    if (section) {
      section.classList.remove('hidden');
      renderChecksTable(checks);
    }
  }

  function populateStoreFilter() {
    var select = document.getElementById('sc-filtro-loja');
    if (!select) return;
    var stores = {};
    allChecks.concat(allReceipts).forEach(function(item) {
      if (item.store_id) {
        var label = item.lojas && item.lojas.nome ? item.lojas.nome : 'Loja #' + item.store_id;
        stores[item.store_id] = { id: item.store_id, label: label };
      }
    });
    var ids = Object.keys(stores).sort();
    var current = select.value;
    select.innerHTML = '<option value="">Todas as lojas</option>';
    ids.forEach(function(id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = stores[id].label;
      select.appendChild(opt);
    });
    if (current) {
      var stillExists = ids.some(function(id) { return id === current; });
      select.value = stillExists ? current : '';
    }
  }

  function filterItems() {
    var busca = ((document.getElementById('sc-busca') || {}).value || '').toLowerCase();
    var lojaFilter = ((document.getElementById('sc-filtro-loja') || {}).value || '');
    var checks = allChecks.slice();
    var receipts = allReceipts.slice();

    if (busca) {
      var filterFn = function(item) {
        var haystack = ((item.product_code || '') + ' ' + (item.description || '')).toLowerCase();
        return haystack.indexOf(busca) !== -1;
      };
      checks = checks.filter(filterFn);
      receipts = receipts.filter(filterFn);
    }
    if (lojaFilter) {
      checks = checks.filter(function(item) { return String(item.store_id) === lojaFilter; });
      receipts = receipts.filter(function(item) { return String(item.store_id) === lojaFilter; });
    }

    filteredChecks = checks;
    filteredReceipts = receipts;

    if (checks.length) {
      showChecks(checks);
    } else {
      var checksSection = document.getElementById('sc-checks-section');
      if (checksSection) checksSection.classList.add('hidden');
    }

    if (!receipts.length) { showEmpty(); return; }
    showReceived(receipts);
  }

  async function loadItems() {
    var token = ++loadToken;
    showLoading();
    try {
      if (!global.StockCheckDataModule || typeof global.StockCheckDataModule.loadReceivedStock !== 'function') {
        throw new Error('StockCheckDataModule não disponível.');
      }
      var sb = currentDeps && currentDeps.getSb ? currentDeps.getSb() : null;
      var getSb = function() { return sb; };
      var items = await global.StockCheckDataModule.loadOrderItemChecks({ getSb: getSb });
      if (token !== loadToken) return;
      allChecks = items;
      var receipts = await global.StockCheckDataModule.loadReceivedStock({ getSb: getSb });
      if (token !== loadToken) return;
      allReceipts = receipts;
      populateStoreFilter();
      filterItems();
    } catch (error) {
      if (token !== loadToken) return;
      showError(error.message || 'Erro ao carregar itens recebidos.');
    }
  }

  // ── Export helpers ──────────────────────────────────────────────

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

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getStoreName(item) {
    if (item.lojas && item.lojas.nome) return item.lojas.nome;
    return 'Loja #' + item.store_id;
  }

  function fmtDate(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString('pt-BR'); } catch (_) { return ''; }
  }

  function buildCsvRows() {
    var rows = [];
    filteredChecks.forEach(function(item) {
      rows.push([
        escapeCsv(getStoreName(item)),
        'Solicitado',
        escapeCsv(item.product_code),
        escapeCsv(item.description || ''),
        Number(item.requested_quantity).toFixed(2),
        escapeCsv(statusLabel(item.stock_status)),
        item.available_quantity != null ? Number(item.available_quantity).toFixed(2) : '',
        fmtDate(item.checked_at),
        '', '', '',
      ].join(';'));
    });
    filteredReceipts.forEach(function(item) {
      var invoiceNumber = item.order_receipts ? item.order_receipts.invoice_number : '';
      rows.push([
        escapeCsv(getStoreName(item)),
        'Recebido',
        escapeCsv(item.product_code),
        escapeCsv(item.description || ''),
        '', '', '', '',
        Number(item.received_quantity).toFixed(2),
        escapeCsv(item.unit || 'un'),
        escapeCsv(invoiceNumber),
        item.received_unit_value != null ? Number(item.received_unit_value).toFixed(2) : '',
        item.received_total_value != null ? Number(item.received_total_value).toFixed(2) : '',
        fmtDate(item.received_at),
      ].join(';'));
    });
    return rows;
  }

  function exportCsv() {
    if (!filteredChecks.length && !filteredReceipts.length) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Nenhum item para exportar.');
      return;
    }
    var header = 'Loja;Tipo;Produto / SKU;Descrição;Qtd. solicitada;Status;Disponível;Verificado em;Qtd. recebida;Unidade;NF;Valor unit.;Valor total;Recebido em';
    var rows = buildCsvRows();
    var csv = '\uFEFF' + header + '\n' + rows.join('\n');
    var label = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'estoque-' + label + '.csv');
    closeExportMenu();
    if (currentDeps && currentDeps.showToast) currentDeps.showToast((filteredChecks.length + filteredReceipts.length) + ' registro(s) exportado(s).');
  }

  function exportXlsx() {
    if (!filteredChecks.length && !filteredReceipts.length) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Nenhum item para exportar.');
      return;
    }
    var label = new Date().toISOString().slice(0, 10);
    var checksData = filteredChecks.map(function(item) {
      return {
        Loja: getStoreName(item),
        'Produto / SKU': item.product_code,
        Descricao: item.description || '',
        'Qtd. solicitada': Number(item.requested_quantity).toFixed(2),
        Status: statusLabel(item.stock_status),
        Disponivel: item.available_quantity != null ? Number(item.available_quantity).toFixed(2) : '',
        'Verificado em': fmtDate(item.checked_at),
      };
    });
    var receiptsData = filteredReceipts.map(function(item) {
      var invoiceNumber = item.order_receipts ? item.order_receipts.invoice_number : '';
      return {
        Loja: getStoreName(item),
        'Produto / SKU': item.product_code,
        Descricao: item.description || '',
        'Qtd. recebida': Number(item.received_quantity).toFixed(2),
        Unidade: item.unit || 'un',
        NF: invoiceNumber,
        'Valor unit.': item.received_unit_value != null ? Number(item.received_unit_value).toFixed(2) : '',
        'Valor total': item.received_total_value != null ? Number(item.received_total_value).toFixed(2) : '',
        'Recebido em': fmtDate(item.received_at),
      };
    });
    try {
      var wb = XLSX.utils.book_new();
      if (checksData.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checksData), 'Solicitados');
      }
      if (receiptsData.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(receiptsData), 'Recebidos');
      }
      XLSX.writeFile(wb, 'estoque-' + label + '.xlsx');
    } catch (error) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Erro ao gerar XLSX: ' + (error.message || ''));
    }
    closeExportMenu();
    if (currentDeps && currentDeps.showToast) currentDeps.showToast((filteredChecks.length + filteredReceipts.length) + ' registro(s) exportado(s).');
  }

  function toggleExportMenu() {
    exportMenuOpen = !exportMenuOpen;
    var menu = document.getElementById('sc-export-menu');
    if (!menu) return;
    menu.classList.toggle('hidden', !exportMenuOpen);
    menu.setAttribute('aria-hidden', exportMenuOpen ? 'false' : 'true');
    var btn = document.getElementById('sc-export-btn');
    if (btn) btn.setAttribute('aria-expanded', String(exportMenuOpen));
    if (!exportMenuOpen) {
      if (btn) btn.focus();
    }
  }

  function closeExportMenu() {
    if (!exportMenuOpen) return;
    exportMenuOpen = false;
    var menu = document.getElementById('sc-export-menu');
    if (menu) {
      menu.classList.add('hidden');
      menu.setAttribute('aria-hidden', 'true');
    }
    var btn = document.getElementById('sc-export-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // ── Edit modal ────────────────────────────────────────────────

  function openEditModal(orderItemId, item) {
    document.getElementById('sc-edit-order-item-id').value = orderItemId || '';
    document.getElementById('sc-edit-status').value = item.stock_status || 'pending_check';
    document.getElementById('sc-edit-qty').value = item.available_quantity != null ? item.available_quantity : '';
    var notes = item.notes || '';
    document.getElementById('sc-edit-notes').value = notes;
    updateNotesCounter();
    document.getElementById('sc-edit-modal').classList.remove('hidden');
  }

  function closeEditModal() {
    document.getElementById('sc-edit-modal').classList.add('hidden');
  }

  function updateNotesCounter() {
    var el = document.getElementById('sc-edit-notes-counter');
    var notes = document.getElementById('sc-edit-notes');
    if (el && notes) el.textContent = notes.value.length + '/500';
  }

  async function saveEdit() {
    var orderItemId = document.getElementById('sc-edit-order-item-id').value;
    if (!orderItemId) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Item de pedido não identificado.'); return; }

    var stockStatus = document.getElementById('sc-edit-status').value;
    var qtyRaw = document.getElementById('sc-edit-qty').value;
    var notes = document.getElementById('sc-edit-notes').value.trim();

    var availableQuantity = qtyRaw === '' ? null : Number(qtyRaw);
    if (availableQuantity !== null && (!Number.isFinite(availableQuantity) || availableQuantity < 0)) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Quantidade disponível inválida.');
      return;
    }
    if (notes.length > 500) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Observações excedem o limite de 500 caracteres.');
      return;
    }

    closeEditModal();

    try {
      if (!global.StockCheckDataModule || typeof global.StockCheckDataModule.updateStockCheck !== 'function') {
        throw new Error('StockCheckDataModule não disponível.');
      }
      var sb = currentDeps && currentDeps.getSb ? currentDeps.getSb() : null;
      var getSb = function() { return sb; };
      await global.StockCheckDataModule.updateStockCheck(orderItemId, { stockStatus: stockStatus, availableQuantity: availableQuantity, notes: notes }, { getSb: getSb });
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Verificação atualizada com sucesso.');
      await loadItems();
    } catch (error) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast(error.message || 'Erro ao salvar.');
    }
  }

  // ── Receipt edit modal ─────────────────────────────────────────

  function openReceiptEditModal(receiptId, item) {
    document.getElementById('sr-edit-receipt-id').value = receiptId || '';
    document.getElementById('sr-edit-sku').value = item.product_code || '';
    document.getElementById('sr-edit-desc').value = item.description || '';
    document.getElementById('sr-edit-qty').value = item.received_quantity != null ? item.received_quantity : '';
    document.getElementById('sr-edit-unit').value = item.unit || 'un';
    document.getElementById('sr-edit-unit-value').value = item.received_unit_value != null ? item.received_unit_value : '';
    document.getElementById('sc-receipt-edit-modal').classList.remove('hidden');
  }

  function closeReceiptEditModal() {
    document.getElementById('sc-receipt-edit-modal').classList.add('hidden');
  }

  async function saveReceiptEdit() {
    var receiptId = document.getElementById('sr-edit-receipt-id').value;
    if (!receiptId) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Recibo não identificado.'); return; }

    var productCode = document.getElementById('sr-edit-sku').value.trim();
    var description = document.getElementById('sr-edit-desc').value.trim();
    var qtyRaw = document.getElementById('sr-edit-qty').value;
    var unit = document.getElementById('sr-edit-unit').value.trim();

    if (!productCode) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Código do produto obrigatório.'); return; }
    if (!description) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Descrição obrigatória.'); return; }
    var qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Quantidade deve ser positiva.'); return; }
    if (!unit) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Unidade obrigatória.'); return; }
    var unitValueRaw = document.getElementById('sr-edit-unit-value').value;
    var unitValue = unitValueRaw !== '' ? Number(unitValueRaw) : null;
    if (unitValue !== null && (!Number.isFinite(unitValue) || unitValue < 0)) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Valor unitário inválido.'); return; }

    closeReceiptEditModal();

    try {
      if (!global.StockCheckDataModule || typeof global.StockCheckDataModule.updateReceivedStock !== 'function') {
        throw new Error('StockCheckDataModule não disponível.');
      }
      var sb = currentDeps && currentDeps.getSb ? currentDeps.getSb() : null;
      var getSb = function() { return sb; };
      await global.StockCheckDataModule.updateReceivedStock(receiptId, {
        productCode: productCode,
        description: description,
        receivedQuantity: qty,
        unit: unit,
        receivedUnitValue: unitValue,
      }, { getSb: getSb });
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Recibo atualizado com sucesso.');
      await loadItems();
    } catch (error) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast(error.message || 'Erro ao salvar.');
    }
  }

  // ── Void modal ─────────────────────────────────────────────────

  function openVoidModal(receiptId) {
    document.getElementById('sc-void-receipt-id').value = receiptId || '';
    document.getElementById('sc-void-reason').value = '';
    document.getElementById('sc-void-modal').classList.remove('hidden');
  }

  function closeVoidModal() {
    document.getElementById('sc-void-modal').classList.add('hidden');
  }

  async function confirmVoid() {
    var receiptId = document.getElementById('sc-void-receipt-id').value;
    if (!receiptId) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Recibo não identificado.'); return; }

    var reason = document.getElementById('sc-void-reason').value.trim();
    if (!reason) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Motivo da anulação obrigatório.'); return; }

    closeVoidModal();

    try {
      if (!global.StockCheckDataModule || typeof global.StockCheckDataModule.voidReceivedStock !== 'function') {
        throw new Error('StockCheckDataModule não disponível.');
      }
      var sb = currentDeps && currentDeps.getSb ? currentDeps.getSb() : null;
      var getSb = function() { return sb; };
      await global.StockCheckDataModule.voidReceivedStock(receiptId, reason, { getSb: getSb });
      if (currentDeps && currentDeps.showToast) currentDeps.showToast('Recebimento anulado com sucesso.');
      await loadItems();
    } catch (error) {
      if (currentDeps && currentDeps.showToast) currentDeps.showToast(error.message || 'Erro ao anular.');
    }
  }

  function bindEvents() {
    var buscaEl = document.getElementById('sc-busca');
    if (buscaEl && !buscaEl.dataset.scbound) {
      buscaEl.addEventListener('input', filterItems);
      buscaEl.dataset.scbound = 'true';
    }
    var lojaFilter = document.getElementById('sc-filtro-loja');
    if (lojaFilter && !lojaFilter.dataset.scbound) {
      lojaFilter.addEventListener('change', filterItems);
      lojaFilter.dataset.scbound = 'true';
    }
    var retryBtn = document.getElementById('sc-retry-btn');
    if (retryBtn && !retryBtn.dataset.scbound) {
      retryBtn.addEventListener('click', function() { loadItems(); });
      retryBtn.dataset.scbound = 'true';
    }
    var exportBtn = document.getElementById('sc-export-btn');
    if (exportBtn && !exportBtn.dataset.scbound) {
      exportBtn.addEventListener('click', function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        toggleExportMenu();
      });
      exportBtn.dataset.scbound = 'true';
    }
    var csvBtn = document.getElementById('sc-export-csv');
    if (csvBtn && !csvBtn.dataset.scbound) {
      csvBtn.addEventListener('click', function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        exportCsv();
      });
      csvBtn.dataset.scbound = 'true';
    }
    var xlsxBtn = document.getElementById('sc-export-xlsx');
    if (xlsxBtn && !xlsxBtn.dataset.scbound) {
      xlsxBtn.addEventListener('click', function(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        exportXlsx();
      });
      xlsxBtn.dataset.scbound = 'true';
    }
    document.addEventListener('click', function onDocClick(event) {
      if (!exportMenuOpen) return;
      var target = event.target;
      var btn = document.getElementById('sc-export-btn');
      var menu = document.getElementById('sc-export-menu');
      var isBtn = btn && (target === btn || btn.contains(target));
      var isMenu = menu && (target === menu || menu.contains(target));
      if (!isBtn && !isMenu) closeExportMenu();
    });

    // ── Edit modal: delegation for edit buttons on checks table ──
    var checksTbody = document.getElementById('sc-checks-tbody');
    if (checksTbody && !checksTbody.dataset.scbound) {
      checksTbody.addEventListener('click', function onChecksClick(event) {
        if (!isAdmin) return;
        var btn = event.target && event.target.closest('[data-inv-action="edit"]');
        if (!btn) return;
        var tr = btn.closest('tr');
        if (!tr) return;
        var orderItemId = tr.getAttribute('data-order-item-id');
        if (!orderItemId) return;
        var item = allChecks.find(function(c) { return c.order_item_id === orderItemId; });
        if (!item) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Item não encontrado.'); return; }
        openEditModal(orderItemId, item);
      });
      checksTbody.dataset.scbound = 'true';
    }

    // ── Edit modal controls ──────────────────────────────────────
    var modalClose = document.getElementById('sc-edit-modal-close');
    if (modalClose && !modalClose.dataset.scbound) {
      modalClose.addEventListener('click', closeEditModal);
      modalClose.dataset.scbound = 'true';
    }
    var modalCancel = document.getElementById('sc-edit-cancel');
    if (modalCancel && !modalCancel.dataset.scbound) {
      modalCancel.addEventListener('click', closeEditModal);
      modalCancel.dataset.scbound = 'true';
    }
    var modalSave = document.getElementById('sc-edit-save');
    if (modalSave && !modalSave.dataset.scbound) {
      modalSave.addEventListener('click', saveEdit);
      modalSave.dataset.scbound = 'true';
    }
    var modalOverlay = document.getElementById('sc-edit-modal');
    if (modalOverlay && !modalOverlay.dataset.scbound) {
      modalOverlay.addEventListener('click', function onOverlay(event) {
        if (event.target === modalOverlay) closeEditModal();
      });
      modalOverlay.dataset.scbound = 'true';
    }
    var notesField = document.getElementById('sc-edit-notes');
    if (notesField && !notesField.dataset.scbound) {
      notesField.addEventListener('input', updateNotesCounter);
      notesField.dataset.scbound = 'true';
    }

    // ── Received stock action delegation ────────────────────────
    var receivedTbody = document.getElementById('sc-received-tbody');
    if (receivedTbody && !receivedTbody.dataset.srbound) {
      receivedTbody.addEventListener('click', function onReceivedClick(event) {
        if (!isAdmin) return;
        var btn = event.target && event.target.closest('[data-sr-action]');
        if (!btn) return;
        var tr = btn.closest('tr');
        if (!tr) return;
        var receiptId = tr.getAttribute('data-receipt-id');
        if (!receiptId) return;
        var action = btn.getAttribute('data-sr-action');
        if (action === 'edit') {
          var item = allReceipts.find(function(r) { return r.id === receiptId; });
          if (!item) { if (currentDeps && currentDeps.showToast) currentDeps.showToast('Item não encontrado.'); return; }
          openReceiptEditModal(receiptId, item);
        } else if (action === 'void') {
          openVoidModal(receiptId);
        }
      });
      receivedTbody.dataset.srbound = 'true';
    }

    // ── Receipt edit modal controls ─────────────────────────────
    var srCloseBtns = document.querySelectorAll('.sr-edit-close');
    for (var si = 0; si < srCloseBtns.length; si++) {
      if (!srCloseBtns[si].dataset.srbound) {
        srCloseBtns[si].addEventListener('click', closeReceiptEditModal);
        srCloseBtns[si].dataset.srbound = 'true';
      }
    }
    var srSaveBtn = document.getElementById('sr-edit-save');
    if (srSaveBtn && !srSaveBtn.dataset.srbound) {
      srSaveBtn.addEventListener('click', saveReceiptEdit);
      srSaveBtn.dataset.srbound = 'true';
    }
    var srModal = document.getElementById('sc-receipt-edit-modal');
    if (srModal && !srModal.dataset.srbound) {
      srModal.addEventListener('click', function onSrOverlay(event) {
        if (event.target === srModal) closeReceiptEditModal();
      });
      srModal.dataset.srbound = 'true';
    }

    // ── Void modal controls ─────────────────────────────────────
    var voidClose = document.getElementById('sc-void-modal-close');
    if (voidClose && !voidClose.dataset.srbound) {
      voidClose.addEventListener('click', closeVoidModal);
      voidClose.dataset.srbound = 'true';
    }
    var voidCancel = document.getElementById('sc-void-cancel');
    if (voidCancel && !voidCancel.dataset.srbound) {
      voidCancel.addEventListener('click', closeVoidModal);
      voidCancel.dataset.srbound = 'true';
    }
    var voidConfirm = document.getElementById('sc-void-confirm');
    if (voidConfirm && !voidConfirm.dataset.srbound) {
      voidConfirm.addEventListener('click', confirmVoid);
      voidConfirm.dataset.srbound = 'true';
    }
    var voidModal = document.getElementById('sc-void-modal');
    if (voidModal && !voidModal.dataset.srbound) {
      voidModal.addEventListener('click', function onVoidOverlay(event) {
        if (event.target === voidModal) closeVoidModal();
      });
      voidModal.dataset.srbound = 'true';
    }

    // Global Escape key also handles new modals
    var origEscHandler = null;
    document.addEventListener('keydown', function onGlobalEsc(event) {
      if (event.key !== 'Escape') return;
      var modals = ['sc-receipt-edit-modal', 'sc-void-modal', 'sc-edit-modal'];
      for (var mi = 0; mi < modals.length; mi++) {
        var m = document.getElementById(modals[mi]);
        if (m && !m.classList.contains('hidden')) {
          if (modals[mi] === 'sc-receipt-edit-modal') closeReceiptEditModal();
          else if (modals[mi] === 'sc-void-modal') closeVoidModal();
          else closeEditModal();
          return;
        }
      }
    });
  }

  async function afterRenderEstoque(deps) {
    currentDeps = deps || currentDeps;
    var currentUser = deps && deps.getCurrentUser ? deps.getCurrentUser() : null;
    isAdmin = currentUser && currentUser.papel === 'admin';
    bindEvents();
    loadToken++;
    await loadItems();
  }

  function getState() {
    return { checks: allChecks.slice(), receipts: allReceipts.slice(), filteredChecks: filteredChecks.slice(), filteredReceipts: filteredReceipts.slice() };
  }

  global.StockCheckModule = {
    afterRenderEstoque: afterRenderEstoque,
    filterItems: filterItems,
    getState: getState,
    populateStoreFilter: populateStoreFilter,
    getStoreLabel: getStoreLabel,
    exportCsv: exportCsv,
    exportXlsx: exportXlsx,
    escapeCsv: escapeCsv,
    getStoreName: getStoreName,
    openEditModal: openEditModal,
    closeEditModal: closeEditModal,
    saveEdit: saveEdit,
    renderChecksTable: renderChecksTable,
    openReceiptEditModal: openReceiptEditModal,
    closeReceiptEditModal: closeReceiptEditModal,
    saveReceiptEdit: saveReceiptEdit,
    openVoidModal: openVoidModal,
    closeVoidModal: closeVoidModal,
    confirmVoid: confirmVoid,
    renderReceivedTable: renderReceivedTable,
  };
})(window);
