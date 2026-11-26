(function initSferaStockModule(global) {
'use strict';
/*
 * Estoque Sfera (almoxarifado da Sfera / Suprimentos), dentro do VM.
 * Telas portadas do "Sfera · Controle de Estoque": Painel, Entrada de nota (com XML da NF-e),
 * Saída de mercadoria, Pedido de compra, Estoque, Movimentações, Consumo e Cadastros.
 * Dados no Supabase (tabelas alm_*), acesso só para ADMIN (RLS).
 */
const Core = global.SferaStockCore;
let DEPS = null;
let SB = null;
let recargaT = null;
let ativo = false;

/* ---------- Ponte com o Supabase (mesma forma de uso do sistema anterior) ---------- */
const TABELA = { itens: 'alm_itens', entradas: 'alm_entradas', saidas: 'alm_saidas', pedidos: 'alm_pedidos', config: 'alm_config' };
const CAMPOS = {
  itens: { nome: 'nome', categoria: 'categoria', und: 'und', custo: 'custo', minManual: 'min_manual', fornecedor: 'fornecedor', ativo: 'ativo', vinculos: 'vinculos' },
  entradas: { data: 'data', tipo: 'tipo', nf: 'nf', serie: 'serie', fornecedor: 'fornecedor', cnpj: 'cnpj', chave: 'chave', emissao: 'emissao', obs: 'obs', origem: 'origem', itens: 'itens', valorTotal: 'valor_total', pedidoId: 'pedido_id' },
  saidas: { data: 'data', tipo: 'tipo', responsavel: 'responsavel', loja: 'destino', obs: 'obs', itens: 'itens' },
  pedidos: { numero: 'numero', data: 'data', fornecedor: 'fornecedor', status: 'status', itens: 'itens', total: 'total', recebidoEm: 'recebido_em' },
  config: { lojas: 'destinos', solicitantes: 'solicitantes', fornecedores: 'fornecedores', categorias: 'categorias', params: 'params' },
};
function novoId() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
  global.crypto.getRandomValues(new Uint8Array(20)).forEach((x) => { s += c[x % 36]; });
  return s;
}
function paraBanco(col, body) {
  const out = {}; const map = CAMPOS[col];
  Object.keys(body || {}).forEach((k) => {
    if (!map[k]) return;
    let v = body[k];
    if ((k === 'emissao' || k === 'recebidoEm') && !v) v = null;
    if (k === 'fornecedor' && col === 'itens' && v === '') v = null;
    if (v === undefined) return;
    out[map[k]] = v;
  });
  return out;
}
function doBanco(col, row) {
  const out = { id: row.id }; const map = CAMPOS[col];
  Object.keys(map).forEach((k) => {
    let v = row[map[k]];
    if (v === null && (k === 'emissao' || k === 'recebidoEm')) v = '';
    if (map[k] === 'custo' || map[k] === 'min_manual' || map[k] === 'valor_total' || map[k] === 'total') v = v === null || v === undefined ? null : Number(v);
    out[k] = v;
  });
  if (row.criado_em) out.criadoEm = row.criado_em;
  if (row.criado_por) out.criadoPor = row.criado_por;
  return out;
}
function erroBanco(error) {
  if (error && error.code === '23505') return new Error('Este lançamento já existe (nota ou item repetido). Confira em Movimentações ou no Estoque.');
  if (error && error.code === '42501') return new Error('Seu usuário não tem permissão para gravar no Estoque Sfera.');
  return new Error((error && error.message) || 'Não foi possível salvar. Tente de novo.');
}
function ref(col, id) {
  const tabela = TABELA[col];
  return {
    id,
    async get() {
      const { data, error } = await SB.from(tabela).select('id').eq('id', id);
      if (error) throw erroBanco(error);
      return { exists: Boolean(data && data.length) };
    },
    async set(body) {
      const row = Object.assign(paraBanco(col, body), { id });
      const q = col === 'config' ? SB.from(tabela).upsert(row, { onConflict: 'id' }) : SB.from(tabela).insert(row);
      const { error } = await q;
      if (error) throw erroBanco(error);
    },
    async update(patch) {
      const p = Object.assign({}, patch);
      if (col === 'itens' && p.vinculos && S.items[id]) p.vinculos = Object.assign({}, S.items[id].vinculos || {}, p.vinculos);
      const { error } = await SB.from(tabela).update(paraBanco(col, p)).eq('id', id);
      if (error) throw erroBanco(error);
    },
    async delete() {
      const { error } = await SB.from(tabela).delete().eq('id', id);
      if (error) throw erroBanco(error);
    },
    /* A NF tem id fixo e chave única no banco: não precisa de trava separada. */
    async acquire() { return { acquired: true }; },
  };
}
const dbPonte = {
  collection: (col) => ({ doc: (id) => ref(col, id || novoId()) }),
  doc: (path) => { const p = path.split('/'); return ref(p[0], p[1]); },
};
async function lerTabela(tabela) {
  let out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await SB.from(tabela).select('*').order('id').range(i, i + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if ((data || []).length < 1000) break;
  }
  return out;
}
async function carregarTudo() {
  const r = await Promise.all(['alm_itens', 'alm_entradas', 'alm_saidas', 'alm_pedidos', 'alm_config'].map(lerTabela));
  const items = {}; r[0].forEach((row) => { const o = doBanco('itens', row); o.vinculos = o.vinculos || {}; items[o.id] = o; });
  S.items = items;
  S.entradas = r[1].map((row) => doBanco('entradas', row)).filter((x) => Array.isArray(x.itens));
  S.saidas = r[2].map((row) => doBanco('saidas', row)).filter((x) => Array.isArray(x.itens));
  S.pedidos = r[3].map((row) => doBanco('pedidos', row)).filter((x) => Array.isArray(x.itens));
  const cfg = r[4].find((x) => x.id === 'geral');
  S.config = Object.assign({ lojas: [], solicitantes: [], fornecedores: [], categorias: [], params: {} }, cfg ? doBanco('config', cfg) : {});
  delete S.config.id;
  Object.keys(S.ready).forEach((k) => { S.ready[k] = true; });
}
function agendarRecarga() {
  clearTimeout(recargaT);
  recargaT = setTimeout(async () => {
    if (!ativo) return;
    try { await carregarTudo(); softRender(); } catch (e) { console.error('[Estoque Sfera]', e); }
  }, 150);
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (v == null || isNaN(v)) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, d = 0) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const dBR = (iso) => iso ? iso.split('-').reverse().join('/') : '—';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mLabel = (ym) => { const [y, m] = ym.split('-'); return `${MESES[+m - 1]}/${y.slice(2)}`; };
const todayIso = () => Core.isoOf(new Date());
const parseNum = (v) => { if (v === '' || v == null) return NaN; return parseFloat(String(v).replace(/\./g, '').replace(',', '.')); };
/* Aceita "1.500,50" e "1500,5" (pt-BR), "1500.5" e "1.500" (ponto com 3 dígitos = milhar) */
const parseNumLoose = (v) => {
  if (v === '' || v == null) return NaN;
  const s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',')) return parseNum(s);
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
  return parseFloat(s);
};
/* Torna as linhas de tabela clicáveis também pelo teclado */
function bindRows(root, fn) {
  $$('tr[data-item]', root).forEach((tr) => {
    tr.tabIndex = 0; tr.setAttribute('role', 'button');
    tr.onclick = () => fn(tr.dataset.item);
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(tr.dataset.item); } };
  });
}
const TIPOS_ENT = { compra: 'Compra (NF)', devolucao: 'Devolução', ajuste: 'Ajuste de inventário', inicial: 'Estoque inicial' };
const TIPOS_SAI = { requisicao: 'Requisição', emprestimo: 'Empréstimo', perda: 'Perda / avaria', ajuste: 'Ajuste de inventário' };

/* ---------- Estado ---------- */
const S = {
  db: null, user: null, uid: null, canWrite: null, ready: { itens: false, entradas: false, saidas: false, config: false, pedidos: false },
  items: {}, entradas: [], saidas: [], pedidos: [], config: { lojas: [], solicitantes: [], fornecedores: [], categorias: [], params: {} },
  calc: null, view: 'painel', names: {},
  ui: { mes: null, cat: 'Todas', estFiltro: 'Todos', estBusca: '', histTipo: 'todos', histBusca: '', histMes: '', histLoja: '', pedSt: ['RUPTURA', 'CRÍTICO', 'ATENÇÃO'] },
  ped: {},
  nf: null, sd: null, offline: false,
};

