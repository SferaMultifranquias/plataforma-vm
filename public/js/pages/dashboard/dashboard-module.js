(function initDashboardModule(global) {
  var _dashOrders = [];
  var _dashReceipts = [];
  var _dashChecks = [];
  var _dashDeps = null;

  function escapeHtml(value) {
    return global.AppUtils ? global.AppUtils.escapeHtml(value) : String(value ?? '');
  }

  function getStoreLabel(item) {
    if (item.lojas && item.lojas.nome) return escapeHtml(item.lojas.nome);
    return 'Loja #' + item.store_id;
  }

  function formatDate(value) {
    if (!value) return '\u2014';
    try {
      var d = new Date(value);
      if (isNaN(d.getTime())) return '\u2014';
      return d.toLocaleString('pt-BR');
    } catch (_) { return '\u2014'; }
  }

  function formatNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '0,00';
  }

  function formatCurrency(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 'R$ 0,00';
    var parts = n.toFixed(2).split('.');
    var intPart = parts[0];
    var out = '';
    for (var i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 === 0) out += '.';
      out += intPart[i];
    }
    return 'R$ ' + out + ',' + parts[1];
  }

  function calcStockKpi(checks, receipts) {
    var storeIds = {};
    var skus = {};
    var requestedQty = 0;
    var receivedQty = 0;
    var lastReceiptDate = null;

    checks.forEach(function(c) {
      if (c.store_id != null) storeIds[String(c.store_id)] = true;
      if (c.product_code) skus[c.product_code.toUpperCase().trim()] = true;
      requestedQty += Number(c.requested_quantity || 0);
    });

    receipts.forEach(function(r) {
      if (r.store_id != null) storeIds[String(r.store_id)] = true;
      if (r.product_code) skus[r.product_code.toUpperCase().trim()] = true;
      receivedQty += Number(r.received_quantity || 0);
      if (r.received_at && (!lastReceiptDate || r.received_at > lastReceiptDate)) {
        lastReceiptDate = r.received_at;
      }
    });

    return {
      totalStores: Object.keys(storeIds).length,
      totalSkus: Object.keys(skus).length,
      requestedQty: requestedQty,
      receivedQty: receivedQty,
      lastReceiptDate: lastReceiptDate,
    };
  }

  function isDeletedOrder(order) {
    if (!order) return true;
    if (order.deleted_at) return true;
    if (order.is_deleted === true || order.deleted === true) return true;
    if (order.status === 'DELETED' || order.status === 'EXCLUIDO' || order.status === 'EXCLUÍDO') return true;
    return false;
  }

  function calcOrderKpi(orders) {
    var statusCounts = {};
    var pendingCount = 0;
    var active = (orders || []).filter(function(o) { return !isDeletedOrder(o); });

    active.forEach(function(o) {
      var s = o.status || 'UNKNOWN';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      if (s === 'PENDING_APPROVAL') pendingCount++;
    });

    return {
      totalOrders: active.length,
      pendingCount: pendingCount,
      statusCounts: statusCounts,
    };
  }

  function calcReceiptValueKpi(receipts) {
    var totalValue = 0;
    var count = 0;
    receipts.forEach(function(r) {
      var v = Number(r.received_total_value || 0);
      if (v > 0) count++;
      totalValue += v;
    });
    return { totalValue: totalValue, receiptWithValueCount: count };
  }

  function groupReceiptsByStore(receipts) {
    var groups = {};
    receipts.forEach(function(r) {
      var key = String(r.store_id);
      if (!groups[key]) groups[key] = { storeLabel: getStoreLabel(r), qty: 0, count: 0 };
      groups[key].qty += Number(r.received_quantity || 0);
      groups[key].count++;
    });
    return Object.keys(groups).map(function(k) { return groups[k]; })
      .sort(function(a, b) { return b.qty - a.qty; })
      .slice(0, 5);
  }

  function groupReceiptValueByStore(receipts) {
    var groups = {};
    receipts.forEach(function(r) {
      var v = Number(r.received_total_value || 0);
      if (v <= 0) return;
      var key = String(r.store_id);
      if (!groups[key]) groups[key] = { storeLabel: getStoreLabel(r), totalValue: 0 };
      groups[key].totalValue += v;
    });
    return Object.keys(groups).map(function(k) { return groups[k]; })
      .sort(function(a, b) { return b.totalValue - a.totalValue; })
      .slice(0, 5);
  }

  function groupReceiptValueByDay(receipts) {
    var dayMap = {};
    receipts.forEach(function(r) {
      if (r.received_total_value == null || !r.received_at) return;
      var d = r.received_at.slice(0, 10);
      var v = Number(r.received_total_value || 0);
      dayMap[d] = (dayMap[d] || 0) + v;
    });
    return Object.keys(dayMap).sort().map(function(d) {
      return { date: d, totalValue: dayMap[d] };
    });
  }

  var CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
  var STATUS_COLORS = {
    APPROVED: '#16a34a',
    CANCELLED: '#0f172a',
    CHANGES_REQUESTED: '#db2777',
    DRAFT: '#64748b',
    PENDING_APPROVAL: '#f59e0b',
    RECEIVED: '#2563eb',
    REJECTED: '#e11d48',
  };

  var KPI_COLORS = {
    blue: 'bg-blue-50 text-blue-600',
    violet: 'bg-violet-50 text-violet-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };

  function renderKpiCard(title, value, sub, icon, color, id) {
    var elementId = id ? ('id="' + id + '"') : '';
    return '<div class="dashboard-kpi-card" ' + elementId + '>' +
      '<div class="dashboard-kpi-icon ' + (KPI_COLORS[color] || 'bg-blue-50 text-blue-600') + '">' +
        '<i data-lucide="' + icon + '" class="w-4 h-4"></i>' +
      '</div>' +
      '<div class="dashboard-kpi-body">' +
        '<div class="dashboard-kpi-label">' + title + '</div>' +
        '<div class="stat-val dashboard-kpi-value">' + value + '</div>' +
        '<div class="stat-sub dashboard-kpi-sub">' + sub + '</div>' +
      '</div>' +
    '</div>';
  }

  var STATUS_LABELS = {
    DRAFT: 'Rascunho',
    PENDING_APPROVAL: 'Pendente',
    APPROVED: 'Aprovado',
    ORDER_PLACED: 'Pedido realizado',
    REJECTED: 'Rejeitado',
    RECEIVED: 'Recebido',
    CHANGES_REQUESTED: 'Alterações solicitadas',
    CANCELLED: 'Cancelado',
  };

  function _statusLabel(key) {
    return STATUS_LABELS[key] || key;
  }

  function getStatusColor(status, fallbackIndex) {
    var key = String(status || 'UNKNOWN').toUpperCase();
    return STATUS_COLORS[key] || CHART_COLORS[fallbackIndex % CHART_COLORS.length] || '#94a3b8';
  }

  function renderStatusBarChart(statusCounts) {
    var keys = Object.keys(statusCounts);
    if (!keys.length) return '<div class="dashboard-state"><i data-lucide="pie-chart" class="w-6 h-6 text-slate-300"></i><span>Sem dados de pedidos</span></div>';
    var total = keys.reduce(function(s, k) { return s + statusCounts[k]; }, 0);
    if (!total) return '<div class="dashboard-state"><i data-lucide="pie-chart" class="w-6 h-6 text-slate-300"></i><span>Total zero</span></div>';
    var cumulative = 0;
    var segments = keys.map(function(k, i) {
      var startAngle = (cumulative / total) * 360;
      cumulative += statusCounts[k];
      var endAngle = (cumulative / total) * 360;
      var largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
      var startRad = (startAngle - 90) * Math.PI / 180;
      var endRad = (endAngle - 90) * Math.PI / 180;
      var x1 = 50 + 40 * Math.cos(startRad);
      var y1 = 50 + 40 * Math.sin(startRad);
      var x2 = 50 + 40 * Math.cos(endRad);
      var y2 = 50 + 40 * Math.sin(endRad);
      return '<path d="M50,50 L' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A40,40 0 ' + largeArc + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="' + getStatusColor(k, i) + '"><title>' + escapeHtml(_statusLabel(k)) + ': ' + statusCounts[k] + '</title></path>';
    }).join('');
    var legend = keys.map(function(k, i) {
      var pct = ((statusCounts[k] / total) * 100).toFixed(1);
      return '<div class="flex items-center gap-2 text-xs"><span style="width:10px;height:10px;border-radius:2px;background:' + getStatusColor(k, i) + ';display:inline-block"></span>' + escapeHtml(_statusLabel(k)) + ' (' + pct + '%)</div>';
    }).join('');
    return '<div class="dashboard-donut flex items-center p-3 gap-4"><svg width="200" height="200" viewBox="0 0 100 100">' + segments + '<circle cx="50" cy="50" r="25" fill="white"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700">' + total.toFixed(0) + '</text></svg><div class="flex flex-col gap-1">' + legend + '</div></div>';
  }

  function renderReceiptDonutChart(groups) {
    if (!groups.length) return '<div class="dashboard-state"><i data-lucide="pie-chart" class="w-6 h-6 text-slate-300"></i><span>Sem recebimentos</span></div>';
    var total = groups.reduce(function(s, g) { return s + g.qty; }, 0);
    if (!total) return '<div class="dashboard-state"><i data-lucide="pie-chart" class="w-6 h-6 text-slate-300"></i><span>Total zero de recebimentos</span></div>';
    var cumulative = 0;
    var segments = groups.map(function(g, i) {
      var startAngle = (cumulative / total) * 360;
      cumulative += g.qty;
      var endAngle = (cumulative / total) * 360;
      var largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
      var startRad = (startAngle - 90) * Math.PI / 180;
      var endRad = (endAngle - 90) * Math.PI / 180;
      var x1 = 50 + 40 * Math.cos(startRad);
      var y1 = 50 + 40 * Math.sin(startRad);
      var x2 = 50 + 40 * Math.cos(endRad);
      var y2 = 50 + 40 * Math.sin(endRad);
      return '<path d="M50,50 L' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A40,40 0 ' + largeArc + ',1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + ' Z" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '"/>';
    }).join('');
    var legend = groups.map(function(g, i) {
      var pct = total > 0 ? ((g.qty / total) * 100).toFixed(1) : 0;
      return '<div class="flex items-center gap-2 text-xs"><span style="width:10px;height:10px;border-radius:2px;background:' + CHART_COLORS[i % CHART_COLORS.length] + ';display:inline-block"></span>' + g.storeLabel + ' (' + pct + '%)</div>';
    }).join('');
    return '<div class="dashboard-donut flex items-center p-3 gap-4"><svg width="200" height="200" viewBox="0 0 100 100">' + segments + '<circle cx="50" cy="50" r="25" fill="white"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700">' + total.toFixed(0) + '</text></svg><div class="flex flex-col gap-1">' + legend + '</div></div>';
  }

  function renderReceiptTrendChart(receipts) {
    if (!receipts.length) return '<div class="dashboard-state"><i data-lucide="trending-up" class="w-6 h-6 text-slate-300"></i><span>Sem recebimentos recentes</span></div>';
    var monthMap = {};
    receipts.forEach(function(r) {
      if (!r.received_at) return;
      var m = r.received_at.slice(0, 7);
      monthMap[m] = (monthMap[m] || 0) + Number(r.received_quantity || 0);
    });
    var months = Object.keys(monthMap).sort();
    if (!months.length) return '<div class="dashboard-state"><i data-lucide="trending-up" class="w-6 h-6 text-slate-300"></i><span>Sem recebimentos com data</span></div>';
    var values = months.map(function(m) { return monthMap[m]; });
    var maxVal = Math.max.apply(null, values.concat([1]));
    var n = months.length;
    var w = 420, h = 160, pad = 8;
    var plotW = w - pad * 2, plotH = h - pad * 2;
    var points = months.map(function(m, i) {
      var x = pad + (i / (n - 1 || 1)) * plotW;
      var y = pad + plotH - (monthMap[m] / maxVal) * plotH;
      return { x: x.toFixed(1), y: y.toFixed(1) };
    });
    var line = points.map(function(p) { return p.x + ',' + p.y; }).join(' ');
    var dots = points.map(function(p) {
      return '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="' + CHART_COLORS[0] + '" stroke="#fff" stroke-width="2"/>';
    }).join('');
    var area = points.map(function(p, i) {
      return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y;
    }).join(' ') + ' L' + (pad + plotW) + ',' + (pad + plotH) + ' L' + pad + ',' + (pad + plotH) + ' Z';
    var labels = months.map(function(m, i) {
      var x = pad + (i / (n - 1 || 1)) * plotW;
      return '<text x="' + x.toFixed(1) + '" y="' + (h + 18) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '" font-size="11" fill="#94a3b8">' + m.slice(5) + '</text>';
    }).join('');
    return '<div class="p-3" style="overflow:hidden">' +
      '<svg width="100%" height="200" viewBox="0 0 ' + w + ' ' + (h + 24) + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + area + '" fill="' + CHART_COLORS[0] + '" opacity="0.08"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + CHART_COLORS[0] + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels +
      '</svg></div>';
  }

  function renderValueBarChart(groups) {
    if (!groups.length) return '<div class="dashboard-state"><i data-lucide="bar-chart-3" class="w-6 h-6 text-slate-300"></i><span>Sem dados de valor por loja</span></div>';
    var maxVal = Math.max.apply(null, groups.map(function(g) { return g.totalValue; }).concat([1]));
    var bars = groups.map(function(g) {
      var pct = (g.totalValue / maxVal) * 100;
      var color = CHART_COLORS[groups.indexOf(g) % CHART_COLORS.length];
      return '<div class="flex items-center gap-2 text-sm mb-2">' +
        '<span class="text-slate-700 w-24 truncate text-xs font-medium" title="' + escapeHtml(g.storeLabel) + '">' + escapeHtml(g.storeLabel) + '</span>' +
        '<div class="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">' +
          '<div class="h-full rounded-full" style="width:' + pct.toFixed(1) + '%;background:' + color + '"></div>' +
        '</div>' +
        '<span class="text-slate-600 text-xs font-mono w-20 text-right">' + formatCurrency(g.totalValue) + '</span>' +
      '</div>';
    }).join('');
    return '<div class="p-3">' + bars + '</div>';
  }

  function renderValueLineChart(days) {
    if (!days.length) return '<div class="dashboard-state"><i data-lucide="trending-up" class="w-6 h-6 text-slate-300"></i><span>Sem dados de valor por dia</span></div>';
    var values = days.map(function(d) { return d.totalValue; });
    var maxVal = Math.max.apply(null, values.concat([1]));
    var n = days.length;
    var w = 420, h = 160, pad = 8;
    var plotW = w - pad * 2, plotH = h - pad * 2;
    var points = days.map(function(d, i) {
      var x = pad + (i / (n - 1 || 1)) * plotW;
      var y = pad + plotH - (d.totalValue / maxVal) * plotH;
      return { x: x.toFixed(1), y: y.toFixed(1) };
    });
    var line = points.map(function(p) { return p.x + ',' + p.y; }).join(' ');
    var dots = points.map(function(p) {
      return '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="' + CHART_COLORS[0] + '" stroke="#fff" stroke-width="2"/>';
    }).join('');
    var area = points.map(function(p, i) {
      return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y;
    }).join(' ') + ' L' + (pad + plotW) + ',' + (pad + plotH) + ' L' + pad + ',' + (pad + plotH) + ' Z';
    var labels = days.map(function(d, i) {
      var x = pad + (i / (n - 1 || 1)) * plotW;
      return '<text x="' + x.toFixed(1) + '" y="' + (h + 18) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '" font-size="11" fill="#94a3b8">' + d.date.slice(5) + '</text>';
    }).join('');
    return '<div class="p-3" style="overflow:hidden">' +
      '<svg width="100%" height="200" viewBox="0 0 ' + w + ' ' + (h + 24) + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + area + '" fill="' + CHART_COLORS[0] + '" opacity="0.08"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + CHART_COLORS[0] + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels +
      '</svg></div>';
  }

  function renderStatusDistribution(statusCounts, deps) {
    var keys = Object.keys(statusCounts);
    if (!keys.length) return '<div class="dashboard-state"><i data-lucide="list" class="w-5 h-5 text-slate-300"></i><span>Nenhum pedido.</span></div>';
    return '<table class="dashboard-table"><tbody>' +
      keys.sort().map(function(s) {
        return '<tr><td class="py-2 px-3 text-sm border-b border-slate-100">' + deps.statusBadge(s) + '</td>' +
          '<td class="py-2 px-3 text-sm text-right font-medium border-b border-slate-100">' + statusCounts[s] + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderStoreReceipts(groups) {
    if (!groups.length) return '<div class="dashboard-state"><i data-lucide="package" class="w-5 h-5 text-slate-300"></i><span>Nenhum recebimento.</span></div>';
    return '<table class="dashboard-table"><tbody>' +
      groups.map(function(g) {
        return '<tr><td class="py-2 px-3 text-sm border-b border-slate-100">' + g.storeLabel + '</td>' +
          '<td class="py-2 px-3 text-sm text-right font-medium border-b border-slate-100">' + formatNumber(g.qty) + '</td>' +
          '<td class="py-2 px-3 text-sm text-right text-slate-400 border-b border-slate-100">' + g.count + ' recebimento(s)</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderRecentReceipts(receipts, limit) {
    var list = (receipts || []).slice().sort(function(a, b) {
      return (b.received_at || '') > (a.received_at || '') ? 1 : -1;
    }).slice(0, limit || 5);
    if (!list.length) return '<div class="dashboard-state"><i data-lucide="package" class="w-6 h-6 text-slate-300"></i><span>Nenhum recebimento.</span></div>';
    return '<div class="dashboard-table-scroll"><table class="dashboard-table"><thead><tr>' +
      '<th>Loja</th><th>Produto / SKU</th><th class="text-right">Qtd.</th><th>Recebido em</th>' +
      '</tr></thead><tbody>' +
      list.map(function(r) {
        return '<tr><td>' + getStoreLabel(r) + '</td>' +
          '<td><code class="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">' + escapeHtml(r.product_code || '') + '</code></td>' +
          '<td class="text-right">' + formatNumber(r.received_quantity) + '</td>' +
          '<td class="text-xs text-slate-400">' + formatDate(r.received_at) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function renderDashboard(deps) {
    return '<section class="animate-in space-y-3">' +
      '<div class="dashboard-filter-card">' +
        '<div class="dashboard-filter-grid">' +
          '<div class="dashboard-filter-field">' +
            '<label for="dash-filter-date-start">De</label>' +
            '<input type="date" id="dash-filter-date-start" class="form-input">' +
          '</div>' +
          '<div class="dashboard-filter-field">' +
            '<label for="dash-filter-date-end">At\u00e9</label>' +
            '<input type="date" id="dash-filter-date-end" class="form-input">' +
          '</div>' +
          '<div class="dashboard-filter-field">' +
            '<label>Lojas</label>' +
            '<div class="dash-dd">' +
              '<button type="button" class="dash-dd-toggle" data-dd-target="dash-filter-store">' +
                '<span class="dash-dd-label" id="dash-filter-store-label">Selecione</span>' +
                '<i data-lucide="chevron-down" class="w-4 h-4 dash-dd-arrow"></i>' +
              '</button>' +
              '<div id="dash-filter-store" class="dash-dd-content hidden">' +
                '<div class="dash-dd-search-wrapper"><input type="text" class="dash-dd-search" placeholder="Buscar por nome ou c\u00f3digo..."></div>' +
                '<div class="dash-dd-checkboxes"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="dashboard-filter-field">' +
            '<label>Solicitantes</label>' +
            '<div class="dash-dd">' +
              '<button type="button" class="dash-dd-toggle" data-dd-target="dash-filter-requester">' +
                '<span class="dash-dd-label" id="dash-filter-requester-label">Selecione</span>' +
                '<i data-lucide="chevron-down" class="w-4 h-4 dash-dd-arrow"></i>' +
              '</button>' +
              '<div id="dash-filter-requester" class="dash-dd-content hidden">' +
                '<div class="dash-dd-search-wrapper"><input type="text" class="dash-dd-search" placeholder="Buscar solicitante..."></div>' +
                '<div class="dash-dd-checkboxes"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="dashboard-filter-field dashboard-filter-actions">' +
            '<label aria-hidden="true">&nbsp;</label>' +
            '<button type="button" id="dash-filter-clear" class="dashboard-filter-clear"><i data-lucide="x" class="w-4 h-4"></i> Limpar Filtro</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dashboard-kpi-grid">' +
        renderKpiCard('Pedidos Totais', '42', '+8 essa semana', 'trending-up', 'blue', 'stat-total-mes') +
        renderKpiCard('Em Processamento', '5', '3 aguardando NF', 'loader', 'violet', 'stat-processando') +
        renderKpiCard('Entregas Confirmadas', '34', '81% do total', 'package-check', 'emerald', 'stat-entregues') +
        renderKpiCard('Pedidos Rejeitados', '3', 'Total no mes atual', 'copy-x', 'amber', 'stat-duplicatas') +
      '</div>' +
      '<div class="dashboard-kpi-grid">' +
        renderKpiCard('Total de Lojas', '\u2014', 'com estoque registrado', 'store', 'blue', 'dash-stock-lojas') +
        renderKpiCard('Qtd. Recebida', '\u2014', 'total recebido', 'package-check', 'emerald', 'dash-stock-recebida') +
        renderKpiCard('Valor Total Recebido', '\u2014', 'Total em recebimentos', 'dollar-sign', 'emerald', 'dash-value-total') +
        renderKpiCard('Total de NFs', '\u2014', 'com valor registrado', 'file-text', 'violet', 'dash-value-count') +
      '</div>' +
      '<div class="dashboard-chart-grid">' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Pedidos por Status</h3></div><div id="dash-order-status-chart" class="dashboard-chart-body-new"></div></div>' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Evolu\u00e7\u00e3o de Recebimentos</h3></div><div id="dash-receipt-trend-chart" class="dashboard-chart-body-new"></div></div>' +
      '</div>' +
      '<div class="dashboard-chart-grid">' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Valor por Loja</h3></div><div id="dash-value-store-chart" class="dashboard-chart-body-new"></div></div>' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Evolu\u00e7\u00e3o R$ de Recebimentos</h3></div><div id="dash-value-day-chart" class="dashboard-chart-body-new"></div></div>' +
      '</div>' +
      '<div class="dashboard-card">' +
        '<div class="dashboard-card-header"><h3 class="dashboard-card-title">Pedidos Recentes</h3><a href="/pedidos" data-route="/pedidos" class="dashboard-card-action">Ver todos</a></div>' +
        '<div class="dashboard-table-scroll"><table class="dashboard-table"><thead><tr>' +
          '<th>Protocolo</th><th>Loja</th><th>Produto</th><th>Status</th><th>Valor</th><th>Data</th>' +
        '</tr></thead><tbody id="tbody-recentes">' +
          '<tr><td colspan="6" class="text-center text-slate-400 py-6">Carregando...</td></tr>' +
        '</tbody></table></div>' +
      '</div>' +
    '</section>';
  }

  function renderRecentOrders(orders, deps) {
    if (!orders.length) {
      return '<tr><td colspan="6" class="text-center text-slate-400 py-6">Nenhum pedido encontrado.</td></tr>';
    }
    return orders.map(function mapOrder(order) {
      var protocolo = escapeHtml(order.protocolo || order.internal_number || '-');
      var storeLabel = order.lojas?.nome || order.store || '-';
      var store = escapeHtml(storeLabel);
      var items = order.pedido_itens || order.order_items || [];
      var firstItem = items[0] || {};
      var product = escapeHtml(firstItem.sku_digitado || firstItem.product_code || firstItem.description || '-');
      var criadoEm = order.criado_em || order.created_at || '';
      var date = escapeHtml(criadoEm ? criadoEm.slice(0, 10) : '-');
      var orderId = escapeHtml(order.id);
      return '<tr class="border-b border-slate-100 hover:bg-blue-50 cursor-pointer" data-order-id="' + orderId + '">' +
        '<td class="py-3 px-4 text-sm font-medium text-slate-900">' + protocolo + '</td>' +
        '<td class="py-3 px-4 text-sm">' + store + '</td>' +
        '<td class="py-3 px-4 text-sm">' + product + '</td>' +
        '<td class="py-3 px-4 text-sm">' + deps.statusBadge(order.status) + '</td>' +
        '<td class="py-3 px-4 text-sm">' + (order.valor_total ? 'R$ ' + Number(order.valor_total).toFixed(2) : '-') + '</td>' +
        '<td class="py-3 px-4 text-sm">' + date + '</td>' +
      '</tr>';
    }).join('');
  }

  function updateStatCard(id, value, sub) {
    var element = document.getElementById(id);
    if (!element) return;
    var valEl = element.querySelector('.stat-val');
    if (valEl) valEl.textContent = value;
    var subEl = element.querySelector('.stat-sub');
    if (subEl) subEl.textContent = sub || '';
  }

  function _getCheckedValues(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function(cb) { return cb.value; })
      .filter(Boolean);
  }

  function getFilterValues() {
    return {
      dateStart: (document.getElementById('dash-filter-date-start') || {}).value || '',
      dateEnd: (document.getElementById('dash-filter-date-end') || {}).value || '',
      storeIds: _getCheckedValues('dash-filter-store'),
      requesterIds: _getCheckedValues('dash-filter-requester'),
    };
  }

  function filterOrders(orders, filters) {
    filters = filters || getFilterValues();
    var start = filters.dateStart || '';
    var end = filters.dateEnd || '';
    var storeIds = filters.storeIds || [];
    var reqIds = filters.requesterIds || [];
    return (orders || []).filter(function(o) {
      if (isDeletedOrder(o)) return false;
      if (start && (o.created_at || '').slice(0, 10) < start) return false;
      if (end && (o.created_at || '').slice(0, 10) > end) return false;
      if (storeIds.length && storeIds.indexOf(String(o.store_id)) === -1) return false;
      if (reqIds.length && reqIds.indexOf(String(o.requester_id)) === -1) return false;
      return true;
    });
  }

  function filterByDateAndStore(items, dateField, filters) {
    filters = filters || getFilterValues();
    var start = filters.dateStart || '';
    var end = filters.dateEnd || '';
    var storeIds = filters.storeIds || [];
    return (items || []).filter(function(item) {
      if (start) {
        var d = (item[dateField] || '').slice(0, 10);
        if (d < start) return false;
      }
      if (end) {
        var d = (item[dateField] || '').slice(0, 10);
        if (d > end) return false;
      }
      if (storeIds.length && storeIds.indexOf(String(item.store_id)) === -1) return false;
      return true;
    });
  }

  function _updateDropdownLabel(containerId) {
    var container = document.getElementById(containerId);
    var labelId = containerId + '-label';
    var labelEl = document.getElementById(labelId);
    if (!labelEl) return;
    var checked = container ? container.querySelectorAll('input[type="checkbox"]:checked') : [];
    var n = checked.length;
    labelEl.textContent = n === 0 ? 'Selecione' : n + ' selecionado' + (n > 1 ? 's' : '');
  }

  function _filterCheckboxes(containerId, q) {
    var wrapper = document.querySelector('#' + containerId + ' .dash-dd-checkboxes');
    if (!wrapper) return;
    var search = (q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    Array.from(wrapper.children).forEach(function(label) {
      var text = (label.textContent || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      label.style.display = text.indexOf(search) !== -1 ? '' : 'none';
    });
  }

  function _onSearch(e) {
    var containerId = e.target.closest('.dash-dd-content').id;
    _filterCheckboxes(containerId, e.target.value);
  }

  function _buildCheckboxContainer(containerId, items) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var wrapper = container.querySelector('.dash-dd-checkboxes') || container;
    wrapper.innerHTML = '';
    items.forEach(function(item) {
      var label = document.createElement('label');
      label.className = 'dashboard-filter-checkbox-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = item.value;
      // ponytail: delegation via wrapper in bindFilterEvents
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + item.label));
      wrapper.appendChild(label);
    });
    _updateDropdownLabel(containerId);
  }

  function _bindSearch(containerId) {
    var input = document.querySelector('#' + containerId + ' .dash-dd-search');
    if (!input) return;
    input.removeEventListener('input', _onSearch);
    input.addEventListener('input', _onSearch);
  }

  async function populateStoreFilter() {
    if (typeof global.carregarLojas === 'function') {
      try { await global.carregarLojas(); } catch (_e) {}
    }
    var stores = (global.StoresModule && typeof global.StoresModule.getAllStores === 'function')
      ? global.StoresModule.getAllStores() : [];
    _buildCheckboxContainer('dash-filter-store', stores.map(function(s) {
      return { value: String(s.id), label: s.nome || ('Loja #' + s.id) };
    }));
    _bindSearch('dash-filter-store');
  }

  function populateRequesterFilter(orders) {
    var map = {};
    (orders || []).forEach(function(o) {
      if (o.requester_id) {
        var label = o.requester_name || o.requester_email || o.requester_id;
        if (!map[o.requester_id]) map[o.requester_id] = label;
      }
    });
    var items = Object.keys(map).sort().map(function(id) {
      return { value: id, label: map[id] };
    });
    _buildCheckboxContainer('dash-filter-requester', items);
    _bindSearch('dash-filter-requester');
  }

  function refreshDashboard() {
    if (!_dashDeps) return;
    var f = getFilterValues();

    var filteredOrders = filterOrders(_dashOrders, f);
    var orderKpi = calcOrderKpi(filteredOrders);

    updateStatCard('stat-total-mes', String(orderKpi.totalOrders), 'Pedidos totais filtrados');
    updateStatCard('stat-processando', String(orderKpi.pendingCount), 'Pendentes de aprovacao');
    updateStatCard('stat-entregues', String(orderKpi.statusCounts['RECEIVED'] || 0), 'Pedidos recebidos');
    updateStatCard('stat-duplicatas', String(orderKpi.statusCounts['REJECTED'] || 0), 'Pedidos rejeitados');

    var statusChartEl = document.getElementById('dash-order-status-chart');
    if (statusChartEl) statusChartEl.innerHTML = renderStatusBarChart(orderKpi.statusCounts);

    var recent = filteredOrders.slice().sort(function(a, b) {
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
    }).slice(0, 8);
    var tbody = document.getElementById('tbody-recentes');
    if (tbody) tbody.innerHTML = renderRecentOrders(recent, _dashDeps);

    var filteredReceipts = filterByDateAndStore(_dashReceipts, 'received_at', f);
    var stockKpi = calcStockKpi(_dashChecks, filteredReceipts);
    updateStatCard('dash-stock-lojas', String(stockKpi.totalStores), 'com estoque registrado');
    updateStatCard('dash-stock-skus', String(stockKpi.totalSkus), 'solicitados ou recebidos');
    updateStatCard('dash-stock-solicitada', formatNumber(stockKpi.requestedQty), 'total solicitado');
    updateStatCard('dash-stock-recebida', formatNumber(stockKpi.receivedQty), 'total recebido');

    var trendChartEl = document.getElementById('dash-receipt-trend-chart');
    if (trendChartEl) trendChartEl.innerHTML = renderReceiptTrendChart(filteredReceipts);

    var valueKpi = calcReceiptValueKpi(filteredReceipts);
    updateStatCard('dash-value-total', formatCurrency(valueKpi.totalValue), 'Total em recebimentos');
    updateStatCard('dash-value-count', String(valueKpi.receiptWithValueCount), 'com valor registrado');

    var valueStoreChartEl = document.getElementById('dash-value-store-chart');
    if (valueStoreChartEl) valueStoreChartEl.innerHTML = renderValueBarChart(groupReceiptValueByStore(filteredReceipts));

    var valueDayChartEl = document.getElementById('dash-value-day-chart');
    if (valueDayChartEl) valueDayChartEl.innerHTML = renderValueLineChart(groupReceiptValueByDay(filteredReceipts));

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function _closeAllDropdowns() {
    document.querySelectorAll('.dash-dd-content').forEach(function(c) { c.classList.add('hidden'); });
    document.querySelectorAll('.dash-dd-toggle').forEach(function(t) { t.classList.remove('dash-dd-open'); });
  }

  function _toggleDropdown(btn) {
    var targetId = btn.getAttribute('data-dd-target');
    var content = document.getElementById(targetId);
    if (!content) return;
    var isOpen = !content.classList.contains('hidden');
    _closeAllDropdowns();
    if (!isOpen) {
      content.classList.remove('hidden');
      btn.classList.add('dash-dd-open');
    }
  }

  function _onDocumentClick(e) {
    if (e.target.closest('.dash-dd')) return;
    _closeAllDropdowns();
  }

  function _bindCloseOnOutsideClick() {
    document.removeEventListener('click', _onDocumentClick);
    document.addEventListener('click', _onDocumentClick);
  }

  function clearFilters() {
    var dateStart = document.getElementById('dash-filter-date-start');
    if (dateStart) dateStart.value = '';
    var dateEnd = document.getElementById('dash-filter-date-end');
    if (dateEnd) dateEnd.value = '';
    ['dash-filter-store', 'dash-filter-requester'].forEach(function(id) {
      var container = document.getElementById(id);
      if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
      }
      _updateDropdownLabel(id);
    });
    refreshDashboard();
  }

  function bindFilterEvents() {
    ['dash-filter-date-start', 'dash-filter-date-end'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.removeEventListener('change', refreshDashboard);
        el.addEventListener('change', refreshDashboard);
      }
    });
    ['dash-filter-store', 'dash-filter-requester'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.removeEventListener('change', function _onCheckboxChange() {
          refreshDashboard();
          _updateDropdownLabel(id);
        });
        el.addEventListener('change', function _onCheckboxChange() {
          refreshDashboard();
          _updateDropdownLabel(id);
        });
      }
    });
    document.querySelectorAll('.dash-dd-toggle').forEach(function(btn) {
      btn.removeEventListener('click', function _onToggleClick() { _toggleDropdown(btn); });
      btn.addEventListener('click', function _onToggleClick() { _toggleDropdown(btn); });
    });
    _bindCloseOnOutsideClick();
    var clearBtn = document.getElementById('dash-filter-clear');
    if (clearBtn) {
      clearBtn.removeEventListener('click', clearFilters);
      clearBtn.addEventListener('click', clearFilters);
    }
  }

  var _recentRowBound = false;
  function _bindRecentRowClick() {
    if (_recentRowBound) return;
    var tbody = document.getElementById('tbody-recentes');
    if (!tbody) return;
    tbody.addEventListener('click', function dashboardRowClick(e) {
      var row = e.target && e.target.closest('tr[data-order-id]');
      if (!row) return;
      var orderId = row.getAttribute('data-order-id');
      if (orderId && typeof global.openPedido === 'function') {
        global.openPedido(orderId);
      }
    });
    _recentRowBound = true;
  }

  async function loadAllDashboardOrders(deps) {
    if (!deps || typeof deps.listOrdersForCurrentProfile !== 'function') return [];

    var page = 1;
    var pageSize = 200;
    var total = Number.POSITIVE_INFINITY;
    var collected = [];

    while (collected.length < total) {
      var result = await deps.listOrdersForCurrentProfile({ page: page, pageSize: pageSize });
      var items = Array.isArray(result && result.items) ? result.items : [];
      collected = collected.concat(items);
      total = Number(result && result.total) > 0 ? Number(result.total) : collected.length;
      if (!items.length || collected.length >= total) break;
      page++;
    }

    return collected.filter(function(o) { return !isDeletedOrder(o); });
  }

  async function afterRenderDashboard(deps) {
    _dashDeps = deps;

    try {
      var sb = typeof deps.getSb === 'function' ? deps.getSb() : null;
      var getSb = function() { return sb; };

      var loadChecks = global.StockCheckDataModule && typeof global.StockCheckDataModule.loadOrderItemChecks === 'function'
        ? global.StockCheckDataModule.loadOrderItemChecks({ getSb: getSb })
        : Promise.resolve([]);
      var loadReceipts = global.StockCheckDataModule && typeof global.StockCheckDataModule.loadReceivedStock === 'function'
        ? global.StockCheckDataModule.loadReceivedStock({ getSb: getSb })
        : Promise.resolve([]);

      var stockResult = await Promise.allSettled([loadChecks, loadReceipts]);
      _dashChecks = stockResult[0].status === 'fulfilled' ? stockResult[0].value : [];
      _dashReceipts = stockResult[1].status === 'fulfilled' ? stockResult[1].value : [];

      var stockKpi = calcStockKpi(_dashChecks, _dashReceipts);
      updateStatCard('dash-stock-lojas', String(stockKpi.totalStores), 'com estoque registrado');
      updateStatCard('dash-stock-skus', String(stockKpi.totalSkus), 'solicitados ou recebidos');
      updateStatCard('dash-stock-solicitada', formatNumber(stockKpi.requestedQty), 'total solicitado');
      updateStatCard('dash-stock-recebida', formatNumber(stockKpi.receivedQty), 'total recebido');

      var trendChartEl = document.getElementById('dash-receipt-trend-chart');
      if (trendChartEl) trendChartEl.innerHTML = renderReceiptTrendChart(_dashReceipts);

      var valueKpi = calcReceiptValueKpi(_dashReceipts);
      updateStatCard('dash-value-total', formatCurrency(valueKpi.totalValue), 'Total em recebimentos');
      updateStatCard('dash-value-count', String(valueKpi.receiptWithValueCount), 'com valor registrado');

      var valueStoreChartEl = document.getElementById('dash-value-store-chart');
      if (valueStoreChartEl) valueStoreChartEl.innerHTML = renderValueBarChart(groupReceiptValueByStore(_dashReceipts));

      var valueDayChartEl = document.getElementById('dash-value-day-chart');
      if (valueDayChartEl) valueDayChartEl.innerHTML = renderValueLineChart(groupReceiptValueByDay(_dashReceipts));
    } catch (error) {
      console.warn('dashboard stock data error:', error.message);
    }

    try {
      _dashOrders = await loadAllDashboardOrders(deps);
    } catch (error) {
      console.warn('dashboard orders data error:', error.message);
    }

    await populateStoreFilter();
    populateRequesterFilter(_dashOrders);
    bindFilterEvents();
    refreshDashboard();

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  global.DashboardModule = {
    afterRenderDashboard: afterRenderDashboard,
    renderDashboard: renderDashboard,
    calcStockKpi: calcStockKpi,
    calcOrderKpi: calcOrderKpi,
    groupReceiptsByStore: groupReceiptsByStore,
    renderStatusDistribution: renderStatusDistribution,
    renderStoreReceipts: renderStoreReceipts,
    renderRecentReceipts: renderRecentReceipts,
    renderRecentOrders: renderRecentOrders,
    formatNumber: formatNumber,
    formatDate: formatDate,
    getStoreLabel: getStoreLabel,
    loadAllDashboardOrders: loadAllDashboardOrders,
    renderStatusBarChart: renderStatusBarChart,
    renderReceiptDonutChart: renderReceiptDonutChart,
    renderReceiptTrendChart: renderReceiptTrendChart,
    renderKpiCard: renderKpiCard,
    formatCurrency: formatCurrency,
    calcReceiptValueKpi: calcReceiptValueKpi,
    groupReceiptValueByStore: groupReceiptValueByStore,
    groupReceiptValueByDay: groupReceiptValueByDay,
    renderValueBarChart: renderValueBarChart,
    renderValueLineChart: renderValueLineChart,
    CHART_COLORS: CHART_COLORS,
    STATUS_COLORS: STATUS_COLORS,
    KPI_COLORS: KPI_COLORS,
    getFilterValues: getFilterValues,
    filterOrders: filterOrders,
    filterByDateAndStore: filterByDateAndStore,
    populateStoreFilter: populateStoreFilter,
    populateRequesterFilter: populateRequesterFilter,
    refreshDashboard: refreshDashboard,
    clearFilters: clearFilters,
    isDeletedOrder: isDeletedOrder,
    getStatusColor: getStatusColor,
  };
})(window);
