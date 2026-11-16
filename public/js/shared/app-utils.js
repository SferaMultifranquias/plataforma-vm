(function initAppUtils(global) {
  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeSearchText(value) {
    return normalizeText(value).toLowerCase();
  }

  function mapOrderItem(item) {
    return {
      id: item.id,
      sku_digitado: item.product_code || item.description || '-',
      quantidade: Number(item.quantity || 1),
      valor_unit: null,
      placed_unit_value: item.placed_unit_value || null,
      placed_total_value: item.placed_total_value || null,
      produtos: {
        nome: item.description || item.product_code || '-',
      },
    };
  }

  function mapHistoryIcon(status) {
    var value = String(status || '').toUpperCase();
    if (value === 'ORDER_PLACED') return 'package-check';
    if (value === 'RECEIVED') return 'badge-check';
    if (value === 'APPROVED') return 'check-circle';
    if (value === 'REJECTED') return 'x-circle';
    if (value === 'PENDING_APPROVAL') return 'send';
    if (value === 'CANCELLED') return 'ban';
    return 'clock';
  }

  function mapOrderRecord(order, deps) {
    var items = (order.order_items || []).map(mapOrderItem);
    var images = (order.order_images || []).map(function mapImage(image) {
      return {
        bucket_name: image.bucket_name || 'order-images',
        created_at: image.created_at || null,
        file_hash: image.file_hash || '',
        file_size: image.file_size || null,
        id: image.id,
        loadError: image.loadError || null,
        mime_type: image.mime_type || '',
        order_id: image.order_id || order.id,
        order_item_id: image.order_item_id || null,
        original_filename: image.original_filename || '',
        signedUrl: image.signedUrl || null,
        storage_path: image.storage_path || '',
        uploaded_by_id: image.uploaded_by_id || null,
      };
    });
    var history = (order.status_history || []).map(function mapEntry(entry) {
      return {
        acao: entry.comment || ("Status alterado para " + entry.new_status),
        usuario: 'Sistema',
        criado_em: entry.created_at,
        icone: mapHistoryIcon(entry.new_status),
      };
    });

    return {
      id: order.id,
      protocolo: order.internal_number,
      status: order.status,
      observacoes: order.notes || order.justification || '',
      numero_antilhas: order.delivery_protocol || null,
      valor_total: null,
      previsao_entrega: order.delivery_date || null,
      delivery_date: order.delivery_date || null,
      delivery_protocol: order.delivery_protocol || null,
      purpose: order.purpose || '',
      priority: order.priority || 'NORMAL',
      notes: order.notes || '',
      brand: order.brand || '',
      cost_center: order.cost_center || '',
      criado_em: order.created_at,
      atualizado_em: order.updated_at,
      placed_at: order.placed_at || null,
      placed_by_id: order.placed_by_id || null,
      requester_id: order.requester_id || null,
      received_at: order.received_at || null,
      received_by_id: order.received_by_id || null,
      store_id: order.store_id || null,
      lojas: {
        id: order.store_id || null,
        nome: order.store || '-',
        marca: order.brand || '',
        codigo: '',
      },
      images: images,
      foto_url: images[0]?.signedUrl || null,
      pedido_itens: items,
      pedido_historico: history,
    };
  }

  function mapRole(role) {
    var normalized = String(role || 'USER').toUpperCase();
    if (normalized === 'ADMIN') return 'admin';
    return 'loja';
  }

  function getUserRole(user) {
    return String(user?.role || user?.papel || '').toUpperCase();
  }

  function formatHistoricalActorName(profile) {
    if (!profile) return 'Usuário não encontrado';
    if (profile.removed_at) return (profile.name || 'Usuário') + ' — usuário removido';
    return profile.name || 'Usuário';
  }

  function isActiveUser(user) {
    return Boolean(user) && user.ativo !== false && user.is_active !== false;
  }

  function isAdminUser(user) {
    return getUserRole(user) === 'ADMIN';
  }

  function isOrderOwner(user, order) {
    if (!user || !order) return false;
    return String(user.id || '') === String(order.requester_id || order.user_id || '');
  }

  function isEditableOrderStatus(status) {
    var value = String(status || '').toUpperCase();
    return value === 'DRAFT' || value === 'CHANGES_REQUESTED';
  }

  function isOrderPlacedStatus(status) {
    return String(status || '').toUpperCase() === 'ORDER_PLACED';
  }

  function isReceivedStatus(status) {
    return String(status || '').toUpperCase() === 'RECEIVED';
  }

  function canViewOrder(user, order) {
    return isActiveUser(user) && Boolean(order);
  }

  function canEditOrder(user, order) {
    return isActiveUser(user) && isOrderOwner(user, order) && isEditableOrderStatus(order && order.status);
  }

  function canFillPlacedValues(user, order, itens) {
    if (!isActiveUser(user) || !isAdminUser(user) || !order || !order.id) return false;
    if (!isOrderPlacedStatus(order && order.status)) return false;
    var items = Array.isArray(itens) ? itens : [];
    return items.some(function(item) { return item.placed_unit_value == null; });
  }

  function canDeleteOrder(user, order) {
    return isActiveUser(user) && isAdminUser(user) && Boolean(order && order.id);
  }

  function canMarkOrderPlaced(user, order) {
    return isActiveUser(user)
      && isAdminUser(user)
      && String(order && order.status || '').toUpperCase() === 'APPROVED'
      && Boolean(order && order.id);
  }

  function canConfirmReceipt(user, order) {
    return isActiveUser(user)
      && isOrderOwner(user, order)
      && isOrderPlacedStatus(order && order.status)
      && Boolean(order && order.delivery_protocol)
      && Boolean(order && order.delivery_date);
  }

  function canApproveOrder(user, order) {
    return isActiveUser(user) && isAdminUser(user) && String(order && order.status || '').toUpperCase() === 'PENDING_APPROVAL';
  }

  function canRejectOrder(user, order) {
    return canApproveOrder(user, order);
  }

  function canRequestChangesOrder(user, order) {
    return canApproveOrder(user, order);
  }

  function canViewOrderImage(user, order) {
    return canViewOrder(user, order);
  }

  var STATUS_MAP = {
    DRAFT: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-700' },
    PENDING_APPROVAL: { label: 'Aguardando aprovação', cls: 'bg-amber-100 text-amber-700' },
    APPROVED: { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-700' },
    ORDER_PLACED: { label: 'Pedido realizado', cls: 'bg-sky-100 text-sky-700' },
    REJECTED: { label: 'Rejeitado', cls: 'bg-red-100 text-red-700' },
    RECEIVED: { label: 'Recebido', cls: 'bg-emerald-100 text-emerald-700' },
    CHANGES_REQUESTED: { label: 'Alterações solicitadas', cls: 'bg-violet-100 text-violet-700' },
    CANCELLED: { label: 'Cancelado', cls: 'bg-slate-200 text-slate-600' },
    processando: { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-700' },
    validacao_reprovada: { label: 'Rejeitado', cls: 'bg-red-100 text-red-700' },
    entregue: { label: 'Entregue', cls: 'bg-emerald-100 text-emerald-700' },
    em_transito: { label: 'Em transito', cls: 'bg-blue-100 text-blue-700' },
    validacao: { label: 'Validacao', cls: 'bg-amber-100 text-amber-700' },
    aguardando_nf: { label: 'Aguardando NF', cls: 'bg-orange-100 text-orange-700' },
  };

  function getStatusMeta(status) {
    return STATUS_MAP[status] || { label: 'Status desconhecido', cls: 'bg-slate-100 text-slate-600' };
  }

  function statusBadge(status) {
    var meta = getStatusMeta(status);
    return '<span class="status-badge ' + meta.cls + '">' + meta.label + '</span>';
  }

  function matchesOrderFilter(order, filters) {
    var data = order || {};
    var currentFilters = filters || {};
    var search = normalizeSearchText(currentFilters.search);

    if (currentFilters.status && String(data.status || '') !== String(currentFilters.status)) {
      return false;
    }

    if (currentFilters.storeId && String(data.store_id || '') !== String(currentFilters.storeId)) {
      return false;
    }

    if (currentFilters.requesterId && String(data.requester_id || '') !== String(currentFilters.requesterId)) {
      return false;
    }

    if (!search) return true;

    var haystack = [
      data.internal_number,
      data.requester_name,
      data.requester_email,
      data.store,
      data.brand,
    ].map(normalizeSearchText).join(' ');

    return haystack.includes(search);
  }

  function filterOrdersList(orders, filters) {
    return (Array.isArray(orders) ? orders : []).filter(function matchOrder(order) {
      return matchesOrderFilter(order, filters);
    });
  }

  function getPaginationMeta(page, total, pageSize) {
    var safePageSize = Number(pageSize) > 0 ? Number(pageSize) : 20;
    var safeTotal = Number(total) > 0 ? Number(total) : 0;
    var totalPages = safeTotal > 0 ? Math.ceil(safeTotal / safePageSize) : 1;
    var safePage = Number(page) > 0 ? Number(page) : 1;
    if (safePage > totalPages) safePage = totalPages;

    return {
      currentPage: safePage,
      hasNext: safePage < totalPages,
      hasPrevious: safePage > 1,
      pageSize: safePageSize,
      total: safeTotal,
      totalPages: totalPages,
    };
  }

  var ADMIN_ONLY_RESOURCES = ['usuarios', 'controle-acesso', 'lojas-cadastro', 'suprimentos-admin'];
  // Recursos liberados para usuários de lojas que não usam o VM (Levi's, Hering, Venda Direta).
  var SUPPLIES_ONLY_RESOURCES = ['suprimentos'];

  function buildPermissions(role, resources, options) {
    var permissions = {};
    var suppliesOnly = role !== 'admin' && Boolean(options) && options.usaVm === false;
    resources.forEach(function assignPermission(resource) {
      if (role === 'admin') {
        permissions[resource.key] = true;
      } else if (suppliesOnly) {
        permissions[resource.key] = SUPPLIES_ONLY_RESOURCES.includes(resource.key);
      } else {
        permissions[resource.key] = !ADMIN_ONLY_RESOURCES.includes(resource.key);
      }
    });
    return permissions;
  }

  function canAccessResource(currentUser, permissions, resource) {
    if (!currentUser) return false;
    if (currentUser.papel === 'admin') return true;
    return permissions[resource] === true;
  }

  function statCard(title, value, sub, icon, color, id) {
    var colors = {
      blue: 'bg-blue-50 text-blue-600',
      violet: 'bg-violet-50 text-violet-600',
      emerald: 'bg-emerald-50 text-emerald-600',
      amber: 'bg-amber-50 text-amber-600',
    };
    var elementId = id ? ('id="' + id + '"') : '';
    return (
      '<div class="stat-card" ' + elementId + '>' +
        '<div class="flex items-start justify-between mb-3">' +
          '<div class="text-sm font-medium text-slate-500">' + title + '</div>' +
          '<div class="w-9 h-9 rounded-lg ' + colors[color] + ' flex items-center justify-center">' +
            '<i data-lucide="' + icon + '" class="w-4 h-4"></i>' +
          '</div>' +
        '</div>' +
        '<div class="stat-val text-2xl font-bold text-slate-900">' + value + '</div>' +
        '<div class="stat-sub text-xs text-slate-400 mt-1">' + sub + '</div>' +
      '</div>'
    );
  }

  function waveCard(title, subtitle, phases, progress, color) {
    var colors = { blue: 'bg-blue-600', emerald: 'bg-emerald-500', amber: 'bg-amber-500' };
    var text = { blue: 'text-blue-700', emerald: 'text-emerald-700', amber: 'text-amber-700' };
    var phasesHtml = phases.map(function mapPhase(phase, index) {
      return (
        '<div class="mb-3">' +
          '<div class="flex justify-between items-center mb-1">' +
            '<span class="text-xs text-slate-600">' + phase + '</span>' +
            '<span class="text-xs font-medium ' + text[color] + '">' + progress[index] + '%</span>' +
          '</div>' +
          '<div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">' +
            '<div class="' + colors[color] + ' h-full rounded-full bar" style="width:' + progress[index] + '%"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">' +
        '<div class="text-sm font-semibold text-slate-900">' + title + '</div>' +
        '<div class="text-xs text-slate-400 mb-4">' + subtitle + '</div>' +
        phasesHtml +
      '</div>'
    );
  }

  function getDrawerStatusBarBg(statusClass) {
    if (statusClass.includes('emerald')) return 'bg-emerald-50';
    if (statusClass.includes('sky')) return 'bg-sky-50';
    if (statusClass.includes('blue')) return 'bg-blue-50';
    if (statusClass.includes('amber')) return 'bg-amber-50';
    if (statusClass.includes('orange')) return 'bg-orange-50';
    if (statusClass.includes('violet')) return 'bg-violet-50';
    return 'bg-slate-50';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDrawerStatusBar(order) {
    var statusMeta = getStatusMeta(order.status);
    var barBg = getDrawerStatusBarBg(statusMeta.cls);
    return {
      className: 'rounded-xl p-4 flex items-center gap-3 ' + barBg,
      html:
        '<span class="status-badge ' + statusMeta.cls + ' text-sm px-3 py-1">' + statusMeta.label + '</span>' +
        '<span class="text-sm text-slate-600">Pedido realizado em <strong>' + escapeHtml(order.data) + '</strong></span>',
    };
  }

  function renderDrawerItems(items) {
    if (!items.length) {
      return '<div class="text-slate-400 text-sm">Sem itens cadastrados.</div>';
    }

    return items.map(function mapItem(item) {
      var sku = escapeHtml(item.sku_digitado || '-');
      var nome = escapeHtml((item.produtos && item.produtos.nome) || item.sku_digitado || '-');
      var quantidade = escapeHtml(item.quantidade || 1);
      var valor = item.valor_unit ? ('R$ ' + Number(item.valor_unit).toFixed(2)) : '-';
      return (
        '<div class="flex items-center gap-3 bg-slate-50 rounded-lg p-3 border border-slate-200">' +
          '<span class="font-mono text-xs bg-white border border-slate-200 px-2 py-1 rounded text-slate-700">' + sku + '</span>' +
          '<div class="flex-1">' +
            '<div class="text-sm font-medium text-slate-900">' + nome + '</div>' +
            '<div class="text-xs text-slate-400">Quantidade: ' + quantidade + ' unidade(s)</div>' +
          '</div>' +
          '<span class="text-sm font-semibold text-slate-700">' + valor + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderDrawerHistory(history) {
    if (!history.length) {
      return '<div class="text-slate-400 text-sm">Sem historico disponivel.</div>';
    }

    return history.map(function mapHistoryEntry(entry, index) {
      var isLast = index === history.length - 1;
      var badgeBg = isLast ? 'bg-blue-600' : 'bg-slate-200';
      var iconColor = isLast ? 'text-white' : 'text-slate-500';
      var connector = index < history.length - 1 ? '<div class="w-px h-4 bg-slate-200 mt-1"></div>' : '';
      return (
        '<div class="flex gap-3 items-start">' +
          '<div class="flex flex-col items-center">' +
            '<div class="w-6 h-6 rounded-full ' + badgeBg + ' flex items-center justify-center shrink-0">' +
              '<i data-lucide="' + entry.icone + '" class="w-3 h-3 ' + iconColor + '"></i>' +
            '</div>' +
            connector +
          '</div>' +
          '<div class="pb-1">' +
            '<div class="text-xs text-slate-700 font-medium">' + escapeHtml(entry.acao) + '</div>' +
            '<div class="text-xs text-slate-400">' + escapeHtml(entry.data) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  global.AppUtils = {
    buildPermissions: buildPermissions,
    canAccessResource: canAccessResource,
    canApproveOrder: canApproveOrder,
    canDeleteOrder: canDeleteOrder,
    canConfirmReceipt: canConfirmReceipt,
    canEditOrder: canEditOrder,
    canFillPlacedValues: canFillPlacedValues,
    canMarkOrderPlaced: canMarkOrderPlaced,
    canRejectOrder: canRejectOrder,
    canRequestChangesOrder: canRequestChangesOrder,
    canViewOrder: canViewOrder,
    canViewOrderImage: canViewOrderImage,
    escapeHtml: escapeHtml,
    filterOrdersList: filterOrdersList,
    formatHistoricalActorName: formatHistoricalActorName,
    getStatusMeta: getStatusMeta,
    getPaginationMeta: getPaginationMeta,
    getDrawerStatusBarBg: getDrawerStatusBarBg,
    mapHistoryIcon: mapHistoryIcon,
    mapOrderItem: mapOrderItem,
    mapOrderRecord: mapOrderRecord,
    mapRole: mapRole,
    matchesOrderFilter: matchesOrderFilter,
    isActiveUser: isActiveUser,
    isAdminUser: isAdminUser,
    isEditableOrderStatus: isEditableOrderStatus,
    isOrderOwner: isOrderOwner,
    isOrderPlacedStatus: isOrderPlacedStatus,
    isReceivedStatus: isReceivedStatus,
    renderDrawerHistory: renderDrawerHistory,
    renderDrawerItems: renderDrawerItems,
    renderDrawerStatusBar: renderDrawerStatusBar,
    statCard: statCard,
    statusBadge: statusBadge,
    waveCard: waveCard,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.AppUtils;
  }
})(typeof window !== 'undefined' ? window : globalThis);