function recalc() {
  S.calc = Core.compute(S.items, S.entradas, S.saidas, S.config.params, todayIso());
  $('#ess-dl-itens').innerHTML = itemList().map((i) => `<option value="${esc(i.nome)}"></option>`).join('');
  $('#ess-dl-sol').innerHTML = (S.config.solicitantes || []).map((x) => `<option value="${esc(x)}"></option>`).join('');
  const forn = new Set([...(S.config.fornecedores || []), ...S.entradas.map((e) => e.fornecedor).filter(Boolean)]);
  $('#ess-dl-forn').innerHTML = [...forn].sort().map((x) => `<option value="${esc(x)}"></option>`).join('');
}
const itemList = (incluirInativos) => Object.values(S.items).filter((i) => incluirInativos || i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
const itemByName = (n) => { const k = Core.norm(n); return Object.values(S.items).find((i) => Core.norm(i.nome) === k); };
const allReady = () => Object.values(S.ready).every(Boolean);

/* ---------- Toast e diálogo ---------- */
function toast(msg) { if (DEPS && typeof DEPS.showToast === 'function') DEPS.showToast(msg); }
function dialog(html, onMount) {
  const d = $('#ess-dlg'); d.innerHTML = html; if (!d.open) d.showModal(); onMount && onMount(d);
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
}
function confirmBox(title, text, okLabel, fn) {
  dialog(`<div class="dh"><h2>${esc(title)}</h2></div><div class="db"><p style="margin:0">${text}</p></div>
  <div class="df"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="cf-ok">${esc(okLabel)}</button></div>`, (d) => {
    $('#cf-ok', d).addEventListener('click', async () => { $('#cf-ok', d).disabled = true; try { await fn(); d.close(); } catch (e) { $('#cf-ok', d).disabled = false; showErr(e); } });
  });
}
function showErr(e) {
  console.error(e);
  const code = e && e.code;
  const msg = code === 'invalid_argument' ? 'Você não tem permissão para gravar neste estoque. Peça ao dono do sistema acesso de Colaborador.'
    : code === 'quota_exceeded' ? 'O banco de dados atingiu o limite. Exclua lançamentos antigos ou fale com o responsável.'
    : (e && e.message) || 'Não foi possível salvar. Tente de novo.';
  toast(msg);
}
async function write(fn) {
  const r = await fn();
  agendarRecarga();
  return r;
}

/* ---------- Roteamento ---------- */
const VIEWS = { painel: viewPainel, pedido: viewPedido, entrada: viewEntrada, saida: viewSaida, estoque: viewEstoque, historico: viewHistorico, consumo: viewConsumo, cadastros: viewCadastros };
/* Troca de tela dentro do Estoque Sfera: muda ?aba= na URL e o menu lateral acompanha. */
function irPara(view) {
  S.view = VIEWS[view] ? view : 'painel';
  try {
    window.history.replaceState({}, '', '/estoque-sfera?aba=' + encodeURIComponent(S.view));
    window.dispatchEvent(new Event('sup:aba'));
  } catch (e) { /* menu sem destaque: a tela continua funcionando */ }
  render();
  window.scrollTo(0, 0);
}
function render() {
  const m = $('#ess-main');
  if (S.offline && !allReady()) { m.innerHTML = offlineHtml(); return; }
  if (!allReady()) { m.innerHTML = '<div class="empty">Carregando o estoque…</div>'; return; }
  recalc();
  VIEWS[S.view](m);
}
function offlineHtml() {
  return `<div class="card stack"><h1>Não foi possível carregar o Estoque Sfera</h1>
  <p class="muted" style="margin:0">Verifique a internet e recarregue a página. Se continuar, confira se o seu usuário é administrador ativo.</p></div>`;
}
const readOnlyNote = () => S.canWrite === false ? `<div class="banner warn">Você está com acesso só de leitura. Para lançar notas e saídas, peça ao dono do sistema acesso de Colaborador ou Editor.</div>` : '';

/* ---------- PAINEL ---------- */
function viewPainel(m) {
  const C = S.calc; const ref = todayIso();
  const meses = Core.ultimosMeses(ref.slice(0, 7), 12);
  if (!S.ui.mes) { const cur = ref.slice(0, 7); const temMov = S.saidas.some((s) => (s.data || '').startsWith(cur)); S.ui.mes = temMov ? cur : (S.saidas.map((s) => s.data).filter(Boolean).sort().pop() || ref).slice(0, 7); }
  const cats = ['Todas', ...catList()];
  const inCat = (r) => S.ui.cat === 'Todas' || r.item.categoria === S.ui.cat;
  const rows = C.rows.filter((r) => r.item.ativo !== false && inCat(r));
  const valor = rows.reduce((a, r) => a + r.valor, 0);
  const semCusto = rows.filter((r) => r.custo == null && r.saldo > 0).length;
  const unid = rows.reduce((a, r) => a + Math.max(0, r.saldo), 0);
  const comSaldo = rows.filter((r) => r.saldo > 0).length;
  const cnt = (s) => rows.filter((r) => r.status === s).length;
  const alertas = rows.filter((r) => Core.ALERTA.includes(r.status)).sort((a, b) => Core.ALERTA.indexOf(a.status) - Core.ALERTA.indexOf(b.status) || (a.cobertura ?? -1) - (b.cobertura ?? -1));
  const custoCompra = alertas.reduce((a, r) => a + (r.custoCompra || 0), 0);
  const ultMov = [...S.entradas, ...S.saidas].map((x) => x.data).filter(Boolean).sort().pop();
  const negativos = C.rows.filter((r) => r.saldo < 0);

  // séries 6 meses
  const m6 = Core.ultimosMeses(S.ui.mes, 6);
  const pm = Core.porMes(S.entradas, S.saidas, m6, (id) => S.items[id] && inCat({ item: S.items[id] }));
  // consumo no mês por item / loja / categoria
  const saiMes = S.saidas.filter((s) => s.tipo !== 'ajuste' && s.data && s.data.startsWith(S.ui.mes));
  const porItem = {}, porLoja = {}, porCat = {};
  saiMes.forEach((s) => s.itens.forEach((l) => {
    const it = S.items[l.item]; if (!it || !inCat({ item: it })) return;
    const q = Number(l.qtd) || 0;
    porItem[l.item] = (porItem[l.item] || 0) + q;
    const lj = s.loja || 'Sem loja'; porLoja[lj] = (porLoja[lj] || 0) + q;
    porCat[it.categoria] = (porCat[it.categoria] || 0) + q;
  }));
  const top = Object.entries(porItem).sort((a, b) => b[1] - a[1]).slice(0, 10);

  m.innerHTML = `
  <div class="top"><div><h1>Painel de suprimentos</h1><p>Última movimentação em ${dBR(ultMov)} · controle iniciado em ${dBR(C.inicio)}</p></div>
    <div class="row">
      <label class="f">Categoria<select class="i" id="p-cat">${cats.map((c) => `<option ${c === S.ui.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="f">Mês de análise<select class="i" id="p-mes">${meses.slice().reverse().map((x) => `<option value="${x}" ${x === S.ui.mes ? 'selected' : ''}>${mLabel(x)}</option>`).join('')}</select></label>
      <button type="button" class="btn pri" data-go="entrada" style="align-self:flex-end">+ Entrada de nota</button>
      <button type="button" class="btn pri" data-go="saida" style="align-self:flex-end">− Saída</button>
    </div></div>
  ${negativos.length ? `<div class="banner err"><b>${negativos.length} ${negativos.length > 1 ? 'itens estão' : 'item está'} com saldo negativo</b>: ${negativos.map((r) => esc(r.item.nome)).join(', ')}. Falta lançar alguma entrada ou uma saída foi lançada a mais. Corrija com uma entrada de ajuste.</div>` : ''}
  <div class="grid kpis">
    <div class="card kpi acc"><span class="l">Valor em estoque</span><span class="v">${brl(valor)}</span><span class="s">${semCusto ? `${semCusto} itens com saldo sem custo` : 'todos os itens com custo'}</span></div>
    <div class="card kpi acc"><span class="l">Itens com saldo</span><span class="v">${num(comSaldo)}</span><span class="s">de ${rows.length} cadastrados · ${num(unid)} unidades</span></div>
    <div class="card kpi rupt"><span class="l">Ruptura / crítico</span><span class="v">${cnt('RUPTURA')} / ${cnt('CRÍTICO')}</span><span class="s">zerados · abaixo do mínimo</span></div>
    <div class="card kpi warn"><span class="l">Risco de ruptura</span><span class="v">${cnt('ATENÇÃO')}</span><span class="s">saldo dura menos de ${C.params.alertaDias} dias</span></div>
    <div class="card kpi idle"><span class="l">Sem giro</span><span class="v">${cnt('SEM GIRO')}</span><span class="s">com saldo e sem saída há +${C.params.semGiroDias} dias</span></div>
  </div>
  <div class="card stack">
    <div class="row"><h2>Itens que exigem ação</h2><span class="spacer"></span>${alertas.length ? `<span class="muted small">Compra sugerida: <b>${brl(custoCompra)}</b>${alertas.some((r) => r.custo == null) ? ' (parcial, há itens sem custo)' : ''}</span>` : ''}
    <button type="button" class="btn pri" data-go="pedido">Montar pedido de compra</button></div>
    ${alertas.length ? `<div class="tbl-wrap"><table><thead><tr><th>Status</th><th>Item</th><th>Categoria</th><th class="n">Saldo</th><th class="n">Mínimo</th><th class="n">Cobertura</th><th>Últ. saída</th><th class="n">Comprar</th></tr></thead><tbody>
    ${alertas.map((r) => `<tr class="click" data-item="${r.id}"><td><span class="pill ${r.status}">${r.status}</span></td><td>${esc(r.item.nome)}</td><td class="muted">${esc(r.item.categoria)}</td><td class="n ${r.saldo < 0 ? 'neg' : ''}">${num(r.saldo, 2)} <span class="muted small">${esc(r.item.und)}</span></td><td class="n">${num(r.minimo)}</td><td class="n">${r.cobertura == null ? '—' : r.cobertura <= 0 ? '0 d' : num(r.cobertura) + ' d'}</td><td>${dBR(r.ultSaida)}</td><td class="n"><b>${num(r.comprar)}</b> <span class="muted small">${esc(r.item.und)}</span></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Nenhum item em alerta.</div>'}
  </div>
  <div class="grid two">
    <div class="card stack"><div class="row"><h2>Entradas × saídas · 6 meses</h2><span class="spacer"></span><div class="legend"><span><i style="background:var(--ent)"></i>Entradas</span><span><i style="background:var(--sai)"></i>Saídas</span></div></div>
      ${chartES(m6, pm)}<p class="muted small" style="margin:0">Em unidades. Estoque inicial e ajustes ficam de fora.</p></div>
    <div class="card stack"><h2>Situação dos itens</h2>${barsHtml(['OK', 'ATENÇÃO', 'CRÍTICO', 'RUPTURA', 'SEM GIRO'].map((s) => [s, cnt(s)]), (k) => `<span class="pill ${k}">${k}</span>`, (k) => ({ OK: 'var(--ok)', 'ATENÇÃO': 'var(--warn)', 'CRÍTICO': 'var(--crit)', RUPTURA: 'var(--rupt)', 'SEM GIRO': 'var(--idle)' }[k]))}</div>
  </div>
  <div class="grid two">
    <div class="card stack"><h2>Top 10 mais consumidos · ${mLabel(S.ui.mes)}</h2>${top.length ? barsHtml(top.map(([id, q]) => [S.items[id].nome, q])) : '<div class="empty">Sem saídas neste mês.</div>'}</div>
    <div class="card stack"><h2>Consumo por loja / setor · ${mLabel(S.ui.mes)}</h2>${Object.keys(porLoja).length ? barsHtml(Object.entries(porLoja).sort((a, b) => b[1] - a[1])) : '<div class="empty">Sem saídas neste mês.</div>'}
      <h2 style="margin-top:8px">Por categoria</h2>${Object.keys(porCat).length ? barsHtml(Object.entries(porCat).sort((a, b) => b[1] - a[1])) : '<div class="empty">—</div>'}</div>
  </div>`;
  $('#p-cat').onchange = (e) => { S.ui.cat = e.target.value; render(); };
  $('#p-mes').onchange = (e) => { S.ui.mes = e.target.value; render(); };
  bindRows(m, openItem);
}
function barsHtml(pairs, labelFn, colorFn) {
  const max = Math.max(1, ...pairs.map((p) => p[1]));
  return `<div class="bars">${pairs.map(([k, v]) => `<div class="bar"><span class="lbl" title="${esc(k)}">${labelFn ? labelFn(k) : esc(k)}</span><span class="t"><i style="width:${(v / max * 100).toFixed(1)}%;${colorFn ? `background:${colorFn(k)}` : ''}"></i></span><b class="n" style="text-align:right">${num(v)}</b></div>`).join('')}</div>`;
}
function chartES(meses, pm) {
  const W = 560, H = 220, pl = 36, pb = 26, pt = 14, pr = 8;
  const max = Math.max(1, ...meses.map((m) => Math.max(pm[m].ent, pm[m].sai)));
  const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const gw = (W - pl - pr) / meses.length, bw = Math.min(26, gw / 3);
  const y = (v) => pt + (H - pt - pb) * (1 - v / top);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Entradas e saídas por mês">`;
  ticks.forEach((t) => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`; });
  meses.forEach((m, i) => {
    const cx = pl + gw * i + gw / 2; const e = pm[m].ent, sa = pm[m].sai;
    s += `<rect x="${cx - bw - 2}" y="${y(e)}" width="${bw}" height="${y(0) - y(e)}" rx="3" fill="var(--ent)"><title>Entradas ${mLabel(m)}: ${e}</title></rect>`;
    s += `<rect x="${cx + 2}" y="${y(sa)}" width="${bw}" height="${y(0) - y(sa)}" rx="3" fill="var(--sai)"><title>Saídas ${mLabel(m)}: ${sa}</title></rect>`;
    if (e) s += `<text x="${cx - bw / 2 - 2}" y="${y(e) - 4}" text-anchor="middle" style="font-size:11px">${num(e)}</text>`;
    if (sa) s += `<text x="${cx + bw / 2 + 2}" y="${y(sa) - 4}" text-anchor="middle" style="font-size:11px">${num(sa)}</text>`;
    s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${mLabel(m)}</text>`;
  });
  return s + '</svg>';
}
const catList = () => [...new Set([...(S.config.categorias || []), ...Object.values(S.items).map((i) => i.categoria).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

/* ---------- ENTRADA DE NOTA ---------- */
function newNF() { return { tipo: 'compra', data: todayIso(), nf: '', serie: '', fornecedor: '', cnpj: '', chave: '', emissao: '', obs: '', linhas: [newLinhaNF()], valorNota: 0, importado: false }; }
function newLinhaNF() { return { nome: '', qtd: '', custo: '', fator: 1, nfp: null, novo: false, cat: '', und: 'UN' }; }
function viewEntrada(m) {
  if (!S.nf) S.nf = newNF();
  const N = S.nf; const isNF = N.tipo === 'compra';
  m.innerHTML = `
  <div class="top"><div><h1>Entrada de nota</h1><p>Lance o recebimento de mercadoria. Importe o XML da NF-e ou digite os itens.</p></div>
  <div class="row"><button class="btn" id="nf-limpar">Limpar formulário</button></div></div>
  ${readOnlyNote()}
  ${N.pedidoId ? `<div class="banner info">Recebimento do pedido <b>${esc(N.pedidoNum || '')}</b>. Confira as quantidades e o custo da nota. Ao registrar, o pedido fica como recebido.</div>` : ''}
  <div class="card stack">
    ${isNF ? `<div class="drop" id="nf-drop"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--accent)"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>
      <div style="flex:1;min-width:200px"><b>Importar XML da NF-e</b><div class="muted small">Arraste o arquivo .xml aqui ou escolha no computador. Número, fornecedor, data e itens são preenchidos sozinhos.</div></div>
      <label class="btn">Escolher XML<input type="file" id="nf-xml" accept=".xml,text/xml,application/xml" hidden></label></div>` : ''}
    <div class="fgrid">
      <label class="f">Tipo de entrada<select class="i" id="nf-tipo">${Object.entries(TIPOS_ENT).map(([k, v]) => `<option value="${k}" ${k === N.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">Data de recebimento<input class="i" type="date" id="nf-data" value="${esc(N.data)}"></label>
      ${isNF ? `<label class="f">Nº da nota<input class="i" id="nf-num" value="${esc(N.nf)}" inputmode="numeric" placeholder="ex.: 12345"></label>
      <label class="f">Série<input class="i" id="nf-serie" value="${esc(N.serie)}" placeholder="1"></label>
      <label class="f w2">Fornecedor<input class="i" id="nf-forn" list="ess-dl-forn" value="${esc(N.fornecedor)}" placeholder="Nome do fornecedor"></label>
      <label class="f">CNPJ<input class="i" id="nf-cnpj" value="${esc(N.cnpj)}" placeholder="00.000.000/0000-00"></label>
      <label class="f">Emissão<input class="i" type="date" id="nf-emis" value="${esc(N.emissao)}"></label>
      ${N.chave ? `<div class="f w4"><span class="muted small">Chave de acesso</span><span class="mono">${esc(N.chave.replace(/(\d{4})/g, '$1 ').trim())}</span></div>` : ''}` : ''}
      <label class="f w4">Observação<input class="i" id="nf-obs" value="${esc(N.obs)}" placeholder="${N.tipo === 'devolucao' ? 'Quem devolveu e o quê' : 'Opcional'}"></label>
    </div>
    <div id="nf-dup"></div>
  </div>
  <div class="card stack">
    <div class="row"><h2>Itens recebidos</h2><span class="spacer"></span><button class="btn" id="nf-add">+ Adicionar item</button></div>
    <div class="tbl-wrap"><table class="lines"><thead><tr><th style="min-width:260px">Item do estoque</th><th class="n" style="width:110px">Qtd na nota</th>${N.importado ? '<th class="n" style="width:90px" title="Quantas unidades de estoque vêm em cada unidade da nota">Fator</th>' : ''}<th class="n" style="width:110px">Entra no estoque</th>${isNF ? '<th class="n" style="width:130px">Custo unit. (R$)</th><th class="n" style="width:120px">Subtotal</th>' : ''}<th style="width:44px"></th></tr></thead>
    <tbody id="nf-lines"></tbody></table></div>
    <div class="total-bar" id="nf-tot"></div>
  </div>
  <div class="row"><span class="spacer"></span><span class="muted small" id="nf-msg"></span><button class="btn pri" id="nf-save" ${S.canWrite === false ? 'disabled' : ''}>Registrar entrada</button></div>`;

  const bind = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { N[key] = el.value; if (key === 'nf' || key === 'fornecedor' || key === 'cnpj') checkDup(); }; };
  bind('nf-data', 'data'); bind('nf-num', 'nf'); bind('nf-serie', 'serie'); bind('nf-forn', 'fornecedor'); bind('nf-cnpj', 'cnpj'); bind('nf-emis', 'emissao'); bind('nf-obs', 'obs');
  $('#nf-tipo').onchange = (e) => { N.tipo = e.target.value; render(); };
  $('#nf-limpar').onclick = () => { S.nf = newNF(); render(); };
  $('#nf-add').onclick = () => { N.linhas.push(newLinhaNF()); renderNFLines(); const ins = $$('#nf-lines input[data-k="nome"]'); ins[ins.length - 1]?.focus(); };
  $('#nf-save').onclick = saveNF;
  const xml = $('#nf-xml'); if (xml) xml.onchange = (e) => e.target.files[0] && importXML(e.target.files[0]);
  const drop = $('#nf-drop');
  if (drop) {
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; f && importXML(f); };
  }
  renderNFLines(); checkDup();
}
function renderNFLines() {
  const N = S.nf; const isNF = N.tipo === 'compra'; const tb = $('#nf-lines'); if (!tb) return;
  /* Tira o foco antes de redesenhar: evita o evento de saída do campo no meio da troca das linhas. */
  if (tb.contains(document.activeElement)) document.activeElement.blur();
  tb.innerHTML = N.linhas.map((l, i) => {
    const it = itemByName(l.nome); const est = (parseNumLoose(l.qtd) || 0) * (Number(l.fator) || 1);
    const sub = (parseNumLoose(l.qtd) || 0) * (parseNumLoose(l.custo) || 0);
    return `<tr data-i="${i}"><td>${l.nfp ? `<div class="nfp">NF: <b>${esc(l.nfp.xProd)}</b> · ${esc(l.nfp.uCom)} · cód. ${esc(l.nfp.cProd)}</div>` : ''}
      <input class="i ${l.nome && !it && !l.novo ? 'bad' : ''}" data-k="nome" list="ess-dl-itens" value="${esc(l.nome)}" placeholder="Digite para buscar o item">
      ${l.nome && !it ? `<label class="small row" style="gap:6px;margin-top:5px;color:var(--muted)"><input type="checkbox" data-k="novo" ${l.novo ? 'checked' : ''}> Cadastrar como item novo
        ${l.novo ? `<select class="i" data-k="cat" style="padding:4px 6px">${catList().map((c) => `<option ${c === l.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><input class="i" data-k="und" value="${esc(l.und)}" style="width:64px;padding:4px 6px" title="Unidade">` : ''}</label>` : ''}</td>
      <td><input class="i" data-k="qtd" value="${esc(l.qtd)}" inputmode="decimal" style="text-align:right"></td>
      ${N.importado ? `<td><input class="i" data-k="fator" value="${esc(l.fator)}" inputmode="decimal" style="text-align:right"></td>` : ''}
      <td class="n"><b>${num(est, 2)}</b> <span class="muted small">${esc(it ? it.und : (l.novo ? l.und : ''))}</span></td>
      ${isNF ? `<td><input class="i" data-k="custo" value="${esc(l.custo)}" inputmode="decimal" style="text-align:right" placeholder="0,00"></td><td class="n">${brl(sub)}</td>` : ''}
      <td><button class="btn ghost danger" data-del title="Remover linha" aria-label="Remover linha">✕</button></td></tr>`;
  }).join('');
  $$('tr', tb).forEach((tr) => {
    const i = +tr.dataset.i; const l = N.linhas[i];
    $$('[data-k]', tr).forEach((el) => {
      const k = el.dataset.k;
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'change';
      el.addEventListener(ev, () => { l[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'novo' && l.novo && !l.cat) l.cat = catList()[0] || ''; renderNFLines(); });
      if (k === 'qtd' || k === 'custo' || k === 'fator') el.addEventListener('input', () => { l[k] = el.value; updNFTot(); });
    });
    $('[data-del]', tr).onclick = () => { N.linhas.splice(i, 1); if (!N.linhas.length) N.linhas.push(newLinhaNF()); renderNFLines(); };
  });
  updNFTot();
}
function updNFTot() {
  const N = S.nf; const el = $('#nf-tot'); if (!el) return;
  const q = N.linhas.filter((l) => l.nome).length;
  const tot = N.linhas.reduce((a, l) => a + (parseNumLoose(l.qtd) || 0) * (parseNumLoose(l.custo) || 0), 0);
  el.innerHTML = `<span>${q} ${q === 1 ? 'item' : 'itens'}</span>${N.tipo === 'compra' ? `<span>Total dos itens <b>${brl(tot)}</b></span>${N.valorNota ? `<span class="muted">Valor da NF ${brl(N.valorNota)}</span>` : ''}` : ''}`;
}
function checkDup() {
  const N = S.nf; const el = $('#nf-dup'); if (!el) return;
  const dup = acharDup(N);
  el.innerHTML = dup ? `<div class="banner err">A NF ${esc(dup.nf)} de ${esc(dup.fornecedor)} já foi lançada em ${dBR(dup.data)}. Não é possível registrar de novo. Se for uma correção, exclua o lançamento antigo em Movimentações.</div>` : '';
}
function acharDup(N) {
  if (N.tipo !== 'compra') return null;
  return S.entradas.find((e) => e.tipo === 'compra' && ((N.chave && e.chave === N.chave) || (N.nf && e.nf === N.nf.trim() && (e.serie || '') === (N.serie || '').trim() && N.fornecedor && Core.norm(e.fornecedor) === Core.norm(N.fornecedor)))) || null;
}
/* ID fixo por nota: duas gravações da mesma NF caem no mesmo documento */
function nfDocId(N) {
  const base = N.chave ? 'chave_' + N.chave.replace(/\D/g, '')
    : ['nf', (N.cnpj || '').replace(/\D/g, '') || Core.norm(N.fornecedor).replace(/ /g, '-'), (N.serie || '0').trim(), N.nf.trim()].join('_');
  return base.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 120);
}
async function importXML(file) {
  try {
    const txt = await file.text();
    const nfe = Core.parseNFe(txt, DOMParser);
    const N = S.nf;
    Object.assign(N, { tipo: 'compra', nf: nfe.nf, serie: nfe.serie, fornecedor: nfe.fornecedor, cnpj: nfe.cnpj, chave: nfe.chave, emissao: nfe.emissao, valorNota: nfe.valorNota, importado: true });
    const its = itemList();
    N.linhas = nfe.itens.map((p) => {
      const key = `${nfe.cnpj}|${p.cProd}`;
      let match = its.find((i) => i.vinculos && i.vinculos[key] != null);
      let fator = match ? Number(match.vinculos[key]) || 1 : 1;
      if (!match) { let best = null, bs = 0; its.forEach((i) => { const sc = Core.similar(p.xProd, i.nome); if (sc > bs) { bs = sc; best = i; } }); if (bs >= 0.55) match = best; }
      return { nome: match ? match.nome : p.xProd, qtd: String(p.qCom).replace('.', ','), custo: p.vUnCom ? p.vUnCom.toFixed(2).replace('.', ',') : '', fator, nfp: p, novo: false, cat: catList()[0] || '', und: (p.uCom || 'UN').toUpperCase() };
    });
    render();
    const sem = N.linhas.filter((l) => !itemByName(l.nome)).length;
    toast(`NF ${nfe.nf} importada com ${nfe.itens.length} itens${sem ? ` · ${sem} sem vínculo, confira` : ''}`);
  } catch (e) { toast(e.message || 'Não consegui ler este XML.'); }
}
async function saveNF() {
  const N = S.nf; const msg = $('#nf-msg');
  const linhas = N.linhas.filter((l) => l.nome.trim() || l.qtd);
  const errs = [];
  if (!N.data) errs.push('informe a data');
  if (N.tipo === 'compra' && !N.nf.trim()) errs.push('informe o número da nota');
  if (N.tipo === 'compra' && !N.fornecedor.trim()) errs.push('informe o fornecedor');
  if (!linhas.length) errs.push('adicione ao menos um item');
  linhas.forEach((l, i) => {
    if (!itemByName(l.nome) && !l.novo) errs.push(`linha ${i + 1}: escolha um item da lista ou marque "item novo"`);
    if (!(parseNumLoose(l.qtd) > 0)) errs.push(`linha ${i + 1}: quantidade inválida`);
  });
  if (N.data > todayIso()) errs.push('a data não pode ser futura');
  const dupNF = acharDup(N);
  if (dupNF) errs.push(`a NF ${dupNF.nf} de ${dupNF.fornecedor} já foi lançada em ${dBR(dupNF.data)}`);
  if (errs.length) { msg.textContent = 'Falta: ' + errs.slice(0, 3).join('; ') + (errs.length > 3 ? '…' : ''); msg.style.color = 'var(--rupt)'; return; }
  const btn = $('#nf-save'); btn.disabled = true; msg.textContent = 'Salvando…'; msg.style.color = '';
  try {
    const itensDoc = []; const vinculos = [];
    for (const l of linhas) {
      let it = itemByName(l.nome);
      if (!it) {
        const ref = S.db.collection('itens').doc();
        const body = { nome: l.nome.trim(), categoria: l.cat || 'Outros', und: (l.und || 'UN').toUpperCase(), custo: null, minManual: null, ativo: true, criadoEm: new Date().toISOString() };
        await write(() => ref.set(body)); it = { id: ref.id, ...body }; S.items[ref.id] = it;
      }
      const fator = parseNumLoose(l.fator) || 1;
      const qtdNota = parseNumLoose(l.qtd); const custoNota = parseNumLoose(l.custo);
      const qtd = Math.round(qtdNota * fator * 1000) / 1000;
      const custo = custoNota > 0 ? Math.round(custoNota / fator * 10000) / 10000 : null;
      itensDoc.push({ item: it.id, qtd, custo, ...(l.nfp ? { cProd: l.nfp.cProd, xProd: l.nfp.xProd, qtdNota, uCom: l.nfp.uCom } : {}) });
      if (l.nfp && N.cnpj) {
        const key = `${N.cnpj}|${l.nfp.cProd}`;
        if (!it.vinculos || it.vinculos[key] !== fator) vinculos.push({ id: it.id, key, fator });
      }
    }
    const body = { data: N.data, tipo: N.tipo, nf: N.nf.trim(), serie: N.serie.trim(), fornecedor: N.fornecedor.trim(), cnpj: N.cnpj.trim(), chave: N.chave, emissao: N.emissao, obs: N.obs.trim(),
      itens: itensDoc, valorTotal: itensDoc.reduce((a, l) => a + (l.custo || 0) * l.qtd, 0), criadoPor: S.uid, criadoEm: new Date().toISOString(), origem: N.importado ? 'xml' : 'manual' };
    /* A entrada é o que importa: grava primeiro. Nota de compra usa ID fixo + trava curta,
       então duas pessoas (ou uma nova tentativa) não criam a mesma NF duas vezes. */
    if (N.tipo === 'compra') {
      const id = nfDocId(N);
      const ref = S.db.doc('entradas/' + id);
      const lock = await write(() => S.db.doc('locks/' + id).acquire({ holder: S.uid || 'anon', ttlMs: 15000 }));
      if (!lock.acquired) throw new Error('Outra pessoa está lançando esta nota agora. Aguarde um instante e confira em Movimentações.');
      const snap = await ref.get();
      if (snap.exists) throw new Error('Esta NF já foi lançada. Confira em Movimentações.');
      await write(() => ref.set(body));
    } else {
      const ref = S.db.collection('entradas').doc();
      await write(() => ref.set(body));
    }
    /* Passos secundários: se falharem, a entrada já está salva e o usuário é avisado */
    let aviso = '';
    try {
      for (const v of vinculos) await write(() => S.db.doc('itens/' + v.id).update({ vinculos: { [v.key]: v.fator } }));
      if (N.fornecedor.trim() && !(S.config.fornecedores || []).includes(N.fornecedor.trim())) {
        await saveConfig({ fornecedores: [...(S.config.fornecedores || []), N.fornecedor.trim()].sort((a, b) => a.localeCompare(b, 'pt-BR')) });
      }
      if (N.pedidoId && S.pedidos.some((p) => p.id === N.pedidoId)) await write(() => S.db.doc('pedidos/' + N.pedidoId).update({ status: 'recebido', recebidoEm: N.data }));
    } catch (e2) { console.error(e2); aviso = ' (a nota foi salva, mas não consegui atualizar vínculo, fornecedor ou pedido)'; }
    S.nf = newNF();
    toast(`Entrada registrada: ${itensDoc.length} ${itensDoc.length === 1 ? 'item' : 'itens'} no estoque${aviso}`);
    render();
  } catch (e) { btn.disabled = false; msg.textContent = ''; showErr(e); }
}

/* ---------- SAÍDA ---------- */
function newSD() { return { tipo: 'requisicao', data: todayIso(), responsavel: '', loja: '', obs: '', linhas: [{ nome: '', qtd: '' }] }; }
function viewSaida(m) {
  if (!S.sd) S.sd = newSD();
  const D = S.sd;
  m.innerHTML = `
  <div class="top"><div><h1>Saída de mercadoria</h1><p>Registre o que foi retirado do estoque, por quem e para qual loja ou setor.</p></div>
  <div class="row"><button class="btn" id="sd-limpar">Limpar formulário</button></div></div>
  ${readOnlyNote()}
  <div class="card"><div class="fgrid">
    <label class="f">Tipo de saída<select class="i" id="sd-tipo">${Object.entries(TIPOS_SAI).map(([k, v]) => `<option value="${k}" ${k === D.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="f">Data<input class="i" type="date" id="sd-data" value="${esc(D.data)}"></label>
    <label class="f">Solicitante<input class="i" id="sd-resp" list="ess-dl-sol" value="${esc(D.responsavel)}" placeholder="Quem retirou"></label>
    <label class="f">Loja / setor<select class="i" id="sd-loja"><option value="">Escolha…</option>${(S.config.lojas || []).map((x) => `<option ${x === D.loja ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <label class="f w4">Observação<input class="i" id="sd-obs" value="${esc(D.obs)}" placeholder="${D.tipo === 'emprestimo' ? 'Prazo de devolução' : 'Opcional'}"></label>
  </div></div>
  <div class="card stack">
    <div class="row"><h2>Itens retirados</h2><span class="spacer"></span><button class="btn" id="sd-add">+ Adicionar item</button></div>
    <div class="tbl-wrap"><table class="lines"><thead><tr><th style="min-width:260px">Item</th><th class="n" style="width:140px">Disponível</th><th class="n" style="width:120px">Quantidade</th><th class="n" style="width:140px">Saldo após</th><th style="width:44px"></th></tr></thead><tbody id="sd-lines"></tbody></table></div>
  </div>
  <div class="row"><span class="spacer"></span><span class="muted small" id="sd-msg"></span><button class="btn pri" id="sd-save" ${S.canWrite === false ? 'disabled' : ''}>Registrar saída</button></div>
  <div class="card stack"><h2>Últimas saídas</h2>${movList(S.saidas.map((s) => ({ ...s, _k: 'sai' })).sort(movSort).slice(0, 6))}</div>`;
  const bind = (id, key, ev = 'input') => { $('#' + id).addEventListener(ev, (e) => { D[key] = e.target.value; }); };
  bind('sd-data', 'data'); bind('sd-resp', 'responsavel'); bind('sd-loja', 'loja', 'change'); bind('sd-obs', 'obs');
  $('#sd-tipo').onchange = (e) => { D.tipo = e.target.value; render(); };
  $('#sd-limpar').onclick = () => { S.sd = newSD(); render(); };
  $('#sd-add').onclick = () => { D.linhas.push({ nome: '', qtd: '' }); renderSDLines(); const ins = $$('#sd-lines input[data-k="nome"]'); ins[ins.length - 1]?.focus(); };
  $('#sd-save').onclick = saveSD;
  bindMovList(m);
  renderSDLines();
}
function renderSDLines() {
  const D = S.sd; const tb = $('#sd-lines'); if (!tb) return;
  /* Tira o foco antes de redesenhar: evita o evento de saída do campo no meio da troca das linhas. */
  if (tb.contains(document.activeElement)) document.activeElement.blur();
  const usado = {};
  tb.innerHTML = D.linhas.map((l, i) => {
    const it = itemByName(l.nome); const r = it && S.calc.byId[it.id];
    const q = parseNumLoose(l.qtd) || 0;
    if (it) usado[it.id] = (usado[it.id] || 0) + q;
    const disp = r ? r.saldo : null; const apos = r ? disp - usado[it.id] : null;
    return `<tr data-i="${i}"><td><input class="i ${l.nome && !it ? 'bad' : ''}" data-k="nome" list="ess-dl-itens" value="${esc(l.nome)}" placeholder="Digite para buscar o item"></td>
    <td class="n">${r ? `${num(disp, 2)} <span class="muted small">${esc(it.und)}</span>` : '—'}</td>
    <td><input class="i" data-k="qtd" value="${esc(l.qtd)}" inputmode="decimal" style="text-align:right"></td>
    <td class="n ${apos != null && apos < 0 ? 'neg' : ''}">${apos == null ? '—' : num(apos, 2)}${apos != null && apos < 0 ? ' · insuficiente' : ''}</td>
    <td><button class="btn ghost danger" data-del aria-label="Remover linha">✕</button></td></tr>`;
  }).join('');
  $$('tr', tb).forEach((tr) => {
    const l = D.linhas[+tr.dataset.i];
    $$('[data-k]', tr).forEach((el) => el.addEventListener('change', () => { l[el.dataset.k] = el.value; renderSDLines(); }));
    $('[data-del]', tr).onclick = () => { D.linhas.splice(+tr.dataset.i, 1); if (!D.linhas.length) D.linhas.push({ nome: '', qtd: '' }); renderSDLines(); };
  });
}
async function saveSD() {
  const D = S.sd; const msg = $('#sd-msg');
  const linhas = D.linhas.filter((l) => l.nome.trim() || l.qtd);
  const errs = [];
  if (!D.data) errs.push('informe a data');
  if (D.data > todayIso()) errs.push('a data não pode ser futura');
  if (D.tipo !== 'ajuste' && !D.responsavel.trim()) errs.push('informe o solicitante');
  if (D.tipo !== 'ajuste' && !D.loja) errs.push('escolha a loja ou setor');
  if (!linhas.length) errs.push('adicione ao menos um item');
  const usado = {};
  linhas.forEach((l, i) => {
    const it = itemByName(l.nome); const q = parseNumLoose(l.qtd);
    if (!it) errs.push(`linha ${i + 1}: escolha um item da lista`);
    if (!(q > 0)) errs.push(`linha ${i + 1}: quantidade inválida`);
    if (it && q > 0) { usado[it.id] = (usado[it.id] || 0) + q; if (usado[it.id] > S.calc.byId[it.id].saldo) errs.push(`${it.nome}: saldo insuficiente (${num(S.calc.byId[it.id].saldo, 2)} disponível). Lance a entrada antes`); }
  });
  if (errs.length) { msg.textContent = 'Falta: ' + errs.slice(0, 3).join('; ') + (errs.length > 3 ? '…' : ''); msg.style.color = 'var(--rupt)'; return; }
  const btn = $('#sd-save'); btn.disabled = true; msg.textContent = 'Salvando…'; msg.style.color = '';
  try {
    const body = { data: D.data, tipo: D.tipo, responsavel: D.responsavel.trim(), loja: D.loja, obs: D.obs.trim(), itens: linhas.map((l) => ({ item: itemByName(l.nome).id, qtd: parseNumLoose(l.qtd) })), criadoPor: S.uid, criadoEm: new Date().toISOString() };
    const refSd = S.db.collection('saidas').doc(); /* ID criado uma vez: nova tentativa não duplica a saída */
    await write(() => refSd.set(body));
    if (body.responsavel && !(S.config.solicitantes || []).includes(body.responsavel)) await saveConfig({ solicitantes: [...(S.config.solicitantes || []), body.responsavel].sort((a, b) => a.localeCompare(b, 'pt-BR')) });
    S.sd = { ...newSD(), responsavel: '', loja: D.loja, data: D.data };
    toast(`Saída registrada: ${body.itens.length} ${body.itens.length === 1 ? 'item' : 'itens'} para ${body.loja || 'ajuste'}`);
    render();
  } catch (e) { btn.disabled = false; msg.textContent = ''; showErr(e); }
}


/* ---------- PEDIDO DE COMPRA ---------- */
const ST_PED = { aberto: 'Aberto', enviado: 'Enviado', recebido: 'Recebido', cancelado: 'Cancelado' };
const SEM_FORN = 'Sem fornecedor definido';
function pedLinha(r) {
  if (!S.ped[r.id]) S.ped[r.id] = { qtd: r.comprar > 0 ? String(r.comprar) : '', on: r.comprar > 0 };
  return S.ped[r.id];
}
function viewPedido(m) {
  const C = S.calc; const U = S.ui;
  const abertos = new Set(S.pedidos.filter((p) => p.status === 'aberto' || p.status === 'enviado').flatMap((p) => p.itens.map((l) => l.item)));
  const rows = C.rows.filter((r) => r.item.ativo !== false && U.pedSt.includes(r.status))
    .sort((a, b) => Core.ALERTA.indexOf(a.status) - Core.ALERTA.indexOf(b.status) || a.item.nome.localeCompare(b.item.nome, 'pt-BR'));
  const grupos = {};
  rows.forEach((r) => { const f = (r.item.fornecedor || '').trim() || SEM_FORN; (grupos[f] ||= []).push(r); });
  const nomes = Object.keys(grupos).sort((a, b) => (a === SEM_FORN) - (b === SEM_FORN) || a.localeCompare(b, 'pt-BR'));
  const cnt = (s) => C.rows.filter((r) => r.item.ativo !== false && r.status === s).length;
  const ro = S.canWrite === false;
  const grupoHtml = (f) => {
    const lst = grupos[f]; let tot = 0, temSemCusto = false;
    lst.forEach((r) => { const l = pedLinha(r); const q = parseNumLoose(l.qtd) || 0; if (l.on && q > 0) { if (r.custo != null) tot += q * r.custo; else temSemCusto = true; } });
    const n = lst.filter((r) => { const l = pedLinha(r); return l.on && parseNumLoose(l.qtd) > 0; }).length;
    return `<div class="card stack" data-forn="${esc(f)}"><div class="row"><h2>${esc(f)}</h2>${f === SEM_FORN ? '<span class="muted small">Defina o fornecedor na linha para incluir no pedido</span>' : ''}<span class="spacer"></span>
      <span class="muted small">${n} ${n === 1 ? 'item' : 'itens'} · <b>${brl(tot)}</b>${temSemCusto ? ' + itens sem custo' : ''}</span>
      <button class="btn" data-copy="${esc(f)}" ${n ? '' : 'disabled'}>Copiar pedido</button>
      ${f !== SEM_FORN && !ro ? `<button class="btn pri" data-gerar="${esc(f)}" ${n ? '' : 'disabled'}>Gerar pedido</button>` : ''}</div>
      <div class="tbl-wrap"><table class="lines"><thead><tr><th style="width:36px"></th><th>Item</th><th>Status</th><th class="n">Saldo</th><th class="n">Mínimo</th><th class="n">Sugerido</th><th class="n" style="width:110px">Pedir</th><th class="n">Custo unit.</th><th class="n">Total</th><th style="min-width:170px">Fornecedor</th></tr></thead><tbody>
      ${lst.map((r) => { const l = pedLinha(r); const q = parseNumLoose(l.qtd) || 0; return `<tr data-id="${r.id}">
        <td><input type="checkbox" data-k="on" ${l.on ? 'checked' : ''} aria-label="Incluir ${esc(r.item.nome)}"></td>
        <td>${esc(r.item.nome)}${abertos.has(r.id) ? ' <span class="pill sai" title="Já existe pedido aberto ou enviado com este item">já pedido</span>' : ''}</td>
        <td><span class="pill ${r.status}">${r.status}</span></td>
        <td class="n ${r.saldo < 0 ? 'neg' : ''}">${num(r.saldo, 2)}</td><td class="n">${num(r.minimo)}</td><td class="n">${num(r.comprar)}</td>
        <td><input class="i" data-k="qtd" value="${esc(l.qtd)}" inputmode="decimal" style="text-align:right" placeholder="0"></td>
        <td class="n">${r.custo != null ? brl(r.custo) : '<span class="muted">—</span>'} <span class="muted small">/${esc(r.item.und)}</span></td>
        <td class="n">${r.custo != null && l.on ? brl(q * r.custo) : ''}</td>
        <td><input class="i" data-k="forn" list="ess-dl-forn" value="${esc(r.item.fornecedor || '')}" placeholder="Fornecedor" ${ro ? 'disabled' : ''}></td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  };
  const peds = S.pedidos.slice().sort((a, b) => (b.numero || '').localeCompare(a.numero || ''));
  m.innerHTML = `
  <div class="top"><div><h1>Pedido de compra</h1><p>Itens que precisam de reposição, separados por fornecedor. A quantidade sugerida repõe o mínimo e mais ${C.params.coberturaAlvo} dias de consumo. Ajuste à vontade.</p></div></div>
  ${readOnlyNote()}
  <div class="row"><span class="muted small">Mostrar:</span><div class="chips">${['RUPTURA', 'CRÍTICO', 'ATENÇÃO'].map((s) => `<button class="chip ${U.pedSt.includes(s) ? 'on' : ''}" data-pst="${s}">${s.charAt(0) + s.slice(1).toLowerCase()} · ${cnt(s)}</button>`).join('')}</div></div>
  ${nomes.length ? nomes.map(grupoHtml).join('') : '<div class="card empty">Nenhum item precisa de compra com esse filtro.</div>'}
  <div class="card stack"><h2>Pedidos gerados</h2>
  ${peds.length ? `<div class="tbl-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th class="n">Itens</th><th class="n">Total estimado</th><th>Status</th><th></th></tr></thead><tbody>
  ${peds.map((p) => `<tr data-ped="${esc(p.id)}"><td class="mono">${esc(p.numero)}</td><td>${dBR(p.data)}</td><td>${esc(p.fornecedor)}</td><td class="n">${p.itens.length}</td><td class="n">${brl(p.total)}</td>
    <td><select class="i" data-pstatus ${ro ? 'disabled' : ''}>${Object.entries(ST_PED).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn ghost" data-pver>Ver</button><button class="btn ghost" data-ppdf>PDF</button><button class="btn ghost" data-pxlsx>Excel</button>${!ro && p.status !== 'recebido' && p.status !== 'cancelado' ? '<button class="btn ghost" data-preceber>Dar entrada</button>' : ''}${ro ? '' : '<button class="btn ghost danger" data-pdel aria-label="Excluir pedido">✕</button>'}</div></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">Nenhum pedido gerado ainda. Clique em "Gerar pedido" num fornecedor acima.</div>'}</div>`;

  $$('[data-pst]', m).forEach((b) => b.onclick = () => { const s = b.dataset.pst; U.pedSt = U.pedSt.includes(s) ? U.pedSt.filter((x) => x !== s) : [...U.pedSt, s]; render(); });
  $$('tr[data-id]', m).forEach((tr) => {
    const id = tr.dataset.id; const l = S.ped[id];
    $('[data-k="on"]', tr).onchange = (e) => { l.on = e.target.checked; render(); };
    const qi = $('[data-k="qtd"]', tr); qi.onchange = () => { l.qtd = qi.value; if (parseNumLoose(qi.value) > 0) l.on = true; render(); };
    const fi = $('[data-k="forn"]', tr);
    fi.onchange = async () => {
      const v = fi.value.trim(); if (v === (S.items[id].fornecedor || '')) return;
      try {
        await write(() => S.db.doc('itens/' + id).update({ fornecedor: v }));
        if (v && !(S.config.fornecedores || []).includes(v)) await saveConfig({ fornecedores: [...(S.config.fornecedores || []), v].sort((a, b) => a.localeCompare(b, 'pt-BR')) });
        toast(v ? `${S.items[id].nome} agora é comprado de ${v}` : 'Fornecedor removido');
      } catch (e) { showErr(e); }
    };
  });
  const linhasDe = (f) => grupos[f].map((r) => ({ r, q: parseNumLoose(S.ped[r.id].qtd) || 0, on: S.ped[r.id].on })).filter((x) => x.on && x.q > 0);
  $$('[data-copy]', m).forEach((b) => b.onclick = () => { const f = b.dataset.copy; const ls = linhasDe(f); copyText(textoPedido({ numero: '', data: todayIso(), fornecedor: f === SEM_FORN ? '' : f, itens: ls.map((x) => ({ item: x.r.id, qtd: x.q, custo: x.r.custo })) }), 'Pedido copiado. Cole no WhatsApp ou no e-mail do fornecedor.'); });
  $$('[data-gerar]', m).forEach((b) => b.onclick = async () => {
    const f = b.dataset.gerar; const ls = linhasDe(f); if (!ls.length) return;
    b.disabled = true;
    const itens = ls.map((x) => ({ item: x.r.id, qtd: x.q, custo: x.r.custo ?? null }));
    const body = { numero: proxNumero(), data: todayIso(), fornecedor: f, status: 'aberto', itens, total: itens.reduce((a, l) => a + (l.custo || 0) * l.qtd, 0), criadoPor: S.uid, criadoEm: new Date().toISOString() };
    try {
      const refPd = S.db.collection('pedidos').doc();
      await write(() => refPd.set(body));
      ls.forEach((x) => { delete S.ped[x.r.id]; });
      toast(`Pedido ${body.numero} gerado para ${f}. Baixe em PDF ou Excel.`);
      verPedido(body);
    } catch (e) { b.disabled = false; showErr(e); }
  });
  $$('tr[data-ped]', m).forEach((tr) => {
    const p = S.pedidos.find((x) => x.id === tr.dataset.ped); if (!p) return;
    $('[data-pver]', tr).onclick = () => verPedido(p);
    $('[data-ppdf]', tr).onclick = (e) => baixarPedido(p, 'pdf', e.currentTarget);
    $('[data-pxlsx]', tr).onclick = (e) => baixarPedido(p, 'xlsx', e.currentTarget);
    const st = $('[data-pstatus]', tr); st.onchange = async () => { try { await write(() => S.db.doc('pedidos/' + p.id).update({ status: st.value })); toast(`Pedido ${p.numero}: ${ST_PED[st.value]}`); } catch (e) { showErr(e); } };
    const rc = $('[data-preceber]', tr); if (rc) rc.onclick = () => receberPedido(p);
    const dl = $('[data-pdel]', tr); if (dl) dl.onclick = () => confirmBox('Excluir pedido?', `O pedido ${esc(p.numero)} de ${esc(p.fornecedor)} será apagado. O estoque não muda.`, 'Excluir', async () => { await write(() => S.db.doc('pedidos/' + p.id).delete()); toast('Pedido excluído'); });
  });
}
function proxNumero() {
  const ano = todayIso().slice(0, 4);
  const max = S.pedidos.map((p) => (p.numero || '').match(/^PC-(\d{4})-(\d+)$/)).filter((x) => x && x[1] === ano).reduce((a, x) => Math.max(a, +x[2]), 0);
  return `PC-${ano}-${String(max + 1).padStart(3, '0')}`;
}
function textoPedido(p) {
  const linhas = p.itens.map((l) => { const it = S.items[l.item] || { nome: '?', und: '' }; return `• ${num(l.qtd, 2)} ${it.und} — ${it.nome}${l.custo ? ` (ref. ${brl(l.custo)}/${it.und})` : ''}`; });
  const tot = p.itens.reduce((a, l) => a + (l.custo || 0) * l.qtd, 0);
  return [`PEDIDO DE COMPRA${p.numero ? ' ' + p.numero : ''} — SFERA`, `Data: ${dBR(p.data)}`, p.fornecedor ? `Fornecedor: ${p.fornecedor}` : null, '', ...linhas, '', tot ? `Total estimado: ${brl(tot)}` : null, 'Entrega: ADM / Suprimentos', 'Por favor, confirmar disponibilidade, valor e prazo de entrega.'].filter((x) => x !== null).join('\n');
}

/* ---------- Pedido de compra em PDF e Excel ---------- */
const JSPDF_SRC = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
const AUTOTABLE_SRC = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
const AUTOTABLE_SRI = 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3';
const ENTREGA_PEDIDO = 'Sfera Multifranquias · ADM / Suprimentos';
function carregarScript(src, sri) {
  return new Promise((ok, ko) => {
    const el = document.createElement('script');
    el.src = src; el.integrity = sri; el.crossOrigin = 'anonymous';
    el.onload = ok; el.onerror = () => ko(new Error('Não foi possível carregar o gerador de PDF. Verifique a internet.'));
    document.head.appendChild(el);
  });
}
async function jsPdfPronto() {
  if (!(global.jspdf && global.jspdf.jsPDF)) await carregarScript(JSPDF_SRC, JSPDF_SRI);
  if (!global.jspdf.jsPDF.API.autoTable) await carregarScript(AUTOTABLE_SRC, AUTOTABLE_SRI);
  return global.jspdf.jsPDF;
}
/* Dados do fornecedor no cadastro de Suprimentos (CNPJ, contato), quando existir. */
async function dadosFornecedor(nome) {
  if (!nome || !SB) return null;
  try {
    const { data } = await SB.from('sup_fornecedores').select('nome,cnpj,contato,telefone,email').ilike('nome', nome.trim()).limit(1);
    return (data && data[0]) || null;
  } catch (e) { return null; }
}
function linhasPedido(p) {
  return (p.itens || []).map((l, i) => {
    const it = S.items[l.item] || { nome: 'item excluído', und: '' };
    const custo = l.custo == null || l.custo === '' ? null : Number(l.custo);
    const qtd = Number(l.qtd) || 0;
    return { n: i + 1, nome: it.nome, und: it.und || '', qtd, custo, total: custo == null ? null : Math.round(custo * qtd * 100) / 100 };
  });
}
const arqPedido = (p, ext) => `Pedido_${p.numero || 'compra'}_${(Core.norm(p.fornecedor || 'fornecedor').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fornecedor').slice(0, 30)}.${ext}`;
async function baixarPedidoPdf(p) {
  const JsPDF = await jsPdfPronto();
  const forn = await dadosFornecedor(p.fornecedor);
  const linhas = linhasPedido(p);
  const total = linhas.reduce((a, l) => a + (l.total || 0), 0);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(); const M = 14;
  const money = (v) => v == null ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('SFERA MULTIFRANQUIAS', M, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Suprimentos  ·  Pedido de compra', M, 18);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Pedido Nº ' + (p.numero || ''), W - M, 11, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Data: ' + dBR(p.data), W - M, 18, { align: 'right' });
  const y = 34; const half = (W - 2 * M - 6) / 2;
  const bloco = (x, titulo, ls) => {
    doc.setDrawColor(210); doc.setFillColor(247, 248, 250); doc.roundedRect(x, y, half, 28, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(110); doc.text(titulo.toUpperCase(), x + 4, y + 6);
    doc.setTextColor(30);
    ls.filter(Boolean).slice(0, 4).forEach((t, i) => { doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 11 : 9); doc.text(doc.splitTextToSize(String(t), half - 8)[0], x + 4, y + 12.5 + i * 4.8); });
  };
  bloco(M, 'Fornecedor', [p.fornecedor || 'A definir', forn && forn.cnpj ? 'CNPJ: ' + forn.cnpj : null,
    forn && (forn.contato || forn.telefone) ? [forn.contato, forn.telefone].filter(Boolean).join(' · ') : null, forn && forn.email ? forn.email : null]);
  bloco(M + half + 6, 'Entregar em', ['Sfera Multifranquias', 'ADM / Suprimentos', 'Status: ' + (ST_PED[p.status] || p.status || '')]);
  doc.autoTable({
    startY: y + 34, margin: { left: M, right: M },
    head: [['#', 'Produto', 'Und', 'Qtd', 'Valor unit.', 'Valor total']],
    body: linhas.map((l) => [String(l.n), l.nome, l.und, Number(l.qtd).toLocaleString('pt-BR', { maximumFractionDigits: 3 }), money(l.custo), money(l.total)]),
    foot: [[{ content: linhas.length + (linhas.length === 1 ? ' item' : ' itens'), colSpan: 4, styles: { halign: 'left', fontStyle: 'normal' } }, { content: 'TOTAL', styles: { halign: 'right' } }, { content: money(total), styles: { halign: 'right' } }]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, lineColor: [220, 223, 228], lineWidth: 0.2, textColor: 30 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [238, 241, 245], textColor: 20, fontStyle: 'bold', fontSize: 10 },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 27, halign: 'right' }, 5: { cellWidth: 29, halign: 'right' } },
  });
  const yf = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(doc.splitTextToSize('Valores de referência. Favor confirmar disponibilidade, valor e prazo de entrega, e enviar a nota fiscal com o número deste pedido.', W - 2 * M), M, yf);
  const pages = doc.internal.getNumberOfPages();
  for (let pg = 1; pg <= pages; pg++) {
    doc.setPage(pg); const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(8); doc.setTextColor(140);
    doc.text('Sfera Multifranquias · Pedido ' + (p.numero || '') + ' · ' + (p.fornecedor || ''), M, H - 8);
    doc.text('Página ' + pg + ' de ' + pages, W - M, H - 8, { align: 'right' });
  }
  doc.save(arqPedido(p, 'pdf'));
}
async function baixarPedidoExcel(p) {
  const X = global.XLSX;
  if (!X || !X.utils) throw new Error('Não foi possível carregar o gerador de Excel. Verifique a internet e atualize a página.');
  const forn = await dadosFornecedor(p.fornecedor);
  const linhas = linhasPedido(p);
  const total = Math.round(linhas.reduce((a, l) => a + (l.total || 0), 0) * 100) / 100;
  const aoa = [
    ['SFERA MULTIFRANQUIAS · Pedido de compra'],
    ['Pedido Nº', p.numero || ''],
    ['Data', dBR(p.data)],
    ['Fornecedor', p.fornecedor || ''],
    ['CNPJ', forn && forn.cnpj ? forn.cnpj : ''],
    ['Contato', forn ? [forn.contato, forn.telefone, forn.email].filter(Boolean).join(' · ') : ''],
    ['Entregar em', ENTREGA_PEDIDO],
    [],
    ['#', 'Produto', 'Und', 'Qtd', 'Valor unit.', 'Valor total'],
  ];
  const primeira = aoa.length;
  linhas.forEach((l) => aoa.push([l.n, l.nome, l.und, l.qtd, l.custo == null ? '' : l.custo, l.total == null ? '' : l.total]));
  aoa.push(['', '', '', '', 'TOTAL', total]);
  aoa.push([]);
  aoa.push(['Valores de referência. Favor confirmar disponibilidade, valor e prazo de entrega.']);
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, { wch: 46 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
  for (let r = primeira; r <= primeira + linhas.length; r++) {
    [[3, '#,##0.###'], [4, '"R$" #,##0.00'], [5, '"R$" #,##0.00']].forEach(([c, z]) => {
      const cel = ws[X.utils.encode_cell({ r, c })];
      if (cel && cel.t === 'n') cel.z = z;
    });
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Pedido');
  X.writeFile(wb, arqPedido(p, 'xlsx'));
}
async function baixarPedido(p, formato, botao) {
  if (botao) botao.disabled = true;
  try {
    if (formato === 'xlsx') await baixarPedidoExcel(p); else await baixarPedidoPdf(p);
    toast(`Pedido ${p.numero} baixado em ${formato === 'xlsx' ? 'Excel' : 'PDF'}`);
  } catch (e) { showErr(e); } finally { if (botao) botao.disabled = false; }
}
function verPedido(p) {
  const txt = textoPedido(p);
  dialog(`<div class="dh"><h2>Pedido ${esc(p.numero)}</h2><span class="pill sai">${esc(ST_PED[p.status] || p.status)}</span><span class="spacer"></span><button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
  <div class="db"><div class="row muted small"><span>Fornecedor: <b style="color:var(--ink)">${esc(p.fornecedor)}</b></span><span>Data: ${dBR(p.data)}</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="n">Qtd</th><th class="n">Custo ref.</th><th class="n">Total</th></tr></thead><tbody>
  ${p.itens.map((l) => { const it = S.items[l.item] || { nome: 'item excluído', und: '' }; return `<tr><td>${esc(it.nome)}</td><td class="n">${num(l.qtd, 2)} <span class="muted small">${esc(it.und)}</span></td><td class="n">${l.custo ? brl(l.custo) : '—'}</td><td class="n">${l.custo ? brl(l.custo * l.qtd) : '—'}</td></tr>`; }).join('')}
  </tbody></table></div><div class="total-bar"><span>Total estimado <b>${brl(p.total)}</b></span></div>
  <label class="f">Texto para enviar ao fornecedor<textarea class="i" id="pv-txt" style="min-height:180px;font-family:var(--mono);font-size:12.5px">${esc(txt)}</textarea></label></div>
  <div class="df"><button class="btn" data-close>Fechar</button><span class="spacer"></span><button class="btn" id="pv-copy">Copiar texto</button><button class="btn pri" id="pv-xlsx">Baixar Excel</button><button class="btn pri" id="pv-pdf">Baixar PDF</button></div>`, (d) => {
    $('#pv-copy', d).onclick = () => copyText($('#pv-txt', d).value, 'Pedido copiado. Cole no WhatsApp ou no e-mail do fornecedor.');
    $('#pv-pdf', d).onclick = (e) => baixarPedido(p, 'pdf', e.currentTarget);
    $('#pv-xlsx', d).onclick = (e) => baixarPedido(p, 'xlsx', e.currentTarget);
  });
}
function receberPedido(p) {
  S.nf = Object.assign(newNF(), { tipo: 'compra', fornecedor: p.fornecedor, obs: `Pedido ${p.numero}`, pedidoId: p.id, pedidoNum: p.numero,
    linhas: p.itens.filter((l) => S.items[l.item]).map((l) => ({ ...newLinhaNF(), nome: S.items[l.item].nome, qtd: String(l.qtd).replace('.', ','), custo: l.custo ? String(l.custo.toFixed(2)).replace('.', ',') : '' })) });
  irPara('entrada');
}

/* ---------- ESTOQUE ---------- */
function viewEstoque(m) {
  const C = S.calc; const U = S.ui;
  const sts = ['Todos', 'RUPTURA', 'CRÍTICO', 'ATENÇÃO', 'SEM GIRO', 'OK', 'INATIVO'];
  const cats = ['Todas', ...catList()];
  const q = Core.norm(U.estBusca);
  const rows = C.rows.filter((r) => (U.estFiltro === 'Todos' ? r.status !== 'INATIVO' : r.status === U.estFiltro) && (U.cat === 'Todas' || r.item.categoria === U.cat) && (!q || Core.norm(r.item.nome).includes(q)))
    .sort((a, b) => a.item.categoria.localeCompare(b.item.categoria, 'pt-BR') || a.item.nome.localeCompare(b.item.nome, 'pt-BR'));
  const cnt = (s) => s === 'Todos' ? C.rows.filter((r) => r.status !== 'INATIVO').length : C.rows.filter((r) => r.status === s).length;
  m.innerHTML = `
  <div class="top"><div><h1>Estoque</h1><p>Saldo, mínimo, cobertura e sugestão de compra de cada item. Clique num item para ver o histórico e editar.</p></div>
  <div class="row"><button class="btn" id="e-exp">Exportar planilha</button><button class="btn pri" id="e-novo" ${S.canWrite === false ? 'disabled' : ''}>+ Novo item</button></div></div>
  <div class="row"><input class="i" id="e-busca" placeholder="Buscar item…" value="${esc(U.estBusca)}" style="min-width:220px">
    <select class="i" id="e-cat">${cats.map((c) => `<option ${c === U.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <div class="chips">${sts.map((s) => `<button class="chip ${U.estFiltro === s ? 'on' : ''}" data-st="${s}">${s === 'Todos' ? 'Todos' : s.charAt(0) + s.slice(1).toLowerCase()} · ${cnt(s)}</button>`).join('')}</div></div>
  <div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Categoria</th><th>Und</th><th class="n">Saldo</th><th class="n">Mínimo</th><th class="n">Consumo/dia</th><th class="n">Cobertura</th><th>Últ. saída</th><th>Status</th><th class="n">Comprar</th><th class="n">Custo unit.</th><th class="n">Valor</th></tr></thead><tbody>
  ${rows.map((r) => `<tr class="click" data-item="${r.id}"><td><b style="font-weight:500">${esc(r.item.nome)}</b></td><td class="muted">${esc(r.item.categoria)}</td><td class="muted">${esc(r.item.und)}</td>
  <td class="n ${r.saldo < 0 ? 'neg' : ''}"><b>${num(r.saldo, 2)}</b></td><td class="n">${num(r.minimo)}${r.item.minManual != null && r.item.minManual !== '' ? ' <span class="muted small" title="Mínimo manual">m</span>' : ''}</td>
  <td class="n">${r.consumoDia ? num(r.consumoDia, 2) : '—'}</td><td class="n">${r.cobertura == null ? '—' : r.cobertura <= 0 ? '0 d' : num(r.cobertura) + ' d'}</td><td>${dBR(r.ultSaida)}</td>
  <td><span class="pill ${r.status.replace(' ', '')}">${r.status}</span></td><td class="n">${r.comprar ? `<b>${num(r.comprar)}</b>` : ''}</td><td class="n">${r.custo != null ? brl(r.custo) : '<span class="muted">—</span>'}</td><td class="n">${r.custo != null ? brl(r.valor) : ''}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">Nenhum item com esse filtro.</td></tr>'}
  </tbody></table></div>
  <p class="muted small" style="margin:0">Mínimo = mínimo manual, ou consumo/dia × (${C.params.prazo} dias de reposição + ${C.params.seguranca} de segurança). Custo = último custo da nota de compra, ou o custo cadastrado no item. Consumo médio dos últimos ${C.janelaEf} dias.</p>`;
  const busca = $('#e-busca'); busca.oninput = () => { U.estBusca = busca.value; const pos = busca.selectionStart; render(); const b = $('#e-busca'); b.focus(); b.setSelectionRange(pos, pos); };
  $('#e-cat').onchange = (e) => { U.cat = e.target.value; render(); };
  $$('[data-st]', m).forEach((b) => b.onclick = () => { U.estFiltro = b.dataset.st; render(); });
  bindRows(m, openItem);
  $('#e-novo').onclick = () => openItem(null);
  $('#e-exp').onclick = () => exportar('estoque');
}
function openItem(id) {
  const it = id ? S.items[id] : { nome: '', categoria: catList()[0] || '', und: 'UN', custo: null, minManual: null, ativo: true };
  const r = id ? S.calc.byId[id] : null;
  const movs = [];
  if (id) {
    S.entradas.forEach((e) => e.itens.forEach((l) => { if (l.item === id) movs.push({ data: e.data, k: 'ent', q: +l.qtd, desc: e.tipo === 'compra' ? `NF ${e.nf || 's/n'} · ${e.fornecedor || ''}` : (TIPOS_ENT[e.tipo] || '') + (e.obs ? ' · ' + e.obs : ''), c: e.criadoEm || '' }); }));
    S.saidas.forEach((s) => s.itens.forEach((l) => { if (l.item === id) movs.push({ data: s.data, k: 'sai', q: +l.qtd, desc: [s.responsavel, s.loja, s.tipo !== 'requisicao' ? TIPOS_SAI[s.tipo] : '', s.obs || l.obs].filter(Boolean).join(' · '), c: s.criadoEm || '' }); }));
    movs.sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.k === 'ent' ? -1 : 1));
    let run = 0; movs.forEach((x) => { run += x.k === 'ent' ? x.q : -x.q; x.saldo = run; });
  }
  const ro = S.canWrite === false;
  dialog(`<div class="dh"><h2>${id ? esc(it.nome) : 'Novo item'}</h2>${r ? `<span class="pill ${r.status.replace(' ', '')}">${r.status}</span>` : ''}<span class="spacer"></span><button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
  <div class="db">
    ${r ? `<div class="grid" style="grid-template-columns:repeat(4,1fr)"><div><h3>Saldo</h3><b style="font:700 22px var(--display)" class="${r.saldo < 0 ? 'neg' : ''}">${num(r.saldo, 2)}</b> ${esc(it.und)}</div><div><h3>Mínimo</h3><b style="font:700 22px var(--display)">${num(r.minimo)}</b></div><div><h3>Cobertura</h3><b style="font:700 22px var(--display)">${r.cobertura == null ? '—' : num(Math.max(0, r.cobertura)) + ' d'}</b></div><div><h3>Comprar</h3><b style="font:700 22px var(--display)">${num(r.comprar)}</b></div></div>` : ''}
    <div class="fgrid">
      <label class="f w2">Nome<input class="i" id="it-nome" value="${esc(it.nome)}" ${ro ? 'disabled' : ''}></label>
      <label class="f">Categoria<input class="i" id="it-cat" list="ess-dl-cats" value="${esc(it.categoria)}" ${ro ? 'disabled' : ''}><datalist id="ess-dl-cats">${catList().map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
      <label class="f">Unidade<input class="i" id="it-und" value="${esc(it.und)}" ${ro ? 'disabled' : ''}></label>
      <label class="f">Custo unitário (R$)<input class="i" id="it-custo" inputmode="decimal" value="${it.custo != null ? String(it.custo).replace('.', ',') : ''}" placeholder="${r && r.ultCusto ? 'NF: ' + brl(r.ultCusto) : '0,00'}" ${ro ? 'disabled' : ''}></label>
      <label class="f w2">Fornecedor padrão<input class="i" id="it-forn" list="ess-dl-forn" value="${esc(it.fornecedor || '')}" placeholder="Usado no pedido de compra" ${ro ? 'disabled' : ''}></label>
      <label class="f">Mínimo manual<input class="i" id="it-min" inputmode="numeric" value="${it.minManual ?? ''}" placeholder="automático" ${ro ? 'disabled' : ''}></label>
      <label class="f" style="justify-content:flex-end"><span class="row" style="gap:6px;color:var(--ink);font-weight:500"><input type="checkbox" id="it-ativo" ${it.ativo !== false ? 'checked' : ''} ${ro ? 'disabled' : ''}> Item ativo</span></label>
    </div>
    ${r && r.ultCusto ? `<p class="muted small" style="margin:0">Último custo em nota: ${brl(r.ultCusto)} em ${dBR(r.ultCustoData)}. Ele tem prioridade sobre o custo cadastrado.</p>` : ''}
    ${id ? `<div><h3 style="margin-bottom:8px">Movimentações (kardex)</h3>${movs.length ? `<div class="tbl-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>Data</th><th>Tipo</th><th>Detalhe</th><th class="n">Qtd</th><th class="n">Saldo</th></tr></thead><tbody>
      ${movs.slice().reverse().map((x) => `<tr><td>${dBR(x.data)}</td><td><span class="pill ${x.k}">${x.k === 'ent' ? 'Entrada' : 'Saída'}</span></td><td class="small">${esc(x.desc)}</td><td class="n">${x.k === 'ent' ? '+' : '−'}${num(x.q, 2)}</td><td class="n ${x.saldo < 0 ? 'neg' : ''}">${num(x.saldo, 2)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="muted">Sem movimentações.</div>'}</div>` : ''}
  </div>
  <div class="df">${id && !ro && !movs.length ? '<button class="btn danger" id="it-del">Excluir item</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Fechar</button>${ro ? '' : '<button class="btn pri" id="it-save">Salvar</button>'}</div>`, (d) => {
    const sv = $('#it-save', d);
    if (sv) sv.onclick = async () => {
      const nome = $('#it-nome', d).value.trim();
      if (!nome) { toast('Informe o nome do item.'); return; }
      const dup = itemByName(nome); if (dup && dup.id !== id) { toast('Já existe um item com esse nome.'); return; }
      const custo = parseNumLoose($('#it-custo', d).value); const mn = $('#it-min', d).value.trim();
      const mnv = mn === '' ? null : parseNumLoose(mn);
      if (mnv !== null && !(mnv >= 0)) { toast('Mínimo manual inválido.'); return; }
      const body = { nome, categoria: $('#it-cat', d).value.trim() || 'Outros', und: $('#it-und', d).value.trim().toUpperCase() || 'UN', custo: custo > 0 ? custo : null, minManual: mnv, ativo: $('#it-ativo', d).checked, fornecedor: $('#it-forn', d).value.trim() };
      sv.disabled = true;
      try {
        if (id) await write(() => S.db.doc('itens/' + id).update(body));
        else { const refIt = S.db.collection('itens').doc(); await write(() => refIt.set({ ...body, criadoEm: new Date().toISOString() })); }
        d.close(); toast(id ? 'Item atualizado' : 'Item cadastrado');
      } catch (e) { sv.disabled = false; showErr(e); }
    };
    const del = $('#it-del', d);
    if (del) del.onclick = async () => { try { await write(() => S.db.doc('itens/' + id).delete()); d.close(); toast('Item excluído'); } catch (e) { showErr(e); } };
  });
}

/* ---------- MOVIMENTAÇÕES ---------- */
const movSort = (a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || '').localeCompare(a.criadoEm || '') || b.id.localeCompare(a.id);
function movList(list) {
  if (!list.length) return '<div class="empty">Nenhum lançamento.</div>';
  return `<div class="stack">${list.map((x) => {
    const ent = x._k === 'ent';
    const titulo = ent ? (x.tipo === 'compra' ? `NF ${esc(x.nf || 's/n')}${x.serie ? '-' + esc(x.serie) : ''} · ${esc(x.fornecedor || 'fornecedor não informado')}` : `${TIPOS_ENT[x.tipo] || 'Entrada'}${x.obs ? ' · ' + esc(x.obs) : ''}`)
      : `${esc(x.responsavel || '—')} · ${esc(x.loja || 'sem loja')}${x.tipo !== 'requisicao' ? ' · ' + (TIPOS_SAI[x.tipo] || '') : ''}`;
    const q = x.itens.reduce((a, l) => a + (Number(l.qtd) || 0), 0);
    return `<details class="mov"><summary><span>${dBR(x.data)}</span><span class="tipo"><span class="pill ${ent ? 'ent' : 'sai'}">${ent ? 'Entrada' : 'Saída'}</span></span><span>${titulo}<span class="muted small"> · ${x.itens.length} ${x.itens.length === 1 ? 'item' : 'itens'}, ${num(q, 2)} un.</span></span><span class="muted small">${ent && x.valorTotal ? brl(x.valorTotal) : ''}</span></summary>
    <div class="body stack"><div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="n">Qtd</th>${ent ? '<th class="n">Custo unit.</th><th>Produto na NF</th>' : ''}</tr></thead><tbody>
    ${x.itens.map((l) => { const it = S.items[l.item]; return `<tr><td>${it ? esc(it.nome) : '<span class="neg">item excluído</span>'}</td><td class="n">${num(l.qtd, 2)} <span class="muted small">${it ? esc(it.und) : ''}</span></td>${ent ? `<td class="n">${l.custo ? brl(l.custo) : '—'}</td><td class="small muted">${esc(l.xProd || '')}</td>` : ''}</tr>`; }).join('')}
    </tbody></table></div>
    <div class="row small muted">${x.obs && !ent ? `<span>Obs.: ${esc(x.obs)}</span>` : ''}${x.chave ? `<span class="mono">Chave ${esc(x.chave)}</span>` : ''}${x.criadoPor ? `<span>Lançado por <span data-uid="${esc(x.criadoPor)}">${esc(S.names[x.criadoPor] || '…')}</span>${x.criadoEm ? ' em ' + new Date(x.criadoEm).toLocaleString('pt-BR') : ''}</span>` : x.origem === 'planilha' ? '<span>Importado da planilha</span>' : ''}
    <span class="spacer"></span>${S.canWrite === false ? '' : `<button class="btn danger" data-delmov="${ent ? 'entradas' : 'saidas'}/${esc(x.id)}">Excluir lançamento</button>`}</div></div></details>`;
  }).join('')}</div>`;
}
function bindMovList(root) {
  $$('[data-delmov]', root).forEach((b) => b.onclick = () => {
    const path = b.dataset.delmov;
    confirmBox('Excluir lançamento?', 'O saldo dos itens deste lançamento será recalculado sem ele. Essa ação não pode ser desfeita.', 'Excluir', async () => { await write(() => S.db.doc(path).delete()); toast('Lançamento excluído'); });
  });
  resolveNames(root);
}
async function resolveNames(root) {
  const ids = [...new Set($$('[data-uid]', root).map((e) => e.dataset.uid))].filter((id) => !S.names[id]);
  if (!ids.length || !S.user || !S.user.profiles) return;
  try { const ps = await S.user.profiles(ids); ids.forEach((id) => { S.names[id] = (ps[id] && ps[id].name) || 'Alguém da equipe'; }); $$('[data-uid]', root).forEach((e) => { e.textContent = S.names[e.dataset.uid] || 'Alguém da equipe'; }); } catch (e) { /* nomes são opcionais */ }
}
function viewHistorico(m) {
  const U = S.ui;
  const all = [...S.entradas.map((e) => ({ ...e, _k: 'ent' })), ...S.saidas.map((s) => ({ ...s, _k: 'sai' }))].sort(movSort);
  const meses = [...new Set(all.map((x) => x.data && x.data.slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = Core.norm(U.histBusca);
  const list = all.filter((x) => (U.histTipo === 'todos' || x._k === U.histTipo) && (!U.histMes || (x.data || '').startsWith(U.histMes)) && (!U.histLoja || x.loja === U.histLoja)
    && (!q || Core.norm([x.nf, x.fornecedor, x.responsavel, x.loja, x.obs, ...x.itens.map((l) => S.items[l.item]?.nome)].join(' ')).includes(q)));
  const lim = 80;
  m.innerHTML = `
  <div class="top"><div><h1>Movimentações</h1><p>Todas as entradas e saídas lançadas. Abra um lançamento para ver os itens ou excluí-lo.</p></div>
  <div class="row"><button class="btn" id="h-exp">Exportar movimentações</button></div></div>
  <div class="row">
    <div class="chips">${[['todos', 'Tudo'], ['ent', 'Entradas'], ['sai', 'Saídas']].map(([k, v]) => `<button class="chip ${U.histTipo === k ? 'on' : ''}" data-t="${k}">${v}</button>`).join('')}</div>
    <select class="i" id="h-mes"><option value="">Todos os meses</option>${meses.map((x) => `<option value="${x}" ${x === U.histMes ? 'selected' : ''}>${mLabel(x)}</option>`).join('')}</select>
    <select class="i" id="h-loja"><option value="">Todas as lojas</option>${(S.config.lojas || []).map((x) => `<option ${x === U.histLoja ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
    <input class="i" id="h-busca" placeholder="Buscar NF, fornecedor, pessoa, item…" value="${esc(U.histBusca)}" style="min-width:240px;flex:1">
  </div>
  <p class="muted small" style="margin:0">${list.length} lançamentos${list.length > lim ? `, mostrando os ${lim} mais recentes` : ''}</p>
  ${movList(list.slice(0, lim))}`;
  $$('[data-t]', m).forEach((b) => b.onclick = () => { U.histTipo = b.dataset.t; render(); });
  $('#h-mes').onchange = (e) => { U.histMes = e.target.value; render(); };
  $('#h-loja').onchange = (e) => { U.histLoja = e.target.value; render(); };
  const hb = $('#h-busca'); hb.onchange = () => { U.histBusca = hb.value; render(); };
  hb.onkeydown = (e) => { if (e.key === 'Enter') { U.histBusca = hb.value; render(); } };
  $('#h-exp').onclick = () => exportar('movs');
  bindMovList(m);
}

/* ---------- CONSUMO ---------- */
function viewConsumo(m) {
  const ref = (S.ui.mes || todayIso().slice(0, 7));
  const m6 = Core.ultimosMeses(ref, 6);
  const mat = {}; const lojaMat = {};
  S.saidas.filter((s) => s.tipo !== 'ajuste' && s.data).forEach((s) => {
    const mk = s.data.slice(0, 7); if (!m6.includes(mk)) return;
    s.itens.forEach((l) => { const q = Number(l.qtd) || 0; (mat[l.item] ||= {})[mk] = (mat[l.item][mk] || 0) + q; const lj = s.loja || 'Sem loja'; (lojaMat[lj] ||= {})[mk] = (lojaMat[lj][mk] || 0) + q; });
  });
  const rows = itemList().map((i) => { const v = m6.map((mk) => (mat[i.id] || {})[mk] || 0); const t = v.reduce((a, b) => a + b, 0); return { i, v, t }; }).filter((r) => r.t > 0).sort((a, b) => b.t - a.t);
  const max = Math.max(1, ...rows.flatMap((r) => r.v));
  const cell = (v, mx) => { const a = v ? 0.12 + 0.75 * (v / mx) : 0; return `<td class="h" style="background:color-mix(in srgb, var(--accent) ${(a * 100).toFixed(0)}%, transparent);${a > .5 ? 'color:var(--accent-ink);font-weight:600' : ''}">${v ? num(v) : '<span class="muted">·</span>'}</td>`; };
  const lojas = Object.entries(lojaMat).map(([k, o]) => ({ k, v: m6.map((mk) => o[mk] || 0) })).map((r) => ({ ...r, t: r.v.reduce((a, b) => a + b, 0) })).sort((a, b) => b.t - a.t);
  const lmax = Math.max(1, ...lojas.flatMap((r) => r.v));
  m.innerHTML = `
  <div class="top"><div><h1>Consumo</h1><p>Unidades retiradas por mês nos últimos 6 meses até ${mLabel(ref)}. Ajustes de inventário não entram.</p></div></div>
  <div class="card stack"><h2>Por loja / setor</h2><div class="tbl-wrap"><table class="heat"><thead><tr><th>Loja / setor</th>${m6.map((x) => `<th class="n">${mLabel(x)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
  ${lojas.map((r) => `<tr><td>${esc(r.k)}</td>${r.v.map((v) => cell(v, lmax)).join('')}<td class="n"><b>${num(r.t)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sem saídas no período.</td></tr>'}</tbody></table></div></div>
  <div class="card stack"><h2>Por item</h2><div class="tbl-wrap"><table class="heat"><thead><tr><th>Item</th><th>Categoria</th>${m6.map((x) => `<th class="n">${mLabel(x)}</th>`).join('')}<th class="n">Total</th><th class="n">Média/mês</th></tr></thead><tbody>
  ${rows.map((r) => `<tr class="click" data-item="${r.i.id}"><td>${esc(r.i.nome)}</td><td class="muted">${esc(r.i.categoria)}</td>${r.v.map((v) => cell(v, max)).join('')}<td class="n"><b>${num(r.t)}</b></td><td class="n">${num(r.t / 6, 1)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Sem saídas no período.</td></tr>'}</tbody></table></div></div>`;
  bindRows(m, openItem);
}

/* ---------- CADASTROS ---------- */
async function saveConfig(patch) {
  const ref = S.db.doc('config/geral');
  const next = { ...S.config, ...patch };
  await write(() => ref.set(next)); S.config = next;
}
function viewCadastros(m) {
  const P = Object.assign({}, Core.DEFAULT_PARAMS, S.config.params || {});
  const ro = S.canWrite === false;
  const lista = (key, titulo, dica) => `<div class="card stack"><h2>${titulo}</h2><p class="muted small" style="margin:0">${dica}</p>
    <div class="chips">${(S.config[key] || []).map((x, i) => `<span class="chip">${esc(x)}${ro ? '' : `<span class="x" data-rm="${key}" data-i="${i}" role="button" aria-label="Remover ${esc(x)}">✕</span>`}</span>`).join('') || '<span class="muted">Nenhum cadastrado.</span>'}</div>
    ${ro ? '' : `<div class="row"><input class="i" id="add-${key}" placeholder="Adicionar…" style="flex:1;min-width:160px"><button class="btn" data-add="${key}">Adicionar</button></div>`}</div>`;
  const prm = [['janela', 'Janela de consumo (dias)', 'Quantos dias para trás entram no consumo médio diário.'], ['prazo', 'Prazo de reposição do fornecedor (dias)', 'Tempo médio entre pedir e receber.'], ['seguranca', 'Estoque de segurança (dias)', 'Folga para atrasos ou picos de consumo.'], ['alertaDias', 'Alerta de risco de ruptura (dias)', 'Item fica em ATENÇÃO quando o saldo dura menos que isso.'], ['coberturaAlvo', 'Cobertura alvo da compra (dias)', 'A sugestão de compra repõe o mínimo + estes dias de consumo.'], ['semGiroDias', 'Sem giro após (dias)', 'Item com saldo e sem saída há mais que isso.'], ['minPadrao', 'Mínimo padrão (itens sem consumo)', 'Usado quando o item não tem consumo nem mínimo manual.']];
  m.innerHTML = `
  <div class="top"><div><h1>Cadastros e parâmetros</h1><p>Listas usadas nos formulários e regras de cálculo do estoque.</p></div></div>
  ${readOnlyNote()}
  <div class="grid two">${lista('lojas', 'Lojas e setores', 'Destino das saídas.')}${lista('solicitantes', 'Solicitantes', 'Quem retira material. Nomes novos digitados numa saída entram aqui sozinhos.')}</div>
  <div class="grid two">${lista('fornecedores', 'Fornecedores', 'Preenchidos automaticamente ao lançar notas.')}${lista('categorias', 'Categorias de item', 'Usadas no cadastro de itens e nos filtros.')}</div>
  <div class="card stack"><h2>Parâmetros de cálculo</h2>
    <div class="tbl-wrap"><table><tbody>${prm.map(([k, l, d]) => `<tr><td style="width:40%"><b style="font-weight:500">${l}</b><div class="muted small">${d}</div></td><td style="width:140px"><input class="i" type="number" min="0" id="pr-${k}" value="${P[k]}" style="width:110px" ${ro ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table></div>
    ${ro ? '' : '<div class="row"><span class="spacer"></span><button class="btn pri" id="pr-save">Salvar parâmetros</button></div>'}</div>
  <div class="card stack"><h2>Conferência dos lançamentos</h2>${conferencia()}</div>`;
  $$('[data-add]', m).forEach((b) => b.onclick = async () => {
    const k = b.dataset.add; const inp = $('#add-' + k); const v = inp.value.trim(); if (!v) return;
    if ((S.config[k] || []).some((x) => Core.norm(x) === Core.norm(v))) { toast('Já está na lista.'); return; }
    try { await saveConfig({ [k]: [...(S.config[k] || []), v].sort((a, b) => a.localeCompare(b, 'pt-BR')) }); render(); toast('Adicionado'); } catch (e) { showErr(e); }
  });
  $$('[data-rm]', m).forEach((b) => b.onclick = async () => {
    const k = b.dataset.rm; const arr = [...(S.config[k] || [])]; arr.splice(+b.dataset.i, 1);
    try { await saveConfig({ [k]: arr }); render(); } catch (e) { showErr(e); }
  });
  const ps = $('#pr-save');
  if (ps) ps.onclick = async () => { const np = {}; prm.forEach(([k]) => { np[k] = Math.max(0, Number($('#pr-' + k).value) || 0); }); np.janela = Math.max(1, np.janela); try { await saveConfig({ params: np }); toast('Parâmetros salvos. Painel recalculado.'); render(); } catch (e) { showErr(e); } };
}
function conferencia() {
  const C = S.calc; const hoje = todayIso();
  const chk = [
    ['Itens com saldo negativo', C.rows.filter((r) => r.saldo < 0).map((r) => r.item.nome), 'Falta lançar entrada, ou a saída foi lançada a mais. Corrija com uma entrada do tipo Ajuste.'],
    ['Lançamentos com item excluído', [...S.entradas, ...S.saidas].filter((x) => x.itens.some((l) => !S.items[l.item])).map((x) => dBR(x.data)), 'Exclua o lançamento ou recadastre o item.'],
    ['Saídas sem loja/setor (exceto ajustes)', S.saidas.filter((s) => !s.loja && s.tipo !== 'ajuste').map((s) => dBR(s.data)), 'Sem loja não dá para saber quem consome.'],
    ['Lançamentos com data futura', [...S.entradas, ...S.saidas].filter((x) => x.data > hoje).map((x) => dBR(x.data)), 'Revise a data digitada.'],
    ['Itens com saldo e sem custo', C.rows.filter((r) => r.saldo > 0 && r.custo == null && r.item.ativo !== false).map((r) => r.item.nome), 'Informativo. Lance as próximas compras com custo ou preencha o custo no item.'],
  ];
  return `<div class="tbl-wrap"><table><thead><tr><th>Verificação</th><th class="n">Ocorrências</th><th>O que fazer</th></tr></thead><tbody>${chk.map(([t, arr, o]) => `<tr><td>${t}${arr.length ? `<div class="muted small">${esc(arr.slice(0, 6).join(', '))}${arr.length > 6 ? '…' : ''}</div>` : ''}</td><td class="n"><span class="pill ${arr.length ? (t.includes('custo') ? 'ATENÇÃO' : 'RUPTURA') : 'OK'}">${arr.length}</span></td><td class="small">${o}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- Exportação ---------- */
async function copyText(txt, ok) { try { await navigator.clipboard.writeText(txt); toast(ok); } catch (e) { dialog(`<div class="dh"><h2>Copie o conteúdo</h2></div><div class="db"><textarea class="i" style="min-height:240px;font-family:var(--mono);font-size:12px">${esc(txt)}</textarea></div><div class="df"><button class="btn" data-close>Fechar</button></div>`); } }
function csvOf(rows) { return '﻿' + rows.map((r) => r.map((v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n'); }
async function exportar(tipo) {
  let rows, nome;
  if (tipo === 'estoque') {
    nome = `estoque-sfera-${todayIso()}.csv`;
    rows = [['Item', 'Categoria', 'Und', 'Entradas', 'Saídas', 'Saldo', 'Mínimo', 'Consumo/dia', 'Cobertura (dias)', 'Última saída', 'Status', 'Sugestão compra', 'Custo unit.', 'Valor estoque', 'Fornecedor'],
      ...S.calc.rows.sort((a, b) => a.item.nome.localeCompare(b.item.nome, 'pt-BR')).map((r) => [r.item.nome, r.item.categoria, r.item.und, r.ent, r.sai, r.saldo, r.minimo, Math.round(r.consumoDia * 100) / 100, r.cobertura == null ? '' : Math.round(r.cobertura), dBR(r.ultSaida), r.status, r.comprar, r.custo ?? '', Math.round(r.valor * 100) / 100, r.item.fornecedor || ''])];
  } else {
    nome = `movimentacoes-sfera-${todayIso()}.csv`;
    rows = [['Data', 'Movimento', 'Tipo', 'NF', 'Fornecedor', 'Solicitante', 'Loja/Setor', 'Item', 'Categoria', 'Und', 'Qtd', 'Custo unit.', 'Obs.']];
    S.entradas.forEach((e) => e.itens.forEach((l) => { const it = S.items[l.item] || {}; rows.push([dBR(e.data), 'Entrada', TIPOS_ENT[e.tipo] || e.tipo, e.nf, e.fornecedor, '', '', it.nome, it.categoria, it.und, l.qtd, l.custo ?? '', e.obs]); }));
    S.saidas.forEach((s) => s.itens.forEach((l) => { const it = S.items[l.item] || {}; rows.push([dBR(s.data), 'Saída', TIPOS_SAI[s.tipo] || s.tipo, '', '', s.responsavel, s.loja, it.nome, it.categoria, it.und, l.qtd, '', s.obs || l.obs || '']); }));
    rows = [rows[0], ...rows.slice(1).sort((a, b) => a[0].split('/').reverse().join('').localeCompare(b[0].split('/').reverse().join('')))];
  }
  const data = csvOf(rows);
  try {
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { copyText(rows.map((r) => r.join('\t')).join('\n'), 'Tabela copiada. Cole no Excel.'); }
}

/* ---------- Entrada da tela (chamada pelo roteador do VM) ---------- */
async function afterRenderEstoqueSfera(deps) {
  DEPS = deps;
  ativo = true;
  SB = await deps.getSb();
  const u = deps.getCurrentUser ? deps.getCurrentUser() : null;
  S.db = dbPonte;
  S.uid = u && u.id ? u.id : null;
  S.canWrite = true;
  S.offline = false;
  S.user = {
    async profiles(ids) {
      const { data } = await SB.from('profiles').select('id,name').in('id', ids);
      const o = {}; (data || []).forEach((p) => { o[p.id] = { name: p.name }; });
      return o;
    },
  };
  Object.keys(S.ready).forEach((k) => { S.ready[k] = false; });
  const dlg = $('#ess-dlg');
  dlg.addEventListener('close', () => { if (allReady() && S.view !== 'entrada' && S.view !== 'saida') render(); });
  $('#ess-main').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-go]');
    if (b) { ev.preventDefault(); irPara(b.dataset.go); }
  });
  const params = deps.params || {};
  const aba = params.aba || (typeof params.get === 'function' ? params.get('aba') : '');
  S.view = VIEWS[aba] ? aba : 'painel';
  render();
  try {
    await carregarTudo();
  } catch (e) {
    console.error('[Estoque Sfera]', e);
    S.offline = true;
  }
  render();
}
async function beforeLeave() {
  ativo = false;
  clearTimeout(recargaT);
  const d = $('#ess-dlg');
  if (d && d.open) d.close();
}

/* Não redesenha formulários em edição quando chegam dados de outra pessoa: só atualiza as listas */
function softRender() {
  if (!allReady()) { render(); return; }
  const ae = document.activeElement;
  const editing = (S.view === 'entrada' || S.view === 'saida') && $('#ess-main .lines');
  if (editing) { recalc(); if (S.view === 'saida') renderSDLines(); return; }
  if ($('#ess-dlg').open) { recalc(); return; }
  if (ae && ae.id === 'e-busca') { render(); const b = $('#e-busca'); b && b.focus(); return; }
  render();
}

global.SferaStockModule = { afterRenderEstoqueSfera, beforeLeave };
})(window);
