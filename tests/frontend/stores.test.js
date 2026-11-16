const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createElement(id) {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    id: id || '',
    innerHTML: '',
    style: {},
    textContent: '',
    addEventListener() {},
    appendChild(child) {
      if (child && typeof child === 'object') {
        this.innerHTML += child.innerHTML || '';
      }
      return child;
    },
    setAttribute() {},
    getAttribute() { return null; },
    value: '',
    focus() {},
    disabled: false,
    className: '',
  };
}

function createSandbox() {
  const elements = new Map();

  const document = {
    activeElement: null,
    createElement(tag) {
      const el = createElement(tag);
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
    addEventListener() {},
    querySelectorAll() { return []; },
  };

  const window = {
    console,
    crypto: {
      randomUUID() { return 'stores-test'; },
      getRandomValues(bytes) { for (var i = 0; i < bytes.length; i++) bytes[i] = i; },
    },
    document,
    Promise,
    URL,
    setTimeout,
    clearTimeout,
    lucide: { createIcons() {} },
    confirm() { return true; },
    AbortController,
  };

  window.window = window;
  window.globalThis = window;

  return { elements, window };
}

function loadModule(file, window) {
  vm.runInNewContext(read(file), window, { filename: file });
  return window;
}

async function run() {
  var indexHtml = read(path.join('public', 'index.html'));
  var lojasHtml = read(path.join('public', 'pages', 'lojas.html'));
  var storesModuleCode = read(path.join('public', 'js', 'pages', 'stores', 'stores-module.js'));

  assert.ok(lojasHtml, 'lojas.html loaded');
  assert.ok(storesModuleCode, 'stores-module.js loaded');

  // --- lojas.html structure ---
  assert.match(lojasHtml, /stores-toolbar-card/);
  assert.match(lojasHtml, /stores-table-card/);
  assert.match(lojasHtml, /stores-table-footer/);
  assert.match(lojasHtml, /stores-col-code/);
  assert.match(lojasHtml, /lojas-contador/);
  assert.match(lojasHtml, /loja-nova/);
  assert.doesNotMatch(lojasHtml, /oninput\s*=/i);
  assert.doesNotMatch(lojasHtml, /onchange\s*=/i);
  assert.doesNotMatch(lojasHtml, /onclick\s*=/i);

  // --- toolbar structure ---
  assert.match(lojasHtml, /stores-search-wrapper/);
  assert.match(lojasHtml, /stores-search-icon/);
  assert.match(lojasHtml, /data-lucide="search"/);
  assert.match(lojasHtml, /stores-filter-control/);
  assert.match(lojasHtml, /stores-filter-control--brand/);
  assert.match(lojasHtml, /stores-filter-control--status/);
  assert.match(lojasHtml, /stores-new-button/);
  assert.match(lojasHtml, /stores-search-input/);

  // toolbar order: search before brand before status before button
  var html = lojasHtml;
  var searchIdx = html.indexOf('loja-busca');
  var brandIdx = html.indexOf('loja-filtro-marca');
  var statusIdx = html.indexOf('loja-filtro-ativo');
  var buttonIdx = html.indexOf('loja-nova');
  assert.ok(searchIdx >= 0 && brandIdx >= 0 && statusIdx >= 0 && buttonIdx >= 0, 'all toolbar IDs present');
  assert.ok(searchIdx < brandIdx, 'search appears before brand');
  assert.ok(brandIdx < statusIdx, 'brand appears before status');
  assert.ok(statusIdx < buttonIdx, 'status appears before button');

  // no inline widths on toolbar controls
  assert.doesNotMatch(lojasHtml, /style="width:240px"/);
  assert.doesNotMatch(lojasHtml, /style="width:160px"/);
  assert.doesNotMatch(lojasHtml, /style="width:140px"/);

  // 6 columns, not 7
  assert.match(lojasHtml, /colspan="6"/);
  assert.doesNotMatch(lojasHtml, /colspan="7"/);

  // No Responsável column
  assert.doesNotMatch(lojasHtml, /Responsável/);
  assert.doesNotMatch(lojasHtml, /stores-col-responsible/);

  // Cidade column present
  assert.match(lojasHtml, /Cidade/);

  // 6 colgroup elements
  var colgroupMatch = lojasHtml.match(/<col class="stores-col-/g);
  assert.equal(colgroupMatch ? colgroupMatch.length : 0, 6, 'expected 6 colgroup cols');

  // --- stores-module.js ---
  assert.match(storesModuleCode, /stores-status-badge--active/);
  assert.match(storesModuleCode, /stores-status-badge--inactive/);
  assert.match(storesModuleCode, /stores-action--edit/);
  assert.match(storesModuleCode, /stores-action--danger/);
  assert.match(storesModuleCode, /afterRenderLojasCadastro/);
  assert.match(storesModuleCode, /escapeHtml/);

  // normalizeStore includes cidade and estado
  assert.match(storesModuleCode, /cidade: store\.cidade/);
  assert.match(storesModuleCode, /estado: store\.estado/);
  assert.doesNotMatch(storesModuleCode, /uf: store\.uf/);

  // loadStores select includes cidade,estado and the supplies access fields
  assert.match(storesModuleCode, /\.select\('id,codigo,nome,marca,ativo,cidade,estado,usa_vm,centro_custo'\)/);

  // salvarLoja payload only has contract fields
  assert.match(storesModuleCode, /payload = \{/);
  var payloadEnd = storesModuleCode.indexOf('try', storesModuleCode.indexOf('payload = {'));
  var payloadBlock = storesModuleCode.substring(storesModuleCode.indexOf('payload = {'), payloadEnd);
  assert.match(payloadBlock, /codigo:/);
  assert.match(payloadBlock, /nome:/);
  assert.match(payloadBlock, /marca:/);
  assert.match(payloadBlock, /ativo:/);
  assert.match(payloadBlock, /cidade:/);
  assert.match(payloadBlock, /estado:/);
  assert.doesNotMatch(payloadBlock, /endereco/);
  assert.doesNotMatch(payloadBlock, /responsavel/);
  assert.doesNotMatch(payloadBlock, /telefone/);
  assert.doesNotMatch(payloadBlock, /email_contato/);
  assert.doesNotMatch(payloadBlock, /uf:/);

  // Validation includes required fields
  assert.match(storesModuleCode, /Código é obrigatório/);
  assert.match(storesModuleCode, /Nome da loja é obrigatório/);
  assert.match(storesModuleCode, /Selecione uma marca/);
  assert.match(storesModuleCode, /Estado deve ter exatamente 2 letras/);
  assert.match(storesModuleCode, /Estado inválido/);

  // ESTADOS_BR constant
  assert.match(storesModuleCode, /ESTADOS_BR/);
  assert.match(storesModuleCode, /'SP','SE','TO'/);

  // UF validator function
  assert.match(storesModuleCode, /function validarEstado/);

  // abrirModalLoja uses estado not uf, no obsolete fields
  assert.match(storesModuleCode, /fl-estado/);
  assert.doesNotMatch(storesModuleCode, /fl-uf/);
  assert.doesNotMatch(storesModuleCode, /fl-endereco/);
  assert.doesNotMatch(storesModuleCode, /fl-responsavel/);
  assert.doesNotMatch(storesModuleCode, /fl-telefone/);
  assert.doesNotMatch(storesModuleCode, /fl-email/);

  // colspan=6 in renderTable and error
  assert.match(storesModuleCode, /colspan="6"/g);
  assert.doesNotMatch(storesModuleCode, /colspan="7"/g);

  // stores.css loaded
  var stylesCode = read(path.join('public', 'styles', 'pages', 'stores.css'));
  assert.ok(stylesCode, 'stores.css loaded');
  assert.match(stylesCode, /stores-toolbar-card/);
  assert.match(stylesCode, /stores-table-card/);
  assert.doesNotMatch(stylesCode, /stores-col-responsible/);
  assert.match(stylesCode, /stores-modal-panel/);
  assert.match(stylesCode, /stores-modal-header/);
  assert.match(stylesCode, /stores-modal-footer/);
  assert.match(stylesCode, /stores-form-section/);
  assert.match(stylesCode, /stores-form-grid--two/);
  assert.match(stylesCode, /stores-modal-action/);
  assert.match(stylesCode, /@media \(max-width: 700px\)/);
  assert.match(stylesCode, /stores-search-wrapper/);
  assert.match(stylesCode, /stores-filter-control/);
  assert.match(stylesCode, /stores-new-button/);
  assert.match(stylesCode, /stores-search-input/);
  assert.match(stylesCode, /stores-search-icon/);
  assert.match(stylesCode, /@media \(max-width: 640px\)/);
  assert.match(stylesCode, /stores-new-button[^}]*width:\s*100%/);

  // --- index.html modal ---
  assert.match(indexHtml, /stores-modal-panel/);
  assert.match(indexHtml, /role="dialog"/);
  assert.match(indexHtml, /aria-modal="true"/);
  assert.match(indexHtml, /aria-labelledby="modal-loja-titulo"/);
  assert.match(indexHtml, /aria-describedby="modal-loja-subtitle"/);
  assert.match(indexHtml, /stores-modal-subtitle/);
  assert.match(indexHtml, /stores-modal-header-icon/);
  assert.match(indexHtml, /data-lucide="store"/);
  assert.match(indexHtml, /stores-form-section/);
  assert.match(indexHtml, /stores-form-grid--two/);
  assert.match(indexHtml, /stores-modal-footer/);
  assert.match(indexHtml, /stores-required/);
  assert.match(indexHtml, /stores-modal-close/);
  assert.match(indexHtml, /Informações da Loja/);
  assert.match(indexHtml, /Identificação/);
  assert.match(indexHtml, /Localização/);
  assert.match(indexHtml, /Status da loja/);
  assert.ok(indexHtml.indexOf('Informações da Loja') < indexHtml.indexOf('Identificação'));
  assert.ok(indexHtml.indexOf('Identificação') < indexHtml.indexOf('Localização'));
  assert.doesNotMatch(indexHtml, /fl-uf/);
  assert.doesNotMatch(indexHtml, /fl-endereco/);
  assert.doesNotMatch(indexHtml, /fl-responsavel/);
  assert.doesNotMatch(indexHtml, /fl-telefone/);
  assert.doesNotMatch(indexHtml, /fl-email/);
  assert.doesNotMatch(indexHtml, /E-mail de contato/);
  assert.doesNotMatch(indexHtml, /Responsavel/);
  assert.match(indexHtml, /Cancelar/);
  assert.match(indexHtml, /Criar loja/);
  assert.match(indexHtml, /modal-loja-btn-save/);
  assert.match(indexHtml, /fl-ativo-wrapper/);
  assert.match(indexHtml, /maxlength="10"/);
  assert.match(indexHtml, /maxlength="100"/);
  assert.match(indexHtml, /maxlength="50"/);

  // --- Module runtime tests ---
  var sandbox = createSandbox();
  loadModule(path.join('public', 'js', 'pages', 'stores', 'stores-module.js'), sandbox.window);

  assert.equal(typeof sandbox.window.StoresModule.afterRenderLojasCadastro, 'function');
  assert.match(storesModuleCode, /setModalLojaSubtitle/);
  assert.match(storesModuleCode, /onModalLojaKeydown/);
  assert.match(storesModuleCode, /restoreModalLojaFocus/);
  assert.match(storesModuleCode, /modalLojaOpener/);
  assert.match(storesModuleCode, /Atualize as informações da loja selecionada\./);
  assert.match(storesModuleCode, /Preencha as informações abaixo para cadastrar uma nova loja\./);

  var tbody = sandbox.window.document.getElementById('tbody-lojas');
  var contador = sandbox.window.document.getElementById('lojas-contador');

  assert.ok(tbody, 'tbody-lojas exists');
  assert.ok(contador, 'lojas-contador exists');

  var testStores = [
    { id: 1, codigo: '001', nome: 'Loja Centro', marca: 'O Boticario', ativo: true, cidade: 'São Paulo', estado: 'SP' },
    { id: 2, codigo: '002', nome: 'Loja Norte', marca: 'QDB', ativo: false },
    { id: 3, codigo: '003', nome: 'Loja Leste', marca: 'O Boticario', ativo: true, cidade: 'Belo Horizonte', estado: '' },
  ];

  sandbox.window.StoresModule.renderTabelaLojas(testStores);

  assert.match(contador.textContent, /3 loja\(s\) encontrada\(s\)/);
  assert.match(tbody.innerHTML, /stores-status-badge--active/);
  assert.match(tbody.innerHTML, /stores-status-badge--inactive/);
  assert.match(tbody.innerHTML, /stores-action--edit/);
  assert.match(tbody.innerHTML, /stores-action--danger/);
  assert.match(tbody.innerHTML, /Loja Centro/);
  assert.match(tbody.innerHTML, /Loja Norte/);
  assert.match(tbody.innerHTML, /001/);
  assert.match(tbody.innerHTML, /O Boticario/);
  assert.match(tbody.innerHTML, /Ativa/);
  assert.match(tbody.innerHTML, /Inativa/);

  // Cidade/estado rendering
  assert.match(tbody.innerHTML, /São Paulo\/SP/);
  assert.match(tbody.innerHTML, /Belo Horizonte/);

  // No responsavel rendering
  assert.doesNotMatch(tbody.innerHTML, /João/);

  // Empty state
  sandbox.window.StoresModule.renderTabelaLojas([]);
  assert.match(contador.textContent, /0 loja\(s\) encontrada\(s\)/);
  assert.match(tbody.innerHTML, /Nenhuma loja encontrada/);

  // cidade/estado in rendered table output
  var testCidade = { id: 5, codigo: '005', nome: 'Cidade Test', marca: 'O Boticario', ativo: true, cidade: 'Rio', estado: 'RJ' };
  sandbox.window.StoresModule.renderTabelaLojas([testCidade]);
  assert.match(tbody.innerHTML, /Rio\/RJ/);
  assert.match(tbody.innerHTML, /Cidade Test/);

  console.log('Stores checks ok.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
