const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = (name, fn) => {
  fn();
  console.log('  ✔ ' + name);
};

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const AppUtils = require(path.join(ROOT, 'public/js/shared/app-utils'));
const Sup = require(path.join(ROOT, 'public/js/pages/supplies/supplies-data'));

const RECURSOS = ['dashboard', 'pedidos', 'formulario', 'lojas-cadastro', 'usuarios', 'stock-checks-read', 'stock-checks-admin', 'suprimentos', 'suprimentos-admin'].map((key) => ({ key }));

test('usuário de loja do VM vê VM e Suprimentos, sem telas administrativas', () => {
  const p = AppUtils.buildPermissions('loja', RECURSOS, { usaVm: true });
  assert.equal(p.dashboard, true);
  assert.equal(p.pedidos, true);
  assert.equal(p.suprimentos, true);
  assert.equal(p['suprimentos-admin'], false);
  assert.equal(p.usuarios, false);
});

test('usuário de loja fora do VM (Levi\'s, Hering, VD) vê só Suprimentos', () => {
  const p = AppUtils.buildPermissions('loja', RECURSOS, { usaVm: false });
  Object.keys(p).forEach((k) => assert.equal(p[k], k === 'suprimentos', k));
});

test('sem opções, permissões continuam como antes (compatível)', () => {
  const p = AppUtils.buildPermissions('loja', RECURSOS);
  assert.equal(p.dashboard, true);
  assert.equal(p.suprimentos, true);
  assert.equal(p.usuarios, false);
});

test('admin vê tudo mesmo marcado como fora do VM', () => {
  const p = AppUtils.buildPermissions('admin', RECURSOS, { usaVm: false });
  Object.keys(p).forEach((k) => assert.equal(p[k], true, k));
});

test('parseNumero aceita formato brasileiro e R$', () => {
  assert.equal(Sup.parseNumero('1.234,5'), 1234.5);
  assert.equal(Sup.parseNumero('R$ 3,06'), 3.06);
  assert.equal(Sup.parseNumero('2'), 2);
  assert.ok(Number.isNaN(Sup.parseNumero('')));
});

test('calcularLinha: compra = ideal - físico, nunca negativa', () => {
  const item = { estoque_ideal: 5, custo_unitario: 2.5 };
  assert.deepEqual(
    [Sup.calcularLinha(item, 2).compra, Sup.calcularLinha(item, 2).total],
    [3, 7.5]
  );
  assert.equal(Sup.calcularLinha(item, 9).compra, 0);
  assert.equal(Sup.calcularLinha(item, '').contado, false);
  assert.equal(Sup.calcularLinha({ estoque_ideal: 2, custo_unitario: null }, 0).total, 0);
});

test('montarSolicitacao leva só itens ativos com compra e soma o total', () => {
  const itens = [
    { id: 'a', nome: 'A', unidade: 'UN', categoria: 'Limpeza', estoque_ideal: 3, custo_unitario: 2, fornecedor: 'X' },
    { id: 'b', nome: 'B', unidade: 'PCT', categoria: 'Limpeza', estoque_ideal: 1, custo_unitario: 10 },
    { id: 'c', nome: 'C', unidade: 'UN', categoria: 'Limpeza', estoque_ideal: 4, custo_unitario: 1, ativo: false },
    { id: 'd', nome: 'D', unidade: 'UN', categoria: 'Limpeza', estoque_ideal: 4, custo_unitario: 1 },
  ];
  const m = Sup.montarSolicitacao(itens, { a: 1, b: 5, c: 0 });
  assert.equal(m.itens.length, 1);
  assert.equal(m.itens[0].item, 'a');
  assert.equal(m.itens[0].compra, 2);
  assert.equal(m.itens[0].fornecedor, 'X');
  assert.equal(m.total, 4);
});

test('montarPedido leva só a quantidade pedida pela loja, sem estoque físico/ideal', () => {
  const itens = [
    { id: 'a', nome: 'A', unidade: 'UN', categoria: 'Limpeza', custo_unitario: 2, fornecedor: 'X' },
    { id: 'b', nome: 'B', unidade: 'PCT', categoria: 'Limpeza', custo_unitario: 10 },
    { id: 'c', nome: 'C', unidade: 'UN', categoria: 'Limpeza', custo_unitario: 1, ativo: false },
    { id: 'd', nome: 'D', unidade: 'UN', categoria: 'Limpeza', custo_unitario: null },
  ];
  const m = Sup.montarPedido(itens, { a: 3, b: 0, c: 5, d: 2 });
  assert.deepEqual(m.itens.map((i) => i.item), ['a', 'd']);
  assert.equal(m.itens[0].compra, 3);
  assert.equal(m.itens[0].fisico, null);
  assert.equal(m.itens[0].ideal, null);
  assert.equal(m.itens[0].fornecedor, 'X');
  assert.equal(m.total, 6);
  assert.equal(Sup.calcularPedidoLinha({ custo_unitario: 2.5 }, '').compra, 0);
  assert.equal(Sup.calcularPedidoLinha({ custo_unitario: 2.5 }, 4).total, 10);
});

