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

console.log('Sfera stock tests passed.');
