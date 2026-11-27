const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = (name, fn) => { fn(); console.log('  ✔ ' + name); };

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const Core = require(path.join(ROOT, 'public/js/pages/sfera-stock/stock-core'));
const AppUtils = require(path.join(ROOT, 'public/js/shared/app-utils'));

test('saldo = entradas - saídas; ajuste não conta como consumo', () => {
  const items = { a: { id: 'a', nome: 'A', categoria: 'Limpeza', und: 'UN', ativo: true } };
  const ent = [{ data: '2026-11-01', tipo: 'inicial', itens: [{ item: 'a', qtd: 10 }] }];
  const sai = [
    { data: '2026-11-10', tipo: 'requisicao', itens: [{ item: 'a', qtd: 3 }] },
    { data: '2026-11-11', tipo: 'ajuste', itens: [{ item: 'a', qtd: 1 }] },
  ];
  const r = Core.compute(items, ent, sai, {}, '2026-11-19').byId.a;
  assert.equal(r.saldo, 6);
  assert.equal(r.saidaJanela, 3);
  assert.equal(r.ultSaida, '2026-11-10');
});

test('status: ruptura, crítico pelo mínimo manual e inativo', () => {
  const items = {
    z: { id: 'z', nome: 'Z', categoria: 'X', und: 'UN', ativo: true },
    m: { id: 'm', nome: 'M', categoria: 'X', und: 'UN', ativo: true, minManual: 5 },
    i: { id: 'i', nome: 'I', categoria: 'X', und: 'UN', ativo: false },
  };
  const ent = [{ data: '2026-11-01', tipo: 'inicial', itens: [{ item: 'm', qtd: 3 }, { item: 'i', qtd: 2 }] }];
  const c = Core.compute(items, ent, [], {}, '2026-11-19').byId;
  assert.equal(c.z.status, 'RUPTURA');
  assert.equal(c.m.status, 'CRÍTICO');
  assert.ok(c.m.comprar > 0);
  assert.equal(c.i.status, 'INATIVO');
});

test('último custo da NF tem prioridade sobre o custo cadastrado', () => {
  const items = { a: { id: 'a', nome: 'A', categoria: 'X', und: 'UN', custo: 9, ativo: true } };
  const ent = [{ data: '2026-11-05', tipo: 'compra', itens: [{ item: 'a', qtd: 2, custo: 4.5 }] }];
  const r = Core.compute(items, ent, [], {}, '2026-11-19').byId.a;
  assert.equal(r.custo, 4.5);
  assert.equal(r.valor, 9);
});

test('leitura do XML da NF-e', () => {
  const { DOMParser } = (() => { try { return require('@xmldom/xmldom'); } catch (e) { return {}; } })();
  if (!DOMParser) return; // sem parser XML no Node: coberto no navegador
  const xml = '<nfeProc><NFe><infNFe Id="NFe123"><ide><nNF>55</nNF><serie>1</serie><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11</CNPJ><xNome>Forn</xNome></emit><det><prod><cProd>A</cProd><xProd>COPO</xProd><uCom>CX</uCom><qCom>2</qCom><vUnCom>10</vUnCom><vProd>20</vProd></prod></det><total><ICMSTot><vNF>20</vNF></ICMSTot></total></infNFe></NFe></nfeProc>';
  const n = Core.parseNFe(xml, DOMParser);
  assert.equal(n.nf, '55');
  assert.equal(n.itens.length, 1);
});

test('Estoque Sfera é só para administradores', () => {
  const recursos = [{ key: 'estoque-sfera' }, { key: 'suprimentos' }];
  assert.equal(AppUtils.buildPermissions('loja', recursos)['estoque-sfera'], false);
  assert.equal(AppUtils.buildPermissions('loja', recursos, { usaVm: false })['estoque-sfera'], false);
  assert.equal(AppUtils.buildPermissions('admin', recursos)['estoque-sfera'], true);
});