test('agruparCatalogo junta o mesmo item de várias lojas e aponta custo diferente', () => {
  const g = Sup.agruparCatalogo([
    { id: '1', store_id: 1, nome: 'Copo descartável 200 ml', categoria: 'Copa', unidade: 'PCT', estoque_ideal: 3, custo_unitario: 5.9 },
    { id: '2', store_id: 2, nome: 'copo descartável  200 ml', categoria: 'Copa', unidade: 'PCT', estoque_ideal: 3, custo_unitario: 6.1 },
    { id: '3', store_id: 2, nome: 'Detergente', categoria: 'Limpeza', unidade: 'UN', estoque_ideal: 2, custo_unitario: 3 },
  ]);
  assert.equal(g.length, 2);
  const copo = g.find((x) => x.nome.startsWith('Copo'));
  assert.deepEqual(copo.lojas.sort(), [1, 2]);
  assert.equal(copo.custoVaria, true);
});

test('separarPorFornecedor gera um pedido por fornecedor com número sufixado', () => {
  const s = { numero: 'SUP-2026-00007', itens: [
    { item: 'a', nome: 'A', und: 'UN', compra: 2, custo: 1, fornecedor: 'Jae' },
    { item: 'b', nome: 'B', und: 'UN', compra: 1, custo: 5 },
    { item: 'c', nome: 'C', und: 'UN', compra: 0, custo: 5, fornecedor: 'Jae' },
  ] };
  const grupos = Sup.separarPorFornecedor(s, { b: 'Mercado Livre' });
  assert.deepEqual(grupos.map((g) => [g.fornecedor, g.numero, g.linhas.length]), [
    ['Jae', 'SUP-2026-00007-1', 1],
    ['Mercado Livre', 'SUP-2026-00007-2', 1],
  ]);
  const um = Sup.separarPorFornecedor({ numero: 'SUP-1', itens: [{ item: 'x', nome: 'X', compra: 1 }] }, {});
  assert.equal(um[0].numero, 'SUP-1');
  assert.equal(um[0].nomeFornecedor, '');
});

test('lerColagemExcel ignora cabeçalho e linhas sem estoque ideal', () => {
  const linhas = Sup.lerColagemExcel('Item\tCategoria\tUnd\tIdeal\tCusto\nDetergente 500ML\tLimpeza\tun\t3\tR$ 3,06\tJae\nSem ideal\tLimpeza\tUN\t\t1');
  assert.equal(linhas.length, 1);
  assert.deepEqual(linhas[0], { nome: 'Detergente 500ML', categoria: 'Limpeza', unidade: 'UN', estoque_ideal: 3, custo_unitario: 3.06, fornecedor: 'Jae' });
});

test('rota /suprimentos registrada, com partial sem scripts nem eventos inline', () => {
  assert.match(read('public/js/core/app-shell.js'), /path:\s*'\/suprimentos'/);
  assert.ok(read('public/_redirects').includes('/suprimentos'));
  const partial = read('public/pages/suprimentos.html');
  assert.ok(!/<script/i.test(partial));
  assert.ok(!/\son[a-z]+=/i.test(partial));
  assert.ok(!/<html[\s>]|<body[\s>]|<head[\s>]|<!doctype/i.test(partial));
});

test('módulo de suprimentos não usa eventos inline e escapa textos', () => {
  const code = read('public/js/pages/supplies/supplies-module.js');
  assert.ok(!/\son(click|change|input)=/i.test(code));
  assert.ok(code.includes('escapeHtml'));
});

test('migration do módulo protege as tabelas com RLS', () => {
  const sql = read('supabase/migrations/20261116120000_add_supplies_module.sql');
  ['sup_itens', 'sup_contagens', 'sup_solicitacoes'].forEach((t) => {
    assert.ok(sql.includes('alter table public.' + t + ' enable row level security'), t);
  });
  assert.ok(sql.includes('add column if not exists usa_vm boolean not null default true'));
  assert.ok(/revoke all on public\.sup_itens, public\.sup_contagens, public\.sup_solicitacoes from anon/.test(sql));
});

console.log('Supplies tests passed.');
