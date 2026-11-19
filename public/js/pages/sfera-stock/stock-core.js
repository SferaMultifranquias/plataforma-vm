(function initSferaStockCore(global) {
/* ===== Núcleo de cálculo (puro, sem DOM) ===== */
var Core = (() => {
  const DAY = 86400000;
  const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const monthKey = (iso) => iso.slice(0, 7);
  const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const DEFAULT_PARAMS = { janela: 60, prazo: 7, seguranca: 7, alertaDias: 30, coberturaAlvo: 30, semGiroDias: 30, minPadrao: 0 };
  const ALERTA = ['RUPTURA', 'CRÍTICO', 'ATENÇÃO'];

  /* Calcula a situação de cada item. items: {id: item}, entradas/saidas: lançamentos com itens[] */
  function compute(items, entradas, saidas, paramsIn, refIso) {
    const p = Object.assign({}, DEFAULT_PARAMS, paramsIn || {});
    const ref = refIso;
    const rows = {};
    for (const id in items) {
      rows[id] = { id, item: items[id], ent: 0, sai: 0, inicial: 0, saidaJanela: 0, ultSaida: null, ultEntrada: null, ultCusto: null, ultCustoData: null };
    }
    let inicio = null;
    const touch = (d) => { if (d && (!inicio || d < inicio)) inicio = d; };
    for (const e of entradas) {
      touch(e.data);
      for (const l of e.itens || []) {
        const r = rows[l.item]; if (!r) continue;
        const q = Number(l.qtd) || 0;
        r.ent += q;
        if (e.tipo === 'inicial') r.inicial += q;
        if (!r.ultEntrada || e.data > r.ultEntrada) r.ultEntrada = e.data;
        const c = Number(l.custo);
        if (c > 0 && (!r.ultCustoData || e.data >= r.ultCustoData)) { r.ultCusto = c; r.ultCustoData = e.data; }
      }
    }
    for (const s of saidas) {
      touch(s.data);
      const dias = s.data ? daysBetween(s.data, ref) : 9999;
      for (const l of s.itens || []) {
        const r = rows[l.item]; if (!r) continue;
        const q = Number(l.qtd) || 0;
        r.sai += q;
        if (s.tipo !== 'ajuste') {
          if (dias >= 0 && dias < p.janela) r.saidaJanela += q;
          if (!r.ultSaida || s.data > r.ultSaida) r.ultSaida = s.data;
        }
      }
    }
    const janelaEf = inicio ? Math.max(1, Math.min(p.janela, daysBetween(inicio, ref) + 1)) : p.janela;
    const diasDesdeInicio = inicio ? daysBetween(inicio, ref) : 0;
    const out = [];
    for (const id in rows) {
      const r = rows[id];
      const it = r.item;
      r.saldo = Math.round((r.ent - r.sai) * 1000) / 1000;
      r.consumoDia = r.saidaJanela / janelaEf;
      const mm = it.minManual;
      r.minimo = (mm !== null && mm !== undefined && mm !== '') ? Number(mm)
        : (r.consumoDia > 0 ? Math.ceil(r.consumoDia * (p.prazo + p.seguranca)) : Number(p.minPadrao) || 0);
      r.cobertura = r.consumoDia > 0 ? r.saldo / r.consumoDia : null;
      r.diasSemSaida = r.ultSaida ? daysBetween(r.ultSaida, ref) : null;
      r.custo = r.ultCusto != null ? r.ultCusto : (Number(it.custo) > 0 ? Number(it.custo) : null);
      r.valor = r.custo != null ? Math.max(0, r.saldo) * r.custo : 0;
      let st;
      if (r.saldo <= 0) st = 'RUPTURA';
      else if (r.minimo > 0 && r.saldo <= r.minimo) st = 'CRÍTICO';
      else if (r.cobertura !== null && r.cobertura < p.alertaDias) st = 'ATENÇÃO';
      else if ((r.diasSemSaida !== null && r.diasSemSaida > p.semGiroDias) || (r.diasSemSaida === null && (r.ultEntrada ? daysBetween(r.ultEntrada, ref) : diasDesdeInicio) > p.semGiroDias)) st = 'SEM GIRO';
      else st = 'OK';
      if (it.ativo === false) st = 'INATIVO';
      r.status = st;
      r.comprar = ALERTA.includes(st) ? Math.max(0, Math.ceil(r.minimo + r.consumoDia * p.coberturaAlvo - r.saldo)) : 0;
      r.custoCompra = r.custo != null ? r.comprar * r.custo : null;
      out.push(r);
    }
    return { rows: out, byId: rows, inicio, janelaEf, params: p };
  }

  /* Soma por mês (YYYY-MM) de entradas e saídas, em unidades */
  function porMes(entradas, saidas, meses, filtroItem) {
    const res = {}; meses.forEach((m) => (res[m] = { ent: 0, sai: 0 }));
    const add = (list, k) => list.forEach((x) => { if (!x.data) return; const m = monthKey(x.data); if (!res[m]) return; (x.itens || []).forEach((l) => { if (!filtroItem || filtroItem(l.item)) res[m][k] += Number(l.qtd) || 0; }); });
    add(entradas.filter((e) => e.tipo !== 'inicial'), 'ent');
    add(saidas.filter((s) => s.tipo !== 'ajuste'), 'sai');
    return res;
  }

  function ultimosMeses(refMonth, n) {
    const [y, m] = refMonth.split('-').map(Number);
    const arr = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(y, m - 1 - i, 1); arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    return arr;
  }

  /* Similaridade simples entre nome do produto na NF e nome do item cadastrado */
  const STOP = new Set(['de', 'da', 'do', 'com', 'c', 'x', 'pct', 'un', 'und', 'cx', 'pc', 'kit', 'para', 'em']);
  const toks = (s) => new Set(norm(s).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(' ').filter((t) => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t))));
  function similar(a, b) {
    const ta = toks(a), tb = toks(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0; ta.forEach((t) => { if (tb.has(t)) inter++; });
    return inter / Math.min(ta.size, tb.size) * 0.7 + inter / new Set([...ta, ...tb]).size * 0.3;
  }

  /* Lê o XML de uma NF-e (modelo 55) e devolve cabeçalho + itens */
  function parseNFe(xmlText, DOMParserImpl) {
    const doc = new DOMParserImpl().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('O arquivo não é um XML válido.');
    const first = (root, tag) => { const el = root.getElementsByTagName(tag)[0]; return el ? el.textContent.trim() : ''; };
    const inf = doc.getElementsByTagName('infNFe')[0];
    if (!inf) throw new Error('Não encontrei uma NF-e neste XML (falta o bloco infNFe).');
    const ide = inf.getElementsByTagName('ide')[0];
    const emit = inf.getElementsByTagName('emit')[0];
    const chave = (inf.getAttribute('Id') || '').replace(/^NFe/, '');
    const dh = first(ide, 'dhEmi') || first(ide, 'dEmi');
    const itens = [...inf.getElementsByTagName('det')].map((det) => {
      const prod = det.getElementsByTagName('prod')[0];
      return {
        cProd: first(prod, 'cProd'), xProd: first(prod, 'xProd'), uCom: first(prod, 'uCom'),
        qCom: parseFloat(first(prod, 'qCom')) || 0, vUnCom: parseFloat(first(prod, 'vUnCom')) || 0, vProd: parseFloat(first(prod, 'vProd')) || 0,
      };
    });
    const tot = inf.getElementsByTagName('ICMSTot')[0];
    return {
      nf: first(ide, 'nNF'), serie: first(ide, 'serie'), emissao: dh ? dh.slice(0, 10) : '',
      fornecedor: first(emit, 'xFant') || first(emit, 'xNome'), razao: first(emit, 'xNome'), cnpj: first(emit, 'CNPJ') || first(emit, 'CPF'),
      chave, valorNota: tot ? parseFloat(first(tot, 'vNF')) || 0 : 0, itens,
    };
  }

  return { compute, porMes, ultimosMeses, similar, parseNFe, norm, isoOf, toDate, daysBetween, monthKey, DEFAULT_PARAMS, ALERTA };
})();

  global.SferaStockCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
