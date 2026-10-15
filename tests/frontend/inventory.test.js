const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODULE_DATA_PATH = path.join(ROOT, 'public', 'js', 'pages', 'inventory', 'inventory-data.js');
const MODULE_PATH = path.join(ROOT, 'public', 'js', 'pages', 'inventory', 'inventory-module.js');
const PAGE_PATH = path.join(ROOT, 'public', 'pages', 'estoque.html');
const CSS_PATH = path.join(ROOT, 'public', 'styles', 'pages', 'inventory.css');

async function run() {
  console.log('=== Inventory Frontend Tests ===\n');

  // ── Core module tests ──────────────────────────────────────────

  // 1) inventory-data.js exists and exports StockCheckDataModule
  {
    assert.ok(fs.existsSync(MODULE_DATA_PATH), 'inventory-data.js must exist');
    const content = fs.readFileSync(MODULE_DATA_PATH, 'utf8');
    assert.ok(content.includes('StockCheckDataModule'), 'inventory-data.js must expose StockCheckDataModule');
    assert.ok(content.includes('loadReceivedStock'), 'inventory-data.js must have loadReceivedStock');
    assert.ok(!content.includes('InventoryDataModule'), 'inventory-data.js must not expose old InventoryDataModule');
    assert.ok(!content.includes('inventory_items'), 'inventory-data.js must not reference old inventory_items');
    assert.ok(!content.includes('inventory_movements'), 'inventory-data.js must not reference old inventory_movements');
    console.log('PASS: inventory-data.js uses new StockCheckDataModule');
  }

  // 2) inventory-module.js exists and exports StockCheckModule (with export)
  {
    assert.ok(fs.existsSync(MODULE_PATH), 'inventory-module.js must exist');
    const content = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(content.includes('StockCheckModule'), 'inventory-module.js must expose StockCheckModule');
    assert.ok(content.includes('afterRenderEstoque'), 'inventory-module.js must have afterRenderEstoque');
    assert.ok(content.includes('renderReceivedTable'), 'inventory-module.js must have renderReceivedTable');
    assert.ok(content.includes('getStoreLabel'), 'inventory-module.js must have getStoreLabel');
    assert.ok(content.includes('exportCsv'), 'inventory-module.js must have exportCsv');
    assert.ok(content.includes('exportXlsx'), 'inventory-module.js must have exportXlsx');
    assert.ok(content.includes('statusLabel'), 'inventory-module.js must have statusLabel (used by export)');
    assert.ok(content.includes('allChecks'), 'inventory-module.js must have allChecks (loaded for export)');
    assert.ok(!content.includes('InventoryModule'), 'inventory-module.js must not expose old InventoryModule');
    assert.ok(!content.includes('InventoryDataModule'), 'inventory-module.js must not reference old InventoryDataModule');
    assert.ok(!content.includes('statusBadgeClass'), 'inventory-module.js must not have statusBadgeClass (checks render removed)');
    assert.ok(!content.includes('renderTable('), 'inventory-module.js must not have renderTable (checks table removed)');
    assert.ok(!content.includes('showBothTables'), 'inventory-module.js must not have showBothTables (single table)');
    assert.ok(!content.includes('sc-filtro-status'), 'inventory-module.js must not reference status filter');
    console.log('PASS: inventory-module.js uses new StockCheckModule (received+export)');
  }

  // 3) estoque.html uses sc- prefixed IDs, no status filter, has checks table (admin) + received table
  {
    assert.ok(fs.existsSync(PAGE_PATH), 'estoque.html must exist');
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-busca'), 'estoque.html must have sc-busca search input');
    assert.ok(html.includes('sc-filtro-loja'), 'estoque.html must have sc-filtro-loja filter');
    assert.ok(html.includes('sc-loading'), 'estoque.html must have sc-loading');
    assert.ok(html.includes('sc-error'), 'estoque.html must have sc-error');
    assert.ok(html.includes('sc-empty'), 'estoque.html must have sc-empty');
    assert.ok(html.includes('sc-received-tbody'), 'estoque.html must have sc-received-tbody');
    assert.ok(html.includes('sc-received-counter'), 'estoque.html must have sc-received-counter');
    assert.ok(html.includes('sc-checks-tbody'), 'estoque.html must have sc-checks-tbody (admin)');
    assert.ok(html.includes('sc-checks-counter'), 'estoque.html must have sc-checks-counter (admin)');
    assert.ok(html.includes('sc-export-btn'), 'estoque.html must have sc-export-btn');
    assert.ok(html.includes('sc-export-menu'), 'estoque.html must have sc-export-menu');
    assert.ok(html.includes('sc-export-csv'), 'estoque.html must have sc-export-csv');
    assert.ok(html.includes('sc-export-xlsx'), 'estoque.html must have sc-export-xlsx');
    assert.ok(html.includes('stock-toolbar-card'), 'estoque.html must use stock-toolbar-card');
    assert.ok(html.includes('stock-table-card'), 'estoque.html must use stock-table-card');
    assert.ok(!html.includes('sc-filtro-status'), 'estoque.html must not have status filter');
    assert.ok(!html.includes('inv-busca'), 'estoque.html must not have inv-busca');
    assert.ok(html.includes('Carregando itens recebidos'), 'estoque.html must show received loading text');
    assert.ok(html.includes('sc-edit-modal'), 'estoque.html must have edit modal');
    console.log('PASS: estoque.html has received UI, admin checks table, and edit modal');
  }

  // 4) CSS uses stock- prefix classes, has export styles
  {
    assert.ok(fs.existsSync(CSS_PATH), 'inventory.css must exist');
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('.stock-toolbar-card'), 'inventory.css must define .stock-toolbar-card');
    assert.ok(css.includes('.stock-table-card'), 'inventory.css must define .stock-table-card');
    assert.ok(css.includes('.stock-table'), 'inventory.css must define .stock-table');
    assert.ok(css.includes('.stock-filter-control'), 'inventory.css must define .stock-filter-control');
    assert.ok(css.includes('.stock-state'), 'inventory.css must define .stock-state');
    assert.ok(css.includes('.stock-export-btn'), 'inventory.css must have .stock-export-btn');
    assert.ok(css.includes('.stock-export-menu'), 'inventory.css must have .stock-export-menu');
    assert.ok(!css.includes('.inv-'), 'inventory.css must not have old inv- prefix classes');
    console.log('PASS: inventory.css has stock- prefix and export styles');
  }

  // 5) No old inventory references in index.html
  {
    const indexPath = path.join(ROOT, 'public', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.ok(!html.includes('inventory-read'), 'index.html must not reference inventory-read resource');
    assert.ok(!html.includes('inventory-admin'), 'index.html must not reference inventory-admin resource');
    assert.ok(html.includes('stock-checks-read'), 'index.html must reference stock-checks-read resource');
    assert.ok(html.includes('stock-checks-admin'), 'index.html must reference stock-checks-admin resource');
    console.log('PASS: index.html uses stock-checks resources');
  }

  // 6) No old inventory route in app-shell
  {
    const appShellPath = path.join(ROOT, 'public', 'js', 'core', 'app-shell.js');
    const shell = fs.readFileSync(appShellPath, 'utf8');
    assert.ok(shell.includes('stock-checks-read'), 'app-shell must use stock-checks-read resource');
    assert.ok(shell.includes('StockCheckModule'), 'app-shell must reference StockCheckModule');
    assert.ok(!shell.includes('InventoryModule'), 'app-shell must not reference old InventoryModule');
    assert.ok(!shell.includes('inventory-read'), 'app-shell must not reference inventory-read');
    assert.ok(shell.includes('afterRenderEstoque'), 'app-shell must still use afterRenderEstoque');
    console.log('PASS: app-shell uses correct resource and module');
  }

  // 7) Dashboard does not use InventoryDataModule
  {
    const dashPath = path.join(ROOT, 'public', 'js', 'pages', 'dashboard', 'dashboard-module.js');
    const dash = fs.readFileSync(dashPath, 'utf8');
    assert.ok(!dash.includes('InventoryDataModule.loadAllItems'), 'dashboard must not call loadAllItems');
    assert.ok(!dash.includes('inventoryItems.forEach'), 'dashboard must not iterate inventory items');
    assert.ok(!dash.includes('inventoryMap'), 'dashboard must not build inventory map');
    console.log('PASS: dashboard no longer loads inventory data');
  }

  // 8) No inventory_items references in frontend JS (excluding dashboard)
  {
    function walk(dir) {
      const result = [];
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          result.push(...walk(full));
        } else if (entry.endsWith('.js')) {
          result.push(full);
        }
      }
      return result;
    }
    const frontendDirs = [
      path.join(ROOT, 'public', 'js', 'core'),
      path.join(ROOT, 'public', 'js', 'pages'),
      path.join(ROOT, 'public', 'js', 'shared'),
    ];
    for (const dir of frontendDirs) {
      for (const fullPath of walk(dir)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('inventory_items') && !fullPath.includes('dashboard')) {
          assert.fail(`${fullPath} must not reference inventory_items`);
        }
      }
    }
    console.log('PASS: no frontend JS references inventory_items');
  }

  // 9) No generic inventory CRUD APIs in Express route
  {
    const routeFiles = fs.readdirSync(path.join(ROOT, 'src', 'server', 'routes'));
    for (const file of routeFiles) {
      const fullPath = path.join(ROOT, 'src', 'server', 'routes', file);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(!content.includes('createInventoryItem'), `${file} must not have createInventoryItem`);
      assert.ok(!content.includes('updateInventoryItem'), `${file} must not have updateInventoryItem`);
      assert.ok(!content.includes('adjustInventoryQuantity'), `${file} must not have adjustInventoryQuantity`);
    }
    console.log('PASS: no generic inventory CRUD in Express routes');
  }

  // 10) Stock check route exists
  {
    const routePath = path.join(ROOT, 'src', 'server', 'routes', 'stock-checks.js');
    assert.ok(fs.existsSync(routePath), 'stock-checks.js route must exist');
    const content = fs.readFileSync(routePath, 'utf8');
    assert.ok(content.includes('createStockCheckRouter'), 'stock-checks.js must export createStockCheckRouter');
    assert.ok(content.includes('createReceivedStockRouter'), 'stock-checks.js must export createReceivedStockRouter');
    console.log('PASS: stock-checks route exists');
  }

  // 11) App.js uses stock-checks route
  {
    const appPath = path.join(ROOT, 'src', 'server', 'app.js');
    const content = fs.readFileSync(appPath, 'utf8');
    assert.ok(content.includes('stock-checks'), 'app.js must use stock-checks route');
    assert.ok(content.includes('received-stock'), 'app.js must use received-stock route');
    assert.ok(!content.includes('createInventoryAdminRouter'), 'app.js must not use inventory route');
    assert.ok(!content.includes('/api/admin/inventory'), 'app.js must not register inventory route');
    console.log('PASS: app.js uses correct routes');
  }

  // 12) Admin service has correct methods
  {
    const servicePath = path.join(ROOT, 'src', 'server', 'services', 'supabase-admin-service.js');
    const content = fs.readFileSync(servicePath, 'utf8');
    assert.ok(!content.includes('listInventoryItems'), 'service must not have listInventoryItems');
    assert.ok(!content.includes('createInventoryItem'), 'service must not have createInventoryItem');
    assert.ok(!content.includes('adjustInventoryQuantity'), 'service must not have adjustInventoryQuantity');
    assert.ok(content.includes('listStockChecks'), 'service must have listStockChecks');
    assert.ok(content.includes('updateStockCheck'), 'service must have updateStockCheck');
    assert.ok(content.includes('listReceivedStock'), 'service must have listReceivedStock');
    console.log('PASS: admin service has correct methods');
  }

  // 13) Cloudflare Pages Functions match new model
  {
    const stockChecksIndex = path.join(ROOT, 'functions', 'api', 'admin', 'stock-checks', 'index.js');
    const receivedStock = path.join(ROOT, 'functions', 'api', 'admin', 'received-stock', 'index.js');
    assert.ok(fs.existsSync(stockChecksIndex), 'functions stock-checks/index.js must exist');
    assert.ok(fs.existsSync(receivedStock), 'functions received-stock/index.js must exist');
    assert.ok(!fs.existsSync(path.join(ROOT, 'functions', 'api', 'admin', 'inventory')), 'old inventory function directory must not exist');
    console.log('PASS: Pages Functions match new model');
  }

  // 14) No inventory_items pages function files remain
  {
    const funcDir = path.join(ROOT, 'functions', 'api', 'admin');
    const entries = fs.readdirSync(funcDir, { withFileTypes: true });
    const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(!dirNames.includes('inventory'), 'inventory function dir must be removed');
    assert.ok(dirNames.includes('stock-checks'), 'stock-checks function dir must exist');
    assert.ok(dirNames.includes('received-stock'), 'received-stock function dir must exist');
    console.log('PASS: inventory function directory removed');
  }

  // 15) Migration 20260706 exists
  {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir);
    assert.ok(files.includes('20260706000000_correct_stock_lifecycle.sql'), 'correct stock lifecycle migration must exist');
    console.log('PASS: corrected migration exists');
  }

  // ── Data + render tests ─────────────────────────────────────────

  // 16) inventory-module.js loads checks (for export) + received stock
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('allChecks'), 'module must track allChecks for export');
    assert.ok(mod.includes('allReceipts'), 'module must track allReceipts');
    assert.ok(mod.includes('filteredChecks'), 'module must track filteredChecks');
    assert.ok(mod.includes('filteredReceipts'), 'module must track filteredReceipts');
    assert.ok(mod.includes('loadOrderItemChecks'), 'module must call loadOrderItemChecks (for export)');
    assert.ok(mod.includes('loadReceivedStock'), 'module must call loadReceivedStock');
    assert.ok(mod.includes('renderReceivedTable'), 'module must have renderReceivedTable');
    assert.ok(mod.includes('sc-received-tbody'), 'module must reference sc-received-tbody');
    assert.ok(mod.includes('sc-received-section'), 'module must reference sc-received-section');
    assert.ok(mod.includes('sc-received-counter'), 'module must reference sc-received-counter');
    assert.ok(mod.includes('receipts'), 'module must track receipts in getState');
    assert.ok(!mod.includes('sc-received-header'), 'module must not have sc-received-header (removed)');
    console.log('PASS: inventory-module.js loads checks + received stock');
  }

  // 17) Empty state when no receipts (admin checks also hidden)
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('!receipts.length'), 'empty state must check receipt list length');
    assert.ok(!mod.includes('!list.length &&'), 'module must not have compound empty check');
    assert.ok(mod.includes('sc-checks-section'), 'module must toggle check section visibility');
    console.log('PASS: empty state checks only receipts');
  }

  // 18) estoque.html has received stock DOM elements + admin checks table
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-received-counter'), 'estoque.html must have sc-received-counter');
    assert.ok(html.includes('sc-received-tbody'), 'estoque.html must have sc-received-tbody');
    assert.ok(html.includes('Qtd. recebida'), 'estoque.html must have received quantity column');
    assert.ok(html.includes('Unidade'), 'estoque.html must have unit column');
    assert.ok(html.includes('NF'), 'estoque.html must have invoice number column');
    assert.ok(html.includes('Valor unit.'), 'estoque.html must have unit value column');
    assert.ok(html.includes('Valor total'), 'estoque.html must have total value column');
    assert.ok(html.includes('Recebido em'), 'estoque.html must have received date column');
    assert.ok(!html.includes('sc-received-header'), 'estoque.html must not have old sc-received-header wrapper');
    console.log('PASS: estoque.html has received stock DOM elements + admin checks table');
  }

  // 19) inventory-data.js selects lojas in received query
  {
    const data = fs.readFileSync(MODULE_DATA_PATH, 'utf8');
    assert.ok(data.includes('lojas(id,codigo,nome)'), 'inventory-data.js must select lojas in store_stock_receipts');
    console.log('PASS: inventory-data.js selects lojas relation');
  }

  // 20) inventory-module.js has loja filter logic
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('getStoreLabel'), 'module must have getStoreLabel helper');
    assert.ok(mod.includes('populateStoreFilter'), 'module must have populateStoreFilter');
    assert.ok(mod.includes('sc-filtro-loja'), 'module must reference sc-filtro-loja');
    assert.ok(mod.includes('lojaFilter'), 'module must filter by lojaFilter');
    assert.ok(mod.includes('Todas as lojas'), 'module must populate store filter options');
    assert.ok(!mod.includes('sc-filtro-status'), 'module must not reference status filter');
    console.log('PASS: inventory-module.js has loja filter logic (no status filter)');
  }

  // 21) estoque.html has two tables: checks (8 cols) + received (6 cols), colgroups, centered headers
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('colgroup'), 'estoque.html must have colgroup elements');
    assert.ok(html.includes('stock-col-loja'), 'estoque.html must have stock-col-loja col class');
    assert.ok(html.includes('stock-col-sku'), 'estoque.html must have stock-col-sku col class');
    assert.ok(html.includes('stock-col-desc'), 'estoque.html must have stock-col-desc col class');
    assert.ok(html.includes('stock-col-date'), 'estoque.html must have stock-col-date col class');
    assert.ok(html.includes('stock-col-unit'), 'estoque.html must have stock-col-unit col class');
    assert.ok(html.includes('stock-col-invoice'), 'estoque.html must have stock-col-invoice col class');
    assert.ok(html.includes('stock-col-value'), 'estoque.html must have stock-col-value col class');
    assert.ok(html.includes('stock-col-status'), 'estoque.html must have stock-col-status col class (checks)');
    assert.ok(html.includes('stock-col-avail'), 'estoque.html must have stock-col-avail col class (checks)');
    assert.ok(html.includes('sc-filtro-loja'), 'estoque.html must have sc-filtro-loja select');
    assert.ok(html.includes('Todas as lojas'), 'estoque.html must have Todas as lojas option');
    assert.ok(html.includes('sc-received-tbody'), 'estoque.html must have received tbody');
    assert.ok(html.includes('sc-checks-tbody'), 'estoque.html must have checks tbody');
    // Checks table headers
    var statusHeaders = html.match(/<th[^>]*>Status<\/th>/g);
    assert.ok(statusHeaders && statusHeaders.length >= 1, 'checks table must have Status header');
    var actionHeaders = html.match(/<th[^>]*>Ação<\/th>/g);
    assert.ok(actionHeaders && actionHeaders.length >= 1, 'checks table must have Ação header');
    console.log('PASS: estoque.html has two tables (checks+received), colgroups, headers');
  }

  // 22) inventory-module.js renders centered cells, Loja first, store name only
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    var firstStore = mod.indexOf('getStoreLabel(item)');
    var firstSku = mod.indexOf('escapeHtml(item.product_code)');
    assert.ok(firstStore > -1 && firstSku > -1, 'renderReceivedTable must have Loja and SKU cells');
    assert.ok(firstStore < firstSku, 'renderReceivedTable: getStoreLabel before product_code');
    var centerTdCount = (mod.match(/table-td text-center/g) || []).length;
    assert.ok(centerTdCount >= 6, 'renderReceivedTable must have text-center on td cells (' + centerTdCount + ' found)');
    assert.ok(mod.includes('item.lojas && item.lojas.nome'), 'getStoreLabel must use nome only');
    assert.ok(!mod.includes('item.lojas.codigo'), 'getStoreLabel must not reference codigo');
    // renderReceivedTable uses only received fields; checks-only fields used by export functions
    console.log('PASS: inventory-module.js renders centered cells, Loja first, store name only');
  }

  // 23) CSS has fixed table layout and column width classes (admin + received)
  {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('table-layout: fixed'), 'inventory.css must have table-layout: fixed');
    assert.ok(css.includes('min-width'), 'inventory.css must have min-width on stock-table');
    assert.ok(css.includes('.stock-col-loja'), 'inventory.css must define .stock-col-loja');
    assert.ok(css.includes('.stock-col-sku'), 'inventory.css must define .stock-col-sku');
    assert.ok(css.includes('.stock-col-desc'), 'inventory.css must define .stock-col-desc');
    assert.ok(css.includes('.stock-col-qty'), 'inventory.css must define .stock-col-qty');
    assert.ok(css.includes('.stock-col-date'), 'inventory.css must define .stock-col-date');
    assert.ok(css.includes('.stock-col-status'), 'inventory.css must have status column class (admin checks)');
    assert.ok(css.includes('.stock-col-avail'), 'inventory.css must have available column class (admin checks)');
    assert.ok(css.includes('.stock-col-invoice'), 'inventory.css must have .stock-col-invoice');
    assert.ok(css.includes('.stock-col-value'), 'inventory.css must have .stock-col-value');
    console.log('PASS: inventory.css has fixed layout and column widths');
  }

  // ── Export tests ─────────────────────────────────────────────────

  // 24) Export helpers exist in module
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('escapeCsv'), 'module must have escapeCsv');
    assert.ok(mod.includes('downloadBlob'), 'module must have downloadBlob');
    assert.ok(mod.includes('buildCsvRows'), 'module must have buildCsvRows');
    assert.ok(mod.includes('exportCsv'), 'module must have exportCsv');
    assert.ok(mod.includes('exportXlsx'), 'module must have exportXlsx');
    assert.ok(mod.includes('getStoreName'), 'module must have getStoreName');
    assert.ok(mod.includes('toggleExportMenu'), 'module must have toggleExportMenu');
    assert.ok(mod.includes('closeExportMenu'), 'module must have closeExportMenu');
    assert.ok(mod.includes('XLSX.utils.book_new'), 'module must create XLSX workbook');
    assert.ok(mod.includes('XLSX.writeFile'), 'module must call XLSX.writeFile');
    console.log('PASS: export helpers exist');
  }

  // 25) CSV injection guard
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('/^[=+\\-@\\t\\r]/'), 'escapeCsv must guard against CSV injection (=, +, -, @)');
    assert.ok(mod.includes("'\"'"), 'escapeCsv must double-quote values containing quotes');
    assert.ok(mod.includes("join(';')"), 'CSV uses ; separator');
    assert.ok(mod.includes('\\uFEFF'), 'CSV includes BOM');
    assert.ok(mod.includes('Blob'), 'module creates Blob for download');
    assert.ok(mod.includes('URL.createObjectURL'), 'module uses createObjectURL');
    console.log('PASS: CSV injection guard and format correct');
  }

  // 26) Export data includes both checks and receipts with Loja first
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('filteredChecks'), 'export uses filteredChecks');
    assert.ok(mod.includes('filteredReceipts'), 'export uses filteredReceipts');
    assert.ok(mod.includes('Loja;Tipo;Produto / SKU;'), 'CSV header has Loja first');
    assert.ok(mod.includes('Solicitado'), 'CSV includes Solicitado type');
    assert.ok(mod.includes('Recebido'), 'CSV includes Recebido type');
    assert.ok(mod.includes('NF'), 'CSV includes NF column');
    assert.ok(mod.includes('Valor unit.'), 'CSV includes unit value column');
    assert.ok(mod.includes('Valor total'), 'CSV includes total value column');
    assert.ok(mod.includes('filteredChecks.length'), 'exportCsv checks length');
    assert.ok(mod.includes('filteredReceipts.length'), 'exportCsv checks receipts length');
    console.log('PASS: export includes both datasets with Loja first');
  }

  // 27) XLSX uses existing XLSX library with two sheets
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes("'Solicitados'"), 'XLSX checks sheet named Solicitados');
    assert.ok(mod.includes("'Recebidos'"), 'XLSX receipts sheet named Recebidos');
    assert.ok(mod.includes('json_to_sheet'), 'XLSX uses json_to_sheet');
    assert.ok(mod.includes('book_append_sheet'), 'XLSX uses book_append_sheet');
    assert.ok(mod.includes('book_new'), 'XLSX uses book_new');
    assert.ok(mod.includes('Loja'), 'XLSX objects have Loja key');
    assert.ok(mod.includes('Produto / SKU'), 'XLSX objects have Produto key');
    assert.ok(mod.includes('NF'), 'XLSX objects have NF key');
    assert.ok(mod.includes('Valor unit.'), 'XLSX objects have unit value key');
    assert.ok(mod.includes('Valor total'), 'XLSX objects have total value key');
    console.log('PASS: XLSX exports two sheets with invoice/value fields');
  }

  // 28) No sensitive fields in export
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(!mod.includes('received_by'), 'module must not export received_by');
    assert.ok(!mod.includes('checked_by'), 'module must not export checked_by');
    assert.ok(!mod.includes('escapeCsv(item.store_id)'), 'CSV export must not include raw store_id');
    assert.ok(!mod.includes('accessToken'), 'module must not export tokens');
    assert.ok(!mod.includes('service_role'), 'module must not reference service_role');
    console.log('PASS: no sensitive fields exported');
  }

  // 29) Export menu events bound
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('sc-export-btn'), 'module binds sc-export-btn');
    assert.ok(mod.includes('sc-export-csv'), 'module binds sc-export-csv');
    assert.ok(mod.includes('sc-export-xlsx'), 'module binds sc-export-xlsx');
    assert.ok(mod.includes('aria-expanded'), 'module uses aria-expanded for accessibility');
    assert.ok(mod.includes('onDocClick'), 'module closes menu on outside click');
    assert.ok(mod.includes('exportMenuOpen'), 'module tracks menu open state');
    console.log('PASS: export menu events bound');
  }

  // 30) No import feature
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(!mod.includes('import'), 'module must not have import logic');
    assert.ok(!html.includes('import'), 'estoque.html must not have import UI');
    console.log('PASS: no import feature added');
  }

  // ── Admin row edit tests ────────────────────────────────────────

  // 31) Admin checks table section in estoque.html
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-checks-section'), 'estoque.html must have sc-checks-section');
    assert.ok(html.includes('sc-checks-tbody'), 'estoque.html must have sc-checks-tbody');
    assert.ok(html.includes('sc-checks-counter'), 'estoque.html must have sc-checks-counter');
    assert.ok(html.includes('Status'), 'checks table must have Status header');
    assert.ok(html.includes('Disponível'), 'checks table must have Disponível header');
    assert.ok(html.includes('Ação'), 'checks table must have Ação header');
    assert.ok(html.includes('stock-col-status'), 'checks table must have stock-col-status col class');
    assert.ok(html.includes('stock-col-avail'), 'checks table must have stock-col-avail col class');
    assert.ok(!html.includes('stock-checks-card'), 'checks card styling exists'); // ponytail: quick assertion
    console.log('PASS: estoque.html has admin checks table section');
  }

  // 32) Edit modal in estoque.html
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-edit-modal'), 'estoque.html must have sc-edit-modal');
    assert.ok(html.includes('sc-edit-status'), 'modal must have sc-edit-status');
    assert.ok(html.includes('sc-edit-qty'), 'modal must have sc-edit-qty');
    assert.ok(html.includes('sc-edit-notes'), 'modal must have sc-edit-notes');
    assert.ok(html.includes('sc-edit-order-item-id'), 'modal must have sc-edit-order-item-id');
    assert.ok(html.includes('sc-edit-save'), 'modal must have sc-edit-save button');
    assert.ok(html.includes('sc-edit-cancel'), 'modal must have sc-edit-cancel button');
    assert.ok(html.includes('sc-edit-modal-close'), 'modal must have close button');
    assert.ok(html.includes('pending_check'), 'modal must have pending_check option');
    assert.ok(html.includes('in_stock'), 'modal must have in_stock option');
    assert.ok(html.includes('partial_stock'), 'modal must have partial_stock option');
    assert.ok(html.includes('out_of_stock'), 'modal must have out_of_stock option');
    assert.ok(html.includes('needs_purchase'), 'modal must have needs_purchase option');
    assert.ok(html.includes('users-modal'), 'modal uses users-modal pattern');
    assert.ok(html.includes('users-modal-panel'), 'modal uses users-modal-panel');
    console.log('PASS: estoque.html has edit modal');
  }

  // 33) Module has admin detection and admin-specific functions
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('isAdmin'), 'module must track isAdmin');
    assert.ok(mod.includes('currentUser.papel'), 'module must check papel for admin');
    assert.ok(mod.includes('renderChecksTable'), 'module must have renderChecksTable');
    assert.ok(mod.includes('renderReceivedTable'), 'module must still have renderReceivedTable');
    assert.ok(mod.includes('openEditModal'), 'module must have openEditModal');
    assert.ok(mod.includes('closeEditModal'), 'module must have closeEditModal');
    assert.ok(mod.includes('saveEdit'), 'module must have saveEdit');
    assert.ok(mod.includes('updateNotesCounter'), 'module must have updateNotesCounter');
    assert.ok(mod.includes('updateChecksActionCol'), 'module must have updateChecksActionCol');
    assert.ok(mod.includes('sc-edit-modal'), 'module must reference sc-edit-modal');
    assert.ok(mod.includes('stock-badge'), 'module must use stock-badge for status');
    assert.ok(mod.includes('updateStockCheck'), 'module must call updateStockCheck');
    assert.ok(!mod.includes('admin-checks'), 'ponytail: admin prefix not used, checks section only');
    console.log('PASS: module has admin detection and edit functions');
  }

  // 34) Module exports admin-specific functions
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('openEditModal: openEditModal'), 'module must export openEditModal');
    assert.ok(mod.includes('closeEditModal: closeEditModal'), 'module must export closeEditModal');
    assert.ok(mod.includes('saveEdit: saveEdit'), 'module must export saveEdit');
    assert.ok(mod.includes('renderChecksTable: renderChecksTable'), 'module must export renderChecksTable');
    console.log('PASS: module exports admin-specific functions');
  }

  // 35) Checks table renders edit button via isAdmin conditional
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('data-inv-action="edit"'), 'checks table row must have data-inv-action="edit"');
    assert.ok(mod.includes('data-order-item-id'), 'checks table row must have data-order-item-id');
    assert.ok(mod.includes('closest'), 'edit events use closest delegation');
    assert.ok(mod.includes('isAdmin ?'), 'data-inv-action is conditional on isAdmin');
    console.log('PASS: checks table uses data-inv-action delegation');
  }

  // 36) Non-admin users see checks table but no action column
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('isAdmin'), 'module must branch on isAdmin');
    assert.ok(mod.includes('sc-checks-section'), 'module must toggle sc-checks-section visibility');
    assert.ok(mod.includes('classList.add(\'hidden\')'), 'module must hide checks section when empty');
    assert.ok(mod.includes('updateChecksActionCol'), 'module controls action column visibility');
    assert.ok(mod.includes('sc-checks-action-col'), 'module references action col');
    assert.ok(mod.includes('sc-checks-action-th'), 'module references action th');
    console.log('PASS: module shows checks section for all users, action column only for admin');
  }

  // 37) CSS has stock-badge and admin column classes
  {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('.stock-badge'), 'inventory.css must have .stock-badge');
    assert.ok(css.includes('.stock-badge--pending_check'), 'inventory.css must have pending_check badge');
    assert.ok(css.includes('.stock-badge--in_stock'), 'inventory.css must have in_stock badge');
    assert.ok(css.includes('.stock-badge--out_of_stock'), 'inventory.css must have out_of_stock badge');
    assert.ok(css.includes('.stock-badge--needs_purchase'), 'inventory.css must have needs_purchase badge');
    assert.ok(css.includes('.stock-col-status'), 'inventory.css must have .stock-col-status');
    assert.ok(css.includes('.stock-col-avail'), 'inventory.css must have .stock-col-avail');
    assert.ok(css.includes('.stock-col-action'), 'inventory.css must have .stock-col-action');
    assert.ok(css.includes('.sc-edit-panel'), 'inventory.css must have .sc-edit-panel');
    console.log('PASS: inventory.css has badge and admin column classes');
  }

  // ── Admin receipt edit/void tests ───────────────────────────────

  // 38) inventory-data.js exposes updateReceivedStock and voidReceivedStock
  {
    const content = fs.readFileSync(MODULE_DATA_PATH, 'utf8');
    assert.ok(content.includes('updateReceivedStock'), 'inventory-data.js must have updateReceivedStock');
    assert.ok(content.includes('voidReceivedStock'), 'inventory-data.js must have voidReceivedStock');
    assert.ok(content.includes('/api/admin/received-stock/'), 'data module calls /api/admin/received-stock/');
    assert.ok(content.includes('PATCH'), 'data module has PATCH method');
    assert.ok(content.includes('encodeURIComponent'), 'data module encodes receipt ID');
    console.log('PASS: inventory-data.js exposes receipt mutation methods');
  }

  // 39) inventory-module.js exposes receipt edit/void functions
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('openReceiptEditModal'), 'module must have openReceiptEditModal');
    assert.ok(mod.includes('closeReceiptEditModal'), 'module must have closeReceiptEditModal');
    assert.ok(mod.includes('saveReceiptEdit'), 'module must have saveReceiptEdit');
    assert.ok(mod.includes('openVoidModal'), 'module must have openVoidModal');
    assert.ok(mod.includes('closeVoidModal'), 'module must have closeVoidModal');
    assert.ok(mod.includes('confirmVoid'), 'module must have confirmVoid');
    assert.ok(mod.includes('data-sr-action'), 'module must use data-sr-action delegation');
    assert.ok(mod.includes('allReceipts.find'), 'module finds item by receipt id');
    console.log('PASS: inventory-module.js exposes receipt edit/void functions');
  }

  // 40) estoque.html has receipt edit and void modals (action buttons rendered by JS)
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-receipt-edit-modal'), 'estoque.html must have receipt edit modal');
    assert.ok(html.includes('sc-void-modal'), 'estoque.html must have void modal');
    assert.ok(html.includes('sr-edit-sku'), 'receipt edit modal must have SKU field');
    assert.ok(html.includes('sr-edit-desc'), 'receipt edit modal must have description field');
    assert.ok(html.includes('sr-edit-qty'), 'receipt edit modal must have quantity field');
    assert.ok(html.includes('sr-edit-unit'), 'receipt edit modal must have unit field');
    assert.ok(html.includes('sr-edit-unit-value'), 'receipt edit modal must have unit value field');
    assert.ok(html.includes('sc-void-reason'), 'void modal must have reason field');
    assert.ok(html.includes('sc-void-receipt-id'), 'void modal must have receipt id hidden');
    assert.ok(html.includes('sr-edit-receipt-id'), 'edit modal must have receipt id hidden');
    assert.ok(html.includes('sc-received-action-th'), 'received table must have Ações header');
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('sc-receipt-action-btn'), 'module must render action button class');
    console.log('PASS: estoque.html has receipt edit/void modals and action column');
  }

  // 41) inventory.css has receipt action and danger button styles
  {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('.users-btn--danger'), 'inventory.css must have .users-btn--danger');
    assert.ok(css.includes('.sc-receipt-action-btn'), 'inventory.css must have .sc-receipt-action-btn');
    assert.ok(css.includes('.sc-receipt-action-btn--edit'), 'inventory.css must have edit action button class');
    assert.ok(css.includes('.sc-receipt-action-btn--void'), 'inventory.css must have void action button class');
    console.log('PASS: inventory.css has receipt action and danger button styles');
  }

  // ── Normal user visibility tests ──────────────────────────────

  // 42) loadReceivedStock filters voided_at is null
  {
    const data = fs.readFileSync(MODULE_DATA_PATH, 'utf8');
    assert.ok(data.includes('.is(\'voided_at\', null)'), 'loadReceivedStock must filter voided rows');
    console.log('PASS: loadReceivedStock filters voided_at is null');
  }

  // 43) renderChecksTable uses isAdmin for action cell
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    assert.ok(mod.includes('isAdmin ?') || mod.includes('isAdmin &&'), 'renderChecksTable conditionally renders edit button');
    assert.ok(mod.includes('sc-edit-row-btn'), 'edit button class referenced');
    assert.ok(mod.match(/isAdmin.*sc-edit-row-btn/) || mod.match(/actionCell = isAdmin/), 'edit button wrapped in isAdmin');
    console.log('PASS: renderChecksTable conditionally shows edit button');
  }

  // 44) Action delegation guards use isAdmin check
  {
    const mod = fs.readFileSync(MODULE_PATH, 'utf8');
    var checksGuard = mod.indexOf("if (!isAdmin) return;");
    var firstChecksClick = mod.indexOf("checksTbody.addEventListener");
    var firstReceivedClick = mod.indexOf("receivedTbody.addEventListener");
    assert.ok(checksGuard > -1, 'module must have !isAdmin guard');
    assert.ok(checksGuard > firstChecksClick && checksGuard < firstChecksClick + 200,
      'checks click handler must guard with !isAdmin');
    var guards = mod.match(/if\s*\(!isAdmin\)\s*return;/g);
    assert.ok(guards && guards.length >= 2, 'must have isAdmin guard in both checks and received click handlers');
    console.log('PASS: both action delegation handlers guard with !isAdmin');
  }

  // 45) estoque.html has checks action col and th IDs
  {
    const html = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.ok(html.includes('sc-checks-action-col'), 'estoque.html must have sc-checks-action-col');
    assert.ok(html.includes('sc-checks-action-th'), 'estoque.html must have sc-checks-action-th');
    console.log('PASS: estoque.html has checks action column and header IDs');
  }

  // 46) Normal user can access /estoque resource (stock-checks-read not admin-only)
  {
    const appUtils = fs.readFileSync(path.join(ROOT, 'public', 'js', 'shared', 'app-utils.js'), 'utf8');
    const buildPerms = appUtils.match(/resources\.forEach\(function assignPermission\(resource\) \{[\s\S]*?\}\);/);
    assert.ok(buildPerms, 'buildPermissions must exist');
    assert.ok(!buildPerms[0].includes('stock-checks-read'),
      'stock-checks-read must not be in admin-only resource deny list');
    console.log('PASS: stock-checks-read resource is accessible to normal users');
  }

  console.log('\n=== All inventory frontend tests passed. ===');
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
