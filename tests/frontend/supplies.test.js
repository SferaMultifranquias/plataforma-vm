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

// ───────────── Dashboard de Suprimentos ─────────────
const Dash = require(path.join(ROOT, 'public/js/pages/supplies/supplies-dashboard'));
const LOJAS = [{ id: 1, nome: 'Loja A' }, { id: 2, nome: 'Loja <B>' }];
const SOLS = [
  { id: 's1', store_id: 1, numero: 'SUP-2026-00001', status: 'pendente', total: 10, criado_em: '2026-10-05T15:00:00Z', itens: [{ nome: 'Detergente', und: 'UN', compra: 2 }, { nome: 'Papel', und: 'PCT', compra: 1 }] },
  { id: 's2', store_id: 2, numero: 'SUP-2026-00002', status: 'entregue', total: 1234.5, criado_em: '2026-11-10T15:00:00Z', itens: [{ nome: 'DETERGENTE', und: 'UN', compra: 3 }] },
  { id: 's3', store_id: 1, numero: 'SUP-2026-00003', status: 'recusada', total: 0, criado_em: '2026-11-12T15:00:00Z', itens: [] },
  { id: 's4', store_id: 1, numero: 'SUP-2026-00004', status: 'aprovada', total: 5, criado_em: '2026-11-15T15:00:00Z', itens: [{ nome: 'Papel', und: 'PCT', compra: 2.5 }] },
];

test('dashboard: KPIs somam status, lojas, itens e valores', () => {
  const k = Dash.kpis(SOLS);
  assert.equal(k.total, 4);
  assert.equal(k.pendentes, 1);
  assert.equal(k.aprovadas, 1);
  assert.equal(k.emAndamento, 2);
  assert.equal(k.entregues, 1);
  assert.equal(k.recusadas, 1);
  assert.equal(k.lojas, 2);
  assert.equal(k.itens, 8.5);
  assert.equal(k.valor, 1249.5);
  assert.equal(k.valorEntregue, 1234.5);
  assert.equal(Dash.kpis([]).total, 0);
});

test('dashboard: filtros por data, loja e status se combinam', () => {
  const f = Dash.filtrosVazios();
  assert.equal(Dash.filtrar(SOLS, f).length, 4);
  assert.equal(Dash.filtrar(SOLS, { ...f, dateStart: '2026-11-01' }).length, 3);
  assert.equal(Dash.filtrar(SOLS, { ...f, dateStart: '2026-11-01', dateEnd: '2026-11-12' }).length, 2);
  assert.equal(Dash.filtrar(SOLS, { ...f, lojas: ['1'] }).length, 3);
  assert.equal(Dash.filtrar(SOLS, { ...f, lojas: ['1'], status: ['aprovada', 'pendente'] }).length, 2);
});

test('dashboard: agrupa itens iguais de lojas diferentes pelo nome', () => {
  const top = Dash.itensMaisPedidos(SOLS, 8);
  assert.equal(top[0].rotulo, 'Detergente');
  assert.equal(top[0].valor, 5);
  assert.equal(top.length, 2);
});

test('dashboard: valor por loja ordenado e evolução mensal/diária', () => {
  const v = Dash.valorPorLoja(SOLS, LOJAS, 5);
  assert.deepEqual(v.map((x) => x.rotulo), ['Loja <B>', 'Loja A']);
  assert.equal(Dash.evolucaoMensal(SOLS).length, 2);
  assert.equal(Dash.evolucaoValorDiaria(SOLS).length, 3);
});

test('dashboard: HTML escapa nomes, desenha rosca de 1 status e não usa eventos inline', () => {
  const html = Dash.renderPagina({ sols: SOLS, lojas: LOJAS, filtros: Dash.filtrosVazios(), aberto: null });
  assert.ok(html.includes('Loja &lt;B&gt;'));
  assert.ok(!html.includes('Loja <B>'));
  assert.ok(html.includes('Solicitações Totais') && html.includes('Valor por Loja') && html.includes('Itens Mais Pedidos'));
  assert.ok(html.includes('data-sol="s4"'));
  assert.ok(/<circle cx="50" cy="50" r="40"/.test(Dash.graficoStatus({ pendente: 3 })));
  assert.ok(!/\son(click|change|input)=/i.test(read('public/js/pages/supplies/supplies-dashboard.js')));
  assert.ok(html.includes('1.234,50') || Dash.renderCorpo({ sols: SOLS, lojas: LOJAS, filtros: Dash.filtrosVazios() }).includes('R$ 1.249,50'));
});

test('dashboard: tela própria (rota, partial, menu e script), separada do VM e das abas de Suprimentos', () => {
  const index = read('public/index.html');
  assert.match(read('public/js/core/app-shell.js'), /path:\s*'\/dashboard-suprimentos'/);
  assert.ok(read('public/_redirects').includes('/dashboard-suprimentos'));
  assert.ok(index.includes('href="/dashboard-suprimentos"'));
  assert.ok(index.includes('supplies-dashboard.js'));
  const partial = read('public/pages/dashboard-suprimentos.html');
  assert.ok(partial.includes('id="supdash-root"') && !/<script/i.test(partial) && !/\son[a-z]+=/i.test(partial));
  assert.ok(!/key:\s*'dashboard'/.test(read('public/js/pages/supplies/supplies-module.js')));
});

console.log('Supplies tests passed.');