test('rota /estoque-sfera registrada, com partial sem scripts nem eventos inline', () => {
  assert.match(read('public/js/core/app-shell.js'), /path:\s*'\/estoque-sfera'/);
  assert.ok(read('public/_redirects').indexOf('/estoque-sfera') < read('public/_redirects').indexOf('/*'));
  const partial = read('public/pages/estoque-sfera.html');
  assert.ok(!/<script/i.test(partial));
  assert.ok(!/\son[a-z]+=/i.test(partial));
});

test('módulo não usa eventos inline no HTML e escapa textos', () => {
  const code = read('public/js/pages/sfera-stock/stock-module.js');
  assert.ok(!/<[^>]+\son(click|change|input)=/i.test(code));
  assert.ok(code.includes('const esc ='));
});

test('migration do Estoque Sfera: RLS só admin e sem acesso anônimo', () => {
  const sql = read('supabase/migrations/20261119160000_add_sfera_stock.sql');
  ['alm_itens', 'alm_entradas', 'alm_saidas', 'alm_pedidos', 'alm_config'].forEach((t) => {
    assert.ok(sql.includes('alter table public.' + t + ' enable row level security'), t);
    assert.ok(new RegExp('policy ' + t + '_admin[\\s\\S]*?is_admin\\(\\) and public.current_user_is_active\\(\\)').test(sql), t);
  });
  assert.ok(/revoke all on public\.alm_itens, public\.alm_entradas, public\.alm_saidas, public\.alm_pedidos, public\.alm_config from anon/.test(sql));
});

test('pedido de compra baixa em PDF e Excel, com bibliotecas protegidas por SRI', () => {
  const code = read('public/js/pages/sfera-stock/stock-module.js');
  assert.ok(code.includes('async function baixarPedidoPdf(p)'));
  assert.ok(code.includes('async function baixarPedidoExcel(p)'));
  assert.ok(/JSPDF_SRI = 'sha384-/.test(code) && /AUTOTABLE_SRI = 'sha384-/.test(code));
  assert.ok(code.includes('data-ppdf') && code.includes('data-pxlsx') && code.includes('id="pv-pdf"') && code.includes('id="pv-xlsx"'));
});

/* Texto extraído pelo pdf.js de uma DANFE de 2 páginas: chave em duas linhas, descrição acima dos números
   e uma linha "parecida com item" em Dados adicionais, que deve ser ignorada. */
