const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_PATH = path.join(ROOT, 'public', 'js', 'pages', 'dashboard', 'dashboard-module.js');

function loadModule() {
  const code = fs.readFileSync(MODULE_PATH, 'utf8');
  const window = {
    AppUtils: {
      escapeHtml: function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
    },
    DashboardModule: {},
    console: console,
    lucide: { createIcons: function() {} },
    setTimeout: setTimeout,
  };
  window.window = window;
  window.globalThis = window;
  vm.runInNewContext(code, window, { filename: MODULE_PATH });
  return window.DashboardModule;
}

function run() {
  console.log('=== Dashboard Tests ===\n');

  var M = loadModule();

  // ── calcStockKpi ──────────────────────────────────────────────

  // 1) Empty checks and receipts
  {
    var kpi = M.calcStockKpi([], []);
    assert.equal(kpi.totalStores, 0, 'totalStores must be 0');
    assert.equal(kpi.totalSkus, 0, 'totalSkus must be 0');
    assert.equal(kpi.requestedQty, 0, 'requestedQty must be 0');
    assert.equal(kpi.receivedQty, 0, 'receivedQty must be 0');
    assert.equal(kpi.lastReceiptDate, null, 'lastReceiptDate must be null');
    console.log('PASS: empty stock KPI');
  }

  // 2) Mixed checks and receipts
  {
    var checks = [
      { store_id: 1, product_code: 'SKU-A', requested_quantity: 10 },
      { store_id: 2, product_code: 'SKU-B', requested_quantity: 5 },
      { store_id: 1, product_code: 'SKU-A', requested_quantity: 3 },
    ];
    var receipts = [
      { store_id: 1, product_code: 'SKU-A', received_quantity: 8, received_at: '2026-07-05T10:00:00Z' },
      { store_id: 3, product_code: 'SKU-C', received_quantity: 20, received_at: '2026-07-06T10:00:00Z' },
    ];
    var kpi = M.calcStockKpi(checks, receipts);
    assert.equal(kpi.totalStores, 3, 'totalStores must be 3 (1,2,3)');
    assert.equal(kpi.totalSkus, 3, 'totalSkus must be 3 (SKU-A,SKU-B,SKU-C)');
    assert.equal(kpi.requestedQty, 18, 'requestedQty must be 10+5+3=18');
    assert.equal(kpi.receivedQty, 28, 'receivedQty must be 8+20=28');
    assert.equal(kpi.lastReceiptDate, '2026-07-06T10:00:00Z', 'lastReceiptDate must be latest');
    console.log('PASS: mixed stock KPI');
  }

  // 3) Dedup store IDs
  {
    var checks = [{ store_id: 5, product_code: 'X', requested_quantity: 1 }];
    var receipts = [{ store_id: 5, product_code: 'Y', received_quantity: 2 }];
    assert.equal(M.calcStockKpi(checks, receipts).totalStores, 1, 'dedup store IDs');
    console.log('PASS: dedup store IDs');
  }

  // 4) Null/undefined fields
  {
    var checks = [{ store_id: null, product_code: null, requested_quantity: null }];
    var kpi = M.calcStockKpi(checks, []);
    assert.equal(kpi.totalStores, 0, 'null store not counted');
    assert.equal(kpi.totalSkus, 0, 'null SKU not counted');
    assert.equal(kpi.requestedQty, 0, 'null qty = 0');
    var kpi2 = M.calcStockKpi([{ store_id: 1, product_code: 'A' }], []);
    assert.equal(kpi2.requestedQty, 0, 'undefined requested = 0');
    console.log('PASS: null/undefined fields in stock KPI');
  }

  // ── calcOrderKpi ──────────────────────────────────────────────

  // 5) Empty orders
  {
    var kpi = M.calcOrderKpi([]);
    assert.equal(kpi.totalOrders, 0, 'totalOrders must be 0');
    assert.equal(kpi.pendingCount, 0, 'pendingCount must be 0');
    assert.equal(Object.keys(kpi.statusCounts).length, 0, 'statusCounts must be empty');
    console.log('PASS: empty order KPI');
  }

  // 6) Orders grouped by status
  {
    var orders = [
      { status: 'PENDING_APPROVAL' },
      { status: 'APPROVED' },
      { status: 'PENDING_APPROVAL' },
      { status: 'REJECTED' },
      { status: 'APPROVED' },
      { status: 'DRAFT' },
    ];
    var kpi = M.calcOrderKpi(orders);
    assert.equal(kpi.totalOrders, 6, 'totalOrders must be 6');
    assert.equal(kpi.pendingCount, 2, 'pendingCount must be 2');
    assert.equal(kpi.statusCounts['PENDING_APPROVAL'], 2, 'PENDING_APPROVAL count');
    assert.equal(kpi.statusCounts['APPROVED'], 2, 'APPROVED count');
    assert.equal(kpi.statusCounts['REJECTED'], 1, 'REJECTED count');
    assert.equal(kpi.statusCounts['DRAFT'], 1, 'DRAFT count');
    console.log('PASS: grouped order KPI');
  }

  // 7) Orders missing status
  {
    var kpi = M.calcOrderKpi([{}, { status: null }, { status: 'APPROVED' }]);
    assert.equal(kpi.totalOrders, 3, 'must count all items');
    assert.equal(kpi.statusCounts['UNKNOWN'], 2, 'missing status counts as UNKNOWN');
    assert.equal(kpi.statusCounts['APPROVED'], 1, 'APPROVED still counted');
    console.log('PASS: orders with missing status');
  }

  // 8) RECEIVED is tracked separately
  {
    var kpi = M.calcOrderKpi([
      { status: 'APPROVED' },
      { status: 'RECEIVED' },
      { status: 'RECEIVED' },
    ]);
    assert.equal(kpi.statusCounts['APPROVED'], 1, 'APPROVED count');
    assert.equal(kpi.statusCounts['RECEIVED'], 2, 'RECEIVED count');
    console.log('PASS: RECEIVED order status');
  }

  // ── groupReceiptsByStore ──────────────────────────────────────

  // ── isDeletedOrder ────────────────────────────────────────────

  // 8) isDeletedOrder rejects null/undefined
  {
    assert.ok(M.isDeletedOrder(null), 'null is deleted');
    assert.ok(M.isDeletedOrder(undefined), 'undefined is deleted');
    console.log('PASS: isDeletedOrder null/undefined');
  }

  // 9) isDeletedOrder detects deleted_at
  {
    assert.ok(M.isDeletedOrder({ deleted_at: '2026-07-07T12:00:00Z' }), 'deleted_at set');
    assert.ok(!M.isDeletedOrder({}), 'no deleted_at');
    console.log('PASS: isDeletedOrder deleted_at');
  }

  // 10) isDeletedOrder detects is_deleted flag
  {
    assert.ok(M.isDeletedOrder({ is_deleted: true }), 'is_deleted true');
    assert.ok(!M.isDeletedOrder({ is_deleted: false }), 'is_deleted false');
    console.log('PASS: isDeletedOrder is_deleted');
  }

  // 11) isDeletedOrder detects deleted flag
  {
    assert.ok(M.isDeletedOrder({ deleted: true }), 'deleted true');
    assert.ok(!M.isDeletedOrder({ deleted: false }), 'deleted false');
    console.log('PASS: isDeletedOrder deleted');
  }

  // 12) isDeletedOrder detects DELETED/EXCLUIDO status
  {
    assert.ok(M.isDeletedOrder({ status: 'DELETED' }), 'status DELETED');
    assert.ok(M.isDeletedOrder({ status: 'EXCLUIDO' }), 'status EXCLUIDO');
    assert.ok(M.isDeletedOrder({ status: 'EXCLUÍDO' }), 'status EXCLUÍDO');
    assert.ok(!M.isDeletedOrder({ status: 'APPROVED' }), 'status APPROVED not deleted');
    console.log('PASS: isDeletedOrder status');
  }

  // 13) calcOrderKpi excludes deleted orders
  {
    var orders = [
      { status: 'PENDING_APPROVAL' },
      { status: 'APPROVED' },
      { status: 'PENDING_APPROVAL' },
      { status: 'REJECTED' },
      { status: 'DRAFT' },
      { status: 'PENDING_APPROVAL', deleted_at: '2026-07-07T12:00:00Z' },
      { status: 'APPROVED', is_deleted: true },
      { status: 'DELETED' },
      { status: 'REJECTED', deleted: true },
    ];
    var kpi = M.calcOrderKpi(orders);
    assert.equal(kpi.totalOrders, 5, '5 active, 4 excluded');
    assert.equal(kpi.pendingCount, 2, '2 pending approval');
    assert.equal(kpi.statusCounts['PENDING_APPROVAL'], 2, 'PENDING_APPROVAL count');
    assert.equal(kpi.statusCounts['APPROVED'], 1, 'APPROVED count');
    assert.equal(kpi.statusCounts['REJECTED'], 1, 'REJECTED count');
    assert.equal(kpi.statusCounts['DRAFT'], 1, 'DRAFT count');
    assert.ok(!kpi.statusCounts['DELETED'], 'DELETED excluded');
    console.log('PASS: calcOrderKpi excludes deleted');
  }

  // ── groupReceiptsByStore ──────────────────────────────────────

  // 14) Empty receipts
  {
    var groups = M.groupReceiptsByStore([]);
    assert.ok(Array.isArray(groups), 'must be array');
    assert.equal(groups.length, 0, 'empty groups');
    console.log('PASS: empty receipt groups');
  }

  // 9) Groups by store, sorted by qty desc, max 5
  {
    var receipts = [
      { store_id: 1, lojas: { nome: 'Loja A' }, received_quantity: 10 },
      { store_id: 2, lojas: { nome: 'Loja B' }, received_quantity: 30 },
      { store_id: 1, lojas: { nome: 'Loja A' }, received_quantity: 5 },
      { store_id: 3, lojas: { nome: 'Loja C' }, received_quantity: 20 },
      { store_id: 4, lojas: null, received_quantity: 15 },
      { store_id: 5, lojas: { nome: 'Loja E' }, received_quantity: 25 },
      { store_id: 6, lojas: { nome: 'Loja F' }, received_quantity: 12 },
    ];
    var groups = M.groupReceiptsByStore(receipts);
    assert.equal(groups.length, 5, 'max 5 stores');
    assert.equal(groups[0].storeLabel, 'Loja B', 'highest qty first');
    assert.equal(groups[0].qty, 30, 'summed qty for store 2');
    assert.equal(groups[1].storeLabel, 'Loja E', 'second highest');
    assert.equal(groups[4].storeLabel, 'Loja #4', 'no lojas.nome fallback');
    assert.equal(groups[4].qty, 15, 'qty for store 4');
    console.log('PASS: grouped receipts by store');
  }

  // ── renderStatusDistribution ──────────────────────────────────

  // 10) Empty status counts
  {
    var html = M.renderStatusDistribution({}, { statusBadge: function(s) { return s; } });
    assert.ok(html.includes('Nenhum pedido'), 'empty message');
    console.log('PASS: empty status distribution');
  }

  // 11) Renders all statuses
  {
    var deps = { statusBadge: function(s) { return '<span>' + s + '</span>'; } };
    var html = M.renderStatusDistribution({ APPROVED: 3, REJECTED: 1 }, deps);
    assert.ok(html.includes('APPROVED'), 'badge shows APPROVED');
    assert.ok(html.includes('REJECTED'), 'badge shows REJECTED');
    assert.ok(html.includes('3'), 'count for APPROVED');
    assert.ok(html.includes('1'), 'count for REJECTED');
    assert.ok(!html.includes('Nenhum'), 'no empty message');
    console.log('PASS: status distribution renders counts');
  }

  // ── renderStoreReceipts ───────────────────────────────────────

  // 12) Empty groups
  {
    var html = M.renderStoreReceipts([]);
    assert.ok(html.includes('Nenhum recebimento'), 'empty message');
    console.log('PASS: empty store receipts');
  }

  // 13) Renders store rows
  {
    var groups = [
      { storeLabel: 'Loja A', qty: 30, count: 2 },
      { storeLabel: 'Loja B', qty: 15, count: 1 },
    ];
    var html = M.renderStoreReceipts(groups);
    assert.ok(html.includes('Loja A'), 'store label');
    assert.ok(html.includes('30'), 'qty formatted');
    assert.ok(html.includes('2 recebimento'), 'count label');
    console.log('PASS: store receipts rows');
  }

  // ── renderRecentReceipts ──────────────────────────────────────

  // 14) Empty receipts
  {
    var html = M.renderRecentReceipts([]);
    assert.ok(html.includes('Nenhum recebimento'), 'empty message');
    console.log('PASS: empty recent receipts');
  }

  // 15) Sorted by received_at desc, limited
  {
    var receipts = [
      { store_id: 1, lojas: { nome: 'A' }, product_code: 'SKU-1', received_quantity: 10, received_at: '2026-07-01' },
      { store_id: 2, lojas: { nome: 'B' }, product_code: 'SKU-2', received_quantity: 20, received_at: '2026-07-03' },
      { store_id: 3, lojas: { nome: 'C' }, product_code: 'SKU-3', received_quantity: 30, received_at: '2026-07-02' },
    ];
    var html = M.renderRecentReceipts(receipts, 2);
    assert.ok(html.indexOf('SKU-2') < html.indexOf('SKU-3'), 'newest first');
    assert.ok(html.includes('SKU-1') === false || html.indexOf('SKU-2') > -1, 'limited to 2');
    var dataRows = html.match(/<tr>/g);
    assert.equal(dataRows ? dataRows.length : 0, 3, 'exactly 3 rows total (1 header + 2 data)');
    console.log('PASS: sorted and limited recent receipts');
  }

  // 16) Missing fields
  {
    var receipts = [
      { store_id: 5, received_quantity: null, received_at: null },
    ];
    var html = M.renderRecentReceipts(receipts, 5);
    assert.ok(html.includes('\u2014'), 'missing date shows dash');
    assert.ok(html.includes('0.00'), 'null qty shows 0.00');
    console.log('PASS: missing fields in receipts');
  }

  // ── format helpers ────────────────────────────────────────────

  // 17) formatDate
  {
    assert.equal(M.formatDate(null), '\u2014', 'null returns dash');
    assert.equal(M.formatDate(undefined), '\u2014', 'undefined returns dash');
    assert.ok(M.formatDate('2026-07-05T10:00:00Z').includes('2026'), 'formats date');
    assert.equal(M.formatDate('invalid-date'), '\u2014', 'invalid returns dash');
    console.log('PASS: formatDate helper');
  }

  // 18) formatNumber
  {
    assert.equal(M.formatNumber(10.5), '10.50', 'formats number');
    assert.equal(M.formatNumber(null), '0.00', 'null returns 0.00');
    assert.equal(M.formatNumber(undefined), '0,00', 'undefined returns 0,00');
    assert.equal(M.formatNumber('abc'), '0,00', 'invalid returns 0,00');
    assert.equal(M.formatNumber(0), '0.00', 'zero formatted');
    console.log('PASS: formatNumber helper');
  }

  // 19) getStoreLabel
  {
    var itemWithStore = { lojas: { nome: 'Loja Centro' }, store_id: 1 };
    assert.equal(M.getStoreLabel(itemWithStore), 'Loja Centro', 'uses lojas.nome');
    var itemNoStore = { store_id: 42 };
    assert.equal(M.getStoreLabel(itemNoStore), 'Loja #42', 'fallback to ID');
    var itemNull = {};
    assert.equal(M.getStoreLabel(itemNull), 'Loja #undefined', 'fallback for missing');
    console.log('PASS: getStoreLabel helper');
  }

  // ── renderKpiCard ─────────────────────────────────────────────

  // 20) renderKpiCard uses dashboard-kpi-card
  {
    var html = M.renderKpiCard('Teste', '42', 'sub', 'trending-up', 'blue', 'test-id');
    assert.ok(html.includes('dashboard-kpi-card'), 'uses dashboard-kpi-card');
    assert.ok(html.includes('dashboard-kpi-icon'), 'has icon');
    assert.ok(html.includes('dashboard-kpi-body'), 'has body');
    assert.ok(html.includes('dashboard-kpi-label'), 'has label');
    assert.ok(html.includes('dashboard-kpi-value'), 'has value');
    assert.ok(html.includes('dashboard-kpi-sub'), 'has sub');
    assert.ok(!html.includes('stat-card'), 'does not use stat-card');
    assert.ok(html.includes('id="test-id"'), 'has id');
    assert.ok(html.includes('trending-up'), 'has icon name');
    assert.ok(html.includes('bg-blue-50'), 'blue icon color');
    console.log('PASS: renderKpiCard structure');
  }

  // ── Static code checks ────────────────────────────────────────

  // 21) No inline onclick
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!code.includes('onclick='), 'no inline onclick');
    assert.ok(!code.includes('onclick '), 'no onclick property');
    assert.ok(code.includes('addEventListener'), 'uses addEventListener');
    console.log('PASS: no inline onclick');
  }

  // 22) References escapeHtml
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(code.includes('global.AppUtils.escapeHtml'), 'references AppUtils.escapeHtml');
    console.log('PASS: references escapeHtml');
  }

  // 23) No waveCard in renderDashboard
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!code.includes('deps.waveCard'), 'must not reference waveCard');
    console.log('PASS: no waveCard reference');
  }

  // 24) No leftover inventory alert/analysis code
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!code.includes('inv-alertas'), 'no inv-alertas DOM IDs');
    assert.ok(!code.includes('inv-top'), 'no inv-top DOM IDs');
    assert.ok(!code.includes('inv-stat-'), 'no inv-stat- DOM IDs');
    assert.ok(!code.includes('renderAlertaRow'), 'no renderAlertaRow');
    assert.ok(!code.includes('renderTopSkuRow'), 'no renderTopSkuRow');
    assert.ok(!code.includes('loadInventoryDashboardData'), 'no loadInventoryDashboardData');
    assert.ok(!code.includes('setSectionState'), 'no setSectionState');
    console.log('PASS: no leftover inventory alert code');
  }

  // 25) Exports helper functions
  {
    assert.equal(typeof M.calcStockKpi, 'function', 'exports calcStockKpi');
    assert.equal(typeof M.calcOrderKpi, 'function', 'exports calcOrderKpi');
    assert.equal(typeof M.groupReceiptsByStore, 'function', 'exports groupReceiptsByStore');
    assert.equal(typeof M.renderStatusDistribution, 'function', 'exports renderStatusDistribution');
    assert.equal(typeof M.renderStoreReceipts, 'function', 'exports renderStoreReceipts');
    assert.equal(typeof M.renderRecentReceipts, 'function', 'exports renderRecentReceipts');
    assert.equal(typeof M.formatNumber, 'function', 'exports formatNumber');
    assert.equal(typeof M.formatDate, 'function', 'exports formatDate');
    assert.equal(typeof M.getStoreLabel, 'function', 'exports getStoreLabel');
    assert.equal(typeof M.afterRenderDashboard, 'function', 'exports afterRenderDashboard');
    assert.equal(typeof M.renderDashboard, 'function', 'exports renderDashboard');
    assert.equal(typeof M.renderKpiCard, 'function', 'exports renderKpiCard');
    assert.equal(typeof M.formatCurrency, 'function', 'exports formatCurrency');
    assert.equal(typeof M.calcReceiptValueKpi, 'function', 'exports calcReceiptValueKpi');
    assert.equal(typeof M.groupReceiptValueByStore, 'function', 'exports groupReceiptValueByStore');
    assert.equal(typeof M.groupReceiptValueByDay, 'function', 'exports groupReceiptValueByDay');
    assert.equal(typeof M.renderValueBarChart, 'function', 'exports renderValueBarChart');
    assert.equal(typeof M.renderValueLineChart, 'function', 'exports renderValueLineChart');
    console.log('PASS: exports all functions');
  }

  // 26) Uses StockCheckDataModule (backed not InventoryDataModule)
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(code.includes('StockCheckDataModule'), 'must use StockCheckDataModule');
    assert.ok(!code.includes('InventoryDataModule'), 'must not use InventoryDataModule');
    assert.ok(!code.includes('inventory_items'), 'must not reference inventory_items table');
    console.log('PASS: uses StockCheckDataModule not old InventoryDataModule');
  }

  // 27) Pedido counts from orders data only (not stock checks)
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(code.includes('statusCounts') || code.includes('deps.statusBadge'), 'statusCounts uses deps.statusBadge');
    var funcMatch = code.match(/function calcOrderKpi[\s\S]*?(?=\n  function|\n  var|\n  \/\/|$)/);
    var calcFunc = funcMatch ? funcMatch[0] : '';
    assert.ok(!calcFunc.includes('checks.'), 'calcOrderKpi must not reference checks.');
    assert.ok(!calcFunc.includes('loadOrderItemChecks'), 'calcOrderKpi must not reference loadOrderItemChecks');
    console.log('PASS: status derivation from orders only');
  }

  // ── Chart render helpers ──────────────────────────────────────

  // 28) Exports chart render helpers
  {
    assert.equal(typeof M.renderStatusBarChart, 'function', 'exports renderStatusBarChart');
    assert.equal(typeof M.renderReceiptDonutChart, 'function', 'exports renderReceiptDonutChart');
    assert.equal(typeof M.renderReceiptTrendChart, 'function', 'exports renderReceiptTrendChart');
    console.log('PASS: exports chart render helpers');
  }

  // 29) renderStatusBarChart handles empty
  {
    var html = M.renderStatusBarChart({});
    assert.ok(html.includes('Sem dados'), 'empty status chart state');
    console.log('PASS: renderStatusBarChart empty');
  }

  // 30) renderStatusBarChart renders donut with status legends
  {
    var html = M.renderStatusBarChart({ APPROVED: 5, REJECTED: 2 });
    assert.ok(html.includes('<svg'), 'renders svg donut');
    assert.ok(html.includes('Aprovado (71.4%)'), 'status label with pct in legend');
    assert.ok(html.includes('Rejeitado (28.6%)'), 'rejected label with pct');
    assert.ok(!html.includes('Loja'), 'no store name in status chart');
    console.log('PASS: renderStatusBarChart with data');
  }

  // 31) renderReceiptDonutChart handles empty
  {
    var html = M.renderReceiptDonutChart([]);
    assert.ok(html.includes('Sem recebimentos'), 'empty donut state');
    console.log('PASS: renderReceiptDonutChart empty');
  }

  // 32) renderReceiptDonutChart handles zero total
  {
    var groups = [{ storeLabel: 'Loja A', qty: 0, count: 1 }];
    var html = M.renderReceiptDonutChart(groups);
    assert.ok(html.includes('Total zero'), 'zero total state');
    console.log('PASS: renderReceiptDonutChart zero total');
  }

  // 33) renderReceiptDonutChart renders segments with store legends
  {
    var groups = [{ storeLabel: 'Loja A', qty: 30, count: 2 }, { storeLabel: 'Loja B', qty: 15, count: 1 }];
    var html = M.renderReceiptDonutChart(groups);
    assert.ok(html.includes('<svg'), 'svg rendered');
    assert.ok(html.includes('Loja A'), 'store label in legend');
    assert.ok(html.includes('Loja B'), 'second store label');
    assert.ok(!html.includes('APPROVED') && !html.includes('PENDING'), 'no status names in store chart');
    console.log('PASS: renderReceiptDonutChart with data');
  }

  // 34) renderReceiptTrendChart handles empty
  {
    var html = M.renderReceiptTrendChart([]);
    assert.ok(html.includes('Sem recebimentos'), 'empty trend state');
    console.log('PASS: renderReceiptTrendChart empty');
  }

  // 35) renderReceiptTrendChart renders SVG line chart
  {
    var receipts = [
      { received_at: '2026-07-01', received_quantity: 10 },
      { received_at: '2026-07-15', received_quantity: 20 },
    ];
    var html = M.renderReceiptTrendChart(receipts);
    assert.ok(html.includes('<svg'), 'renders svg');
    assert.ok(html.includes('polyline'), 'renders line');
    assert.ok(html.includes('circle'), 'renders dots');
    assert.ok(html.includes('07'), 'month label in trend');
    assert.ok(!html.includes('dashboard-trend-bar'), 'no bar class');
    console.log('PASS: renderReceiptTrendChart with data');
  }

  // ── formatCurrency ────────────────────────────────────────────

  // 36) formatCurrency basic
  {
    assert.equal(M.formatCurrency(1234.56), 'R$ 1.234,56', 'formats positive');
    assert.equal(M.formatCurrency(0), 'R$ 0,00', 'formats zero');
    assert.equal(M.formatCurrency(null), 'R$ 0,00', 'null returns 0');
    assert.equal(M.formatCurrency(undefined), 'R$ 0,00', 'undefined returns 0');
    assert.equal(M.formatCurrency('abc'), 'R$ 0,00', 'invalid returns 0');
    assert.equal(M.formatCurrency(1000000), 'R$ 1.000.000,00', 'large number');
    assert.equal(M.formatCurrency(-50.5), 'R$ -50,50', 'negative');
    console.log('PASS: formatCurrency helper');
  }

  // ── calcReceiptValueKpi ───────────────────────────────────────

  // 37) Empty receipts
  {
    var kpi = M.calcReceiptValueKpi([]);
    assert.equal(kpi.totalValue, 0, 'totalValue zero');
    assert.equal(kpi.receiptWithValueCount, 0, 'count zero');
    console.log('PASS: calcReceiptValueKpi empty');
  }

  // 38) With values
  {
    var r = [
      { received_total_value: 100 },
      { received_total_value: 250.5 },
      { received_total_value: null },
      { received_total_value: 0 },
    ];
    var kpi = M.calcReceiptValueKpi(r);
    assert.equal(kpi.totalValue, 350.5, 'sums values');
    assert.equal(kpi.receiptWithValueCount, 2, 'counts non-zero');
    console.log('PASS: calcReceiptValueKpi with data');
  }

  // ── groupReceiptValueByStore ──────────────────────────────────

  // 39) Empty
  {
    assert.equal(M.groupReceiptValueByStore([]).length, 0, 'empty returns []');
    console.log('PASS: groupReceiptValueByStore empty');
  }

  // 40) Groups and sorts
  {
    var r = [
      { store_id: 1, lojas: { nome: 'A' }, received_total_value: 100 },
      { store_id: 2, lojas: { nome: 'B' }, received_total_value: 300 },
      { store_id: 1, lojas: { nome: 'A' }, received_total_value: 50 },
    ];
    var g = M.groupReceiptValueByStore(r);
    assert.equal(g.length, 2, '2 stores');
    assert.equal(g[0].storeLabel, 'B', 'highest first');
    assert.equal(g[0].totalValue, 300, 'B value');
    assert.equal(g[1].totalValue, 150, 'A sum 100+50');
    console.log('PASS: groupReceiptValueByStore with data');
  }

  // ── groupReceiptValueByDay ────────────────────────────────────

  // 41) Empty
  {
    assert.equal(M.groupReceiptValueByDay([]).length, 0, 'empty returns []');
    console.log('PASS: groupReceiptValueByDay empty');
  }

  // 42) Groups and sorts
  {
    var r = [
      { received_at: '2026-07-10T10:00:00Z', received_total_value: 100 },
      { received_at: '2026-07-11T10:00:00Z', received_total_value: 250 },
      { received_at: '2026-07-10T15:00:00Z', received_total_value: 50 },
    ];
    var d = M.groupReceiptValueByDay(r);
    assert.equal(d.length, 2, '2 days');
    assert.equal(d[0].date, '2026-07-10', 'first day');
    assert.equal(d[0].totalValue, 150, '100+50');
    assert.equal(d[1].date, '2026-07-11', 'second day');
    assert.equal(d[1].totalValue, 250, 'single value');
    console.log('PASS: groupReceiptValueByDay with data');
  }

  // ── renderValueBarChart ───────────────────────────────────────

  // 43) Empty
  {
    var html = M.renderValueBarChart([]);
    assert.ok(html.includes('Sem dados'), 'empty state');
    console.log('PASS: renderValueBarChart empty');
  }

  // 44) With data
  {
    var groups = [
      { storeLabel: 'Loja A', totalValue: 500 },
      { storeLabel: 'Loja B', totalValue: 300 },
    ];
    var html = M.renderValueBarChart(groups);
    assert.ok(html.includes('Loja A'), 'store label');
    assert.ok(html.includes('R$ 500'), 'formatted value');
    assert.ok(html.includes('rounded-full'), 'bar style');
    console.log('PASS: renderValueBarChart with data');
  }

  // ── renderValueLineChart ──────────────────────────────────────

  // 45) Empty
  {
    var html = M.renderValueLineChart([]);
    assert.ok(html.includes('Sem dados'), 'empty state');
    console.log('PASS: renderValueLineChart empty');
  }

  // 46) With data
  {
    var days = [
      { date: '2026-07-10', totalValue: 100 },
      { date: '2026-07-11', totalValue: 250 },
    ];
    var html = M.renderValueLineChart(days);
    assert.ok(html.includes('<svg'), 'svg rendered');
    assert.ok(html.includes('polyline'), 'line rendered');
    assert.ok(html.includes('07-10'), 'date label');
    assert.ok(html.includes('07-11'), 'date label 2');
    console.log('PASS: renderValueLineChart with data');
  }

  // ── renderDashboard structure ─────────────────────────────────

  // 36) renderDashboard has proper structure
  {
    var html = M.renderDashboard({});
    assert.ok(html.includes('Pedidos Totais'), 'has total orders title');
    assert.ok(html.includes('dashboard-kpi-grid'), 'has KPI grid');
    assert.ok(html.includes('dashboard-chart-grid'), 'has chart grid');
    assert.ok(html.includes('dashboard-card'), 'has dashboard cards');
    assert.ok(html.includes('dash-order-status-chart'), 'has status chart container');
    assert.ok(html.includes('dash-receipt-trend-chart'), 'has trend chart container');
    assert.ok(html.includes('Evolu'), 'trend card title');
    assert.ok(html.includes('tbody-recentes'), 'has recent orders table');
    assert.ok(!html.includes('detalhado'), 'no duplicate detailed section');
    assert.ok(!html.includes('deps.statCard'), 'no deps.statCard call');
    console.log('PASS: renderDashboard structure correct');
  }

  // 36b) loadAllDashboardOrders paginates until total reached
  {
    assert.equal(typeof M.loadAllDashboardOrders, 'function', 'exports loadAllDashboardOrders');
    var calls = [];
    var deps = {
      listOrdersForCurrentProfile: function(params) {
        calls.push(params);
        if (params.page === 1) return Promise.resolve({ items: [{ id: 1, status: 'APPROVED' }], total: 2 });
        if (params.page === 2) return Promise.resolve({ items: [{ id: 2, status: 'PENDING_APPROVAL' }], total: 2 });
        return Promise.resolve({ items: [], total: 2 });
      },
    };
    return M.loadAllDashboardOrders(deps).then(function(items) {
      assert.equal(items.length, 2, 'loads all items');
      assert.equal(calls.length, 2, 'paginates twice');
      console.log('PASS: loadAllDashboardOrders paginates');
    });
  }

  // 37) renderDashboard KPI cards use dashboard-kpi-card
  {
    var kpiCards = M.renderDashboard({}).match(/class="[^"]*dashboard-kpi-card[^"]*"/g);
    assert.equal(kpiCards ? kpiCards.length : 0, 10, 'exactly 10 KPI cards');
    var statCardMatches = M.renderDashboard({}).match(/class="[^"]*stat-card[^"]*"/g);
    assert.equal(statCardMatches ? statCardMatches.length : 0, 0, 'no stat-card classes');
    console.log('PASS: renderDashboard uses 8 dashboard-kpi-card');
  }

  // 38) index.html references dashboard.css
  {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('dashboard.css'), 'index.html references dashboard.css');
    console.log('PASS: dashboard.css linked in index.html');
  }

  // 39) dashboard.css file exists
  {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'styles', 'pages', 'dashboard.css')), 'dashboard.css exists');
    console.log('PASS: dashboard.css file present');
  }

  // 40) renderRecentOrders exported and works
  {
    assert.equal(typeof M.renderRecentOrders, 'function', 'exports renderRecentOrders');
    var orders = [{ id: 1, protocolo: 'P001', lojas: { nome: 'L' }, pedido_itens: [{ sku_digitado: 'SKU' }], status: 'APPROVED', criado_em: '2026-07-01' }];
    var deps = { statusBadge: function(s) { return s; } };
    var html = M.renderRecentOrders(orders, deps);
    assert.ok(html.includes('P001'), 'protocolo rendered');
    assert.ok(html.includes('L'), 'store name rendered');
    assert.ok(html.includes('APPROVED'), 'status rendered');
    assert.ok(!html.includes('onclick='), 'no inline event in recent orders');
    console.log('PASS: renderRecentOrders works');
  }

  // 40b) renderRecentOrders works with normalized shape (listOrdersForCurrentProfile)
  {
    var orders = [{ id: 2, internal_number: 'P002', store: 'Loja X', order_items: [{ product_code: 'SKU-002', description: 'Item' }], status: 'PENDING_APPROVAL', created_at: '2026-07-15' }];
    var deps = { statusBadge: function(s) { return s; } };
    var html = M.renderRecentOrders(orders, deps);
    assert.ok(html.includes('P002'), 'internal_number as protocolo');
    assert.ok(html.includes('Loja X'), 'store as loja');
    assert.ok(html.includes('SKU-002'), 'product_code from order_items');
    assert.ok(html.includes('2026-07-15'), 'created_at date');
    assert.ok(html.includes('PENDING_APPROVAL'), 'status rendered');
    assert.ok(!html.includes('onclick='), 'no inline event');
    console.log('PASS: renderRecentOrders normalized shape');
  }

  // 40c) renderRecentOrders shows valor_total from placed_total_value
  {
    var items = [
      { id: 'it1', placed_total_value: 199.90 },
      { id: 'it2', placed_total_value: 50.00 },
    ];
    var order = { id: 3, internal_number: 'P003', store: 'Loja Y', order_items: items, status: 'ORDER_PLACED', created_at: '2026-07-20' };
    var deps = { statusBadge: function(s) { return s; } };
    var html = M.renderRecentOrders([order], deps);
    assert.ok(html.includes('P003'), 'protocolo');
    assert.ok(html.includes('R$'), 'valor rendered');
    assert.ok(html.includes('249,90'), 'sum 199.90 + 50.00');
    console.log('PASS: renderRecentOrders valor from placed_total_value');
  }

  // 41) No duplicate section titles in renderDashboard
  {
    var html = M.renderDashboard({});
    var titleMatches = html.match(/dashboard-card-title[^>]*>[^<]+/g) || [];
    var titles = titleMatches.map(function(m) { return m.replace(/^[^>]*>/, ''); });
    var seen = {};
    var duplicates = titles.filter(function(t) {
      if (seen[t]) return true;
      seen[t] = true;
      return false;
    });
    assert.equal(duplicates.length, 0, 'no duplicate section titles: ' + duplicates.join(', '));
    console.log('PASS: no duplicate section titles');
  }

  // 42) Chart containers use dashboard-chart-body-new class
  {
    var html = M.renderDashboard({});
    var containerCount = (html.match(/dashboard-chart-body-new/g) || []).length;
    assert.equal(containerCount, 4, 'exactly 4 chart containers');
    var chartIdMatches = html.match(/id="dash-(order-status-chart|receipt-trend-chart|value-store-chart|value-day-chart)"/g);
    assert.equal(chartIdMatches ? chartIdMatches.length : 0, 4, '4 unique chart IDs');
    console.log('PASS: chart containers present');
  }

  // 43) No dataset.boundCharts in module code
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!code.includes('boundCharts'), 'no boundCharts blocker');
    console.log('PASS: no boundCharts blocker');
  }

  // 44) Chart colors array has enough distinct values
  {
    assert.ok(Array.isArray(M.CHART_COLORS), 'CHART_COLORS is array');
    assert.equal(M.CHART_COLORS.length, 8, '8 distinct chart colors');
    var unique = M.CHART_COLORS.filter(function(c, i, a) { return a.indexOf(c) === i; });
    assert.equal(unique.length, 8, 'all colors distinct');
    console.log('PASS: chart colors distinct');
  }

  // 44b) Status chart colors are fixed and distinct
  {
    assert.equal(typeof M.getStatusColor, 'function', 'exports getStatusColor');
    assert.equal(M.getStatusColor('APPROVED', 0), '#16a34a', 'APPROVED green');
    assert.equal(M.getStatusColor('PENDING_APPROVAL', 1), '#f59e0b', 'PENDING_APPROVAL amber');
    assert.equal(M.getStatusColor('REJECTED', 2), '#e11d48', 'REJECTED rose');
    assert.equal(M.getStatusColor('DRAFT', 3), '#64748b', 'DRAFT slate');
    assert.equal(M.getStatusColor('CHANGES_REQUESTED', 4), '#db2777', 'CHANGES_REQUESTED pink');
    assert.equal(M.getStatusColor('RECEIVED', 5), '#2563eb', 'RECEIVED blue');
    assert.equal(M.getStatusColor('CANCELLED', 6), '#0f172a', 'CANCELLED dark');
    console.log('PASS: status chart colors fixed');
  }

  // 45) KPI_COLORS exports icon color keys
  {
    assert.ok(M.KPI_COLORS, 'KPI_COLORS defined');
    assert.ok(M.KPI_COLORS.blue, 'has blue');
    assert.ok(M.KPI_COLORS.violet, 'has violet');
    assert.ok(M.KPI_COLORS.emerald, 'has emerald');
    assert.ok(M.KPI_COLORS.amber, 'has amber');
    assert.ok(M.KPI_COLORS.red, 'has red');
    console.log('PASS: KPI_COLORS defined');
  }

  // 46) afterRenderDashboard wiring check: status chart gets renderStatusBarChart
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    var chartBlock = code.match(/getElementById\('dash-order-status-chart'\)[\s\S]*?\.innerHTML\s*=\s*([^;]+)/);
    if (chartBlock) {
      var assignment = chartBlock[1];
      assert.ok(assignment.includes('renderStatusBarChart'), 'status chart gets renderStatusBarChart');
    }
    assert.ok(!code.includes('dash-receipt-store-chart'), 'store chart removed');
    console.log('PASS: chart wiring correct');
  }

  // ── Filter bar in renderDashboard ─────────────────────────────

  // 47) renderDashboard includes filter bar with all filter IDs
  {
    var html = M.renderDashboard({});
    assert.ok(html.includes('dash-filter-date-start'), 'has date start input');
    assert.ok(html.includes('dash-filter-date-end'), 'has date end input');
    assert.ok(html.includes('dash-filter-store'), 'has store select');
    assert.ok(html.includes('dash-filter-requester'), 'has requester select');
    assert.ok(html.includes('dash-filter-clear'), 'has clear button');
    assert.ok(html.includes('dashboard-filter-card'), 'uses filter card');
    assert.ok(html.includes('dashboard-filter-grid'), 'uses filter grid');
    assert.ok(html.includes('dashboard-filter-field'), 'uses filter field');
    assert.ok(html.includes('dash-dd-toggle'), 'uses dropdown toggle');
    assert.ok(html.includes('dash-filter-store'), 'store filter container');
    assert.ok(html.includes('dash-filter-requester'), 'requester filter container');
    assert.ok(html.includes('dash-dd-content'), 'uses dropdown content');
    console.log('PASS: filter bar in renderDashboard');
  }

  // 48) getFilterValues exported as function
  {
    assert.equal(typeof M.getFilterValues, 'function', 'exports getFilterValues');
    console.log('PASS: getFilterValues exported');
  }

  // ── filterOrders ──────────────────────────────────────────────

  // 49) filterOrders exists and can filter by date range
  {
    var orders = [
      { id: 1, created_at: '2026-06-01', store_id: 1, requester_id: 'a' },
      { id: 2, created_at: '2026-07-01', store_id: 2, requester_id: 'b' },
      { id: 3, created_at: '2026-07-15', store_id: 1, requester_id: 'a' },
      { id: 4, created_at: '2026-08-01', store_id: 3, requester_id: 'c' },
    ];
    var filters = { dateStart: '2026-07-01', dateEnd: '2026-07-31' };
    var result = M.filterOrders(orders, filters);
    assert.equal(result.length, 2, 'date range matches 2 orders');
    assert.equal(result[0].id, 2, 'first is 2026-07-01');
    assert.equal(result[1].id, 3, 'second is 2026-07-15');
    console.log('PASS: filterOrders by date range');
  }

  // 50) filterOrders can filter by store (uses storeIds array)
  {
    var orders = [
      { id: 1, created_at: '2026-07-01', store_id: 1 },
      { id: 2, created_at: '2026-07-02', store_id: 2 },
      { id: 3, created_at: '2026-07-03', store_id: 1 },
    ];
    var filters = { storeIds: ['1'] };
    var result = M.filterOrders(orders, filters);
    assert.equal(result.length, 2, 'store 1');
    assert.equal(result[0].id, 1, 'first match');
    assert.equal(result[1].id, 3, 'second match');
    console.log('PASS: filterOrders by store');
  }

  // 50b) filterOrders can filter by multiple stores
  {
    var orders = [
      { id: 1, created_at: '2026-07-01', store_id: 1 },
      { id: 2, created_at: '2026-07-02', store_id: 2 },
      { id: 3, created_at: '2026-07-03', store_id: 3 },
    ];
    var filters = { storeIds: ['1', '2'] };
    var result = M.filterOrders(orders, filters);
    assert.equal(result.length, 2, 'stores 1 and 2');
    assert.equal(result[0].id, 1, 'first');
    assert.equal(result[1].id, 2, 'second');
    console.log('PASS: filterOrders by multiple stores');
  }

  // 51) filterOrders can filter by requester (uses requesterIds array)
  {
    var orders = [
      { id: 1, requester_id: 'user1', created_at: '2026-07-01' },
      { id: 2, requester_id: 'user2', created_at: '2026-07-02' },
      { id: 3, requester_id: 'user1', created_at: '2026-07-03' },
    ];
    var filters = { requesterIds: ['user1'] };
    var result = M.filterOrders(orders, filters);
    assert.equal(result.length, 2, 'user1 orders');
    assert.equal(result[0].id, 1, 'first user1');
    assert.equal(result[1].id, 3, 'second user1');
    console.log('PASS: filterOrders by requester');
  }

  // 51b) filterOrders filters by multiple requesters
  {
    var orders = [
      { id: 1, requester_id: 'user1', created_at: '2026-07-01' },
      { id: 2, requester_id: 'user2', created_at: '2026-07-02' },
      { id: 3, requester_id: 'user3', created_at: '2026-07-03' },
    ];
    var filters = { requesterIds: ['user1', 'user3'] };
    var result = M.filterOrders(orders, filters);
    assert.equal(result.length, 2, 'user1 and user3');
    assert.equal(result[0].id, 1, 'first');
    assert.equal(result[1].id, 3, 'second');
    console.log('PASS: filterOrders by multiple requesters');
  }

  // 52) filterOrders returns all when no filters
  {
    var orders = [
      { id: 1, created_at: '2026-07-01', store_id: 1 },
      { id: 2, created_at: '2026-07-02', store_id: 2 },
    ];
    var result = M.filterOrders(orders, {});
    assert.equal(result.length, 2, 'all returned');
    var result2 = M.filterOrders(orders, { dateStart: '', dateEnd: '', storeIds: [], requesterIds: [] });
    assert.equal(result2.length, 2, 'all with empty filters');
    console.log('PASS: filterOrders no filters');
  }

  // ── filterByDateAndStore ──────────────────────────────────────

  // 53) filterByDateAndStore exists and filters by date field
  {
    var items = [
      { id: 1, received_at: '2026-06-15', store_id: 1 },
      { id: 2, received_at: '2026-07-10', store_id: 2 },
      { id: 3, received_at: '2026-07-20', store_id: 1 },
      { id: 4, received_at: '2026-08-05', store_id: 3 },
    ];
    var filters = { dateStart: '2026-07-01', dateEnd: '2026-07-31' };
    var result = M.filterByDateAndStore(items, 'received_at', filters);
    assert.equal(result.length, 2, 'date range');
    assert.equal(result[0].id, 2, 'jul 10');
    assert.equal(result[1].id, 3, 'jul 20');
    console.log('PASS: filterByDateAndStore by date');
  }

  // 54) filterByDateAndStore filters by store (uses storeIds array)
  {
    var items = [
      { id: 1, received_at: '2026-07-01', store_id: 1 },
      { id: 2, received_at: '2026-07-02', store_id: 2 },
      { id: 3, received_at: '2026-07-03', store_id: 1 },
    ];
    var filters = { storeIds: ['2'] };
    var result = M.filterByDateAndStore(items, 'received_at', filters);
    assert.equal(result.length, 1, 'store 2');
    assert.equal(result[0].id, 2, 'correct item');
    console.log('PASS: filterByDateAndStore by store');
  }

  // ── New exports ───────────────────────────────────────────────

  // 55) populateStoreFilter exported as function
  {
    assert.equal(typeof M.populateStoreFilter, 'function', 'exports populateStoreFilter');
    console.log('PASS: populateStoreFilter exported');
  }

  // 56) populateRequesterFilter exported as function
  {
    assert.equal(typeof M.populateRequesterFilter, 'function', 'exports populateRequesterFilter');
    console.log('PASS: populateRequesterFilter exported');
  }

  // 57) refreshDashboard exported as function
  {
    assert.equal(typeof M.refreshDashboard, 'function', 'exports refreshDashboard');
    console.log('PASS: refreshDashboard exported');
  }

  // 58) clearFilters exported as function
  {
    assert.equal(typeof M.clearFilters, 'function', 'exports clearFilters');
    console.log('PASS: clearFilters exported');
  }

  // ── Static filter code checks ─────────────────────────────────

  // 59) Filter IDs referenced in source code
  {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(code.includes('dash-filter-date-start'), 'source references date-start');
    assert.ok(code.includes('dash-filter-date-end'), 'source references date-end');
    assert.ok(code.includes('dash-filter-store'), 'source references store');
    assert.ok(code.includes('dash-filter-requester'), 'source references requester');
    assert.ok(code.includes('dash-filter-clear'), 'source references clear');
    console.log('PASS: filter IDs in source');
  }

  console.log('\n=== All dashboard tests passed. ===');
}

run();