const DANFE_ITENS = [{"str": "IDENTIFICAÇÃO DO EMITENTE", "x": 30, "y": 80, "w": 74.2}, {"str": "CACULA COMERCIO DE ARMARINHOS LTDA", "x": 30, "y": 92, "w": 192.5}, {"str": "CHAVE DE ACESSO", "x": 380, "y": 80, "w": 47.8}, {"str": "3526111234567800019055", "x": 380, "y": 92, "w": 85.6}, {"str": "0010000123451000123456", "x": 380, "y": 100, "w": 85.6}, {"str": "DATA DE EMISSÃO", "x": 500, "y": 185, "w": 45.8}, {"str": "05/11/2026", "x": 500, "y": 195, "w": 35.0}, {"str": "DADOS DO PRODUTO / SERVIÇO", "x": 30, "y": 290, "w": 95.7}, {"str": "CÓDIGO", "x": 30, "y": 300, "w": 20.3}, {"str": "DESCRIÇÃO DO PRODUTO / SERVIÇO", "x": 75, "y": 300, "w": 91.7}, {"str": "NCM/SH", "x": 250, "y": 300, "w": 19.7}, {"str": "CST", "x": 290, "y": 300, "w": 10}, {"str": "CFOP", "x": 320, "y": 300, "w": 13.9}, {"str": "UNID", "x": 350, "y": 300, "w": 12.2}, {"str": "QTD", "x": 375, "y": 300, "w": 10.6}, {"str": "V. UNITÁRIO", "x": 420, "y": 300, "w": 30.0}, {"str": "V. TOTAL", "x": 470, "y": 300, "w": 22.2}, {"str": "FILAMENTO ANTIFURTO 25MM HERING", "x": 75, "y": 308, "w": 113.7}, {"str": "56049000", "x": 250, "y": 312, "w": 26.7}, {"str": "000", "x": 290, "y": 312, "w": 10.0}, {"str": "6102", "x": 320, "y": 312, "w": 13.3}, {"str": "CX", "x": 350, "y": 312, "w": 8.3}, {"str": "3,00", "x": 375, "y": 312, "w": 11.7}, {"str": "34,99", "x": 420, "y": 312, "w": 15.0}, {"str": "104,97", "x": 470, "y": 312, "w": 18.3}, {"str": "A1", "x": 30, "y": 312, "w": 7.3}, {"str": "DADOS ADICIONAIS", "x": 30, "y": 700, "w": 57.7}, {"str": "X1 Y 12345678 000 5102 UN 1,0 2,0 3,0", "x": 30, "y": 712, "w": 108.4}, {"str": "CÓDIGO", "x": 30, "y": 10060, "w": 20.3}, {"str": "DESCRIÇÃO DO PRODUTO / SERVIÇO", "x": 75, "y": 10060, "w": 91.7}, {"str": "NCM/SH", "x": 250, "y": 10060, "w": 19.7}, {"str": "CST", "x": 290, "y": 10060, "w": 10}, {"str": "CFOP", "x": 320, "y": 10060, "w": 13.9}, {"str": "UNID", "x": 350, "y": 10060, "w": 12.2}, {"str": "QTD", "x": 375, "y": 10060, "w": 10.6}, {"str": "V. UNITÁRIO", "x": 420, "y": 10060, "w": 30.0}, {"str": "V. TOTAL", "x": 470, "y": 10060, "w": 22.2}, {"str": "ELASTICO ROLIÇO 2MM", "x": 75, "y": 10068, "w": 69.3}, {"str": "56041000", "x": 250, "y": 10072, "w": 26.7}, {"str": "000", "x": 290, "y": 10072, "w": 10.0}, {"str": "6102", "x": 320, "y": 10072, "w": 13.3}, {"str": "RL", "x": 350, "y": 10072, "w": 7.7}, {"str": "10,00", "x": 375, "y": 10072, "w": 15.0}, {"str": "5,50", "x": 420, "y": 10072, "w": 11.7}, {"str": "55,00", "x": 470, "y": 10072, "w": 15.0}, {"str": "B2", "x": 30, "y": 10072, "w": 7.3}, {"str": "LINHA COSTURA 120", "x": 75, "y": 10082, "w": 60.3}, {"str": "52041100", "x": 250, "y": 10086, "w": 26.7}, {"str": "000", "x": 290, "y": 10086, "w": 10.0}, {"str": "6102", "x": 320, "y": 10086, "w": 13.3}, {"str": "UN", "x": 350, "y": 10086, "w": 8.7}, {"str": "12,00", "x": 375, "y": 10086, "w": 15.0}, {"str": "2,00", "x": 420, "y": 10086, "w": 11.7}, {"str": "24,00", "x": 470, "y": 10086, "w": 15.0}, {"str": "C3", "x": 30, "y": 10086, "w": 7.7}];

test('leitura da DANFE em PDF: chave, emitente, data e itens em várias páginas', () => {
  const n = Core.parseDanfe(DANFE_ITENS);
  assert.equal(n.chave, '35261112345678000190550010000123451000123456');
  assert.equal(n.nf, '12345');
  assert.equal(n.serie, '1');
  assert.equal(n.cnpj, '12345678000190');
  assert.equal(n.emissao, '2026-11-05');
  assert.equal(n.fornecedor, 'CACULA COMERCIO DE ARMARINHOS LTDA');
  assert.deepEqual(n.itens.map((i) => [i.cProd, i.xProd, i.uCom, i.qCom, i.vUnCom, i.vProd]), [
    ['A1', 'FILAMENTO ANTIFURTO 25MM HERING', 'CX', 3, 34.99, 104.97],
    ['B2', 'ELASTICO ROLIÇO 2MM', 'RL', 10, 5.5, 55],
    ['C3', 'LINHA COSTURA 120', 'UN', 12, 2, 24],
  ]);
});

test('DANFE: canhoto dá o emitente, descrição em duas linhas e quantidade com milhar', () => {
  const L = (y, cells) => cells.map(([x, str]) => ({ str, x, y, w: str.length * 3 }));
  const its = [
    ...L(30, [[30, 'RECEBEMOS DE JAE DESCARTAVEIS LTDA OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA']]),
    ...L(92, [[380, '3526 1112 3456 7800 0190 5500 1000 0123 4510 0012 3456']]),
    ...L(185, [[500, 'DATA DA EMISSÃO']]), ...L(195, [[500, '10/11/2026']]),
    ...L(255, [[30, 'BASE DE CÁLCULO DO ICMS'], [435, 'VALOR TOTAL DA NOTA']]), ...L(266, [[60, '0,00'], [465, '1.198,60']]),
    ...L(290, [[30, 'DADOS DO PRODUTO / SERVIÇO']]),
    ...L(300, [[30, 'CÓDIGO'], [75, 'DESCRIÇÃO DO PRODUTO / SERVIÇO'], [250, 'NCM/SH'], [290, 'O/CST'], [320, 'CFOP']]),
    ...L(312, [[30, 'ABC-22'], [75, 'DESINFETANTE LAVANDA 5L'], [250, '38089419'], [290, '0102'], [320, '5102'], [350, 'UN'], [375, '6,0000'], [420, '14,5000'], [470, '87,00']]),
    ...L(322, [[75, 'COM TAMPA DOSADORA']]),
    ...L(332, [[30, '7891'], [75, 'PANO DE CHAO'], [250, '6307.10.00'], [290, '0102'], [320, '5102'], [350, 'PCT'], [375, '1.000,0000'], [420, '0,0296'], [470, '29,60']]),
    ...L(360, [[30, 'DADOS ADICIONAIS']]),
    ...L(372, [[30, 'X1 Y 12345678 000 5102 UN 1,0 2,0 3,0']]),
  ];
  const n = Core.parseDanfe(its);
  assert.equal(n.fornecedor, 'JAE DESCARTAVEIS LTDA');
  assert.equal(n.emissao, '2026-11-10');
  assert.equal(n.valorNota, 1198.6);
  assert.equal(n.itens.length, 2);
  assert.equal(n.itens[0].xProd, 'DESINFETANTE LAVANDA 5L COM TAMPA DOSADORA');
  assert.equal(n.itens[1].qCom, 1000);
  assert.equal(n.itens[1].vUnCom, 0.0296);
});

test('DANFE: PDF escaneado ou sem chave válida dá mensagem clara', () => {
  assert.throws(() => Core.parseDanfe([]), /imagem escaneada/);
  assert.throws(() => Core.parseDanfe([{ str: '3526 1112 3456 7800 0190 5500 1000 0123 4510 0012 3457', x: 0, y: 0, w: 100 }]), /chave de acesso/);
  assert.ok(Core.chaveValida('35261112345678000190550010000123451000123456'));
  assert.ok(!Core.chaveValida('35261112345678000190550010000123451000123457'));
});

test('tela aceita XML ou DANFE, com pdf.js protegido por SRI', () => {
  const code = read('public/js/pages/sfera-stock/stock-module.js');
  assert.ok(code.includes('accept=".xml,text/xml,application/xml,.pdf,application/pdf"'));
  assert.ok(/PDFJS_SRI = 'sha384-/.test(code) && /PDFJS_WORKER_SRI = 'sha384-/.test(code));
  assert.ok(code.includes("origem: N.importado ? (N.importado === 'danfe' ? 'danfe' : 'xml') : 'manual'"));
});

console.log('Sfera stock tests passed.');
