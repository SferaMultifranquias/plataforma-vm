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

  /* ---- DANFE em PDF ----
   * Recebe os pedaços de texto do PDF com posição ({ str, x, y, w }; y cresce para baixo e cada página
   * soma 10000) e devolve o mesmo formato de parseNFe. Número, série e CNPJ vêm da chave de acesso,
   * que é o dado mais confiável da DANFE; os itens vêm das linhas do quadro de produtos. */
  const numBR = (s) => { const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
  function chaveValida(ch) {
    if (!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(ch)) return false;
    let soma = 0, peso = 2;
    for (let i = 42; i >= 0; i--) { soma += (ch.charCodeAt(i) - 48) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11; const dv = r < 2 ? 0 : 11 - r;
    return dv === Number(ch[43]);
  }
  function linhasPdf(items) {
    const ord = items.filter((t) => t && String(t.str || '').trim()).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const linhas = [];
    ord.forEach((t) => {
      const l = linhas.find((x) => Math.abs(x.y - t.y) <= 2.5);
      if (l) l.its.push(t); else linhas.push({ y: t.y, its: [t] });
    });
    linhas.forEach((l) => {
      l.its.sort((a, b) => a.x - b.x);
      l.x = l.its[0].x;
      l.text = l.its.map((t) => String(t.str).trim()).join(' ').replace(/\s+/g, ' ').trim();
    });
    return linhas.sort((a, b) => a.y - b.y);
  }
  function parseDanfe(items) {
    const lns = linhasPdf(items || []);
    if (!lns.length) throw new Error('Este PDF não tem texto (parece uma imagem escaneada). Use o XML da nota ou digite os itens.');
    const up = (s) => norm(s).toUpperCase();
    /* Chave de acesso: 44 caracteres, geralmente em grupos de 4 */
    /* Procura em cada pedaço de texto e depois em cada linha, testando todas as janelas de 44 caracteres:
       a chave pode estar grudada em outro número da mesma altura (ex.: "Nº 000.007.273"). */
    const acharChave = (txt) => {
      const runs = String(txt).replace(/[\s.\-/]/g, '').toUpperCase().match(/[0-9A-Z]{44,}/g) || [];
      for (const r of runs) {
        for (let k = 0; k + 44 <= r.length; k++) {
          const c = r.slice(k, k + 44);
          if (/^(55|65)$/.test(c.slice(20, 22)) && /^(0[1-9]|1[0-2])$/.test(c.slice(4, 6)) && chaveValida(c)) return c;
        }
      }
      return '';
    };
    let chave = '';
    for (const t of items) { chave = acharChave(t.str); if (chave) break; }
    for (let i = 0; !chave && i < lns.length; i++) chave = acharChave(lns[i].text);
    if (!chave) {
      /* Chave quebrada em duas linhas: junta linhas vizinhas que só têm números */
      const soNum = lns.map((l) => l.text.replace(/[\s.\-/]/g, '').toUpperCase());
      for (let i = 0; i < soNum.length - 1 && !chave; i++) {
        if (!/^[0-9A-Z]{8,}$/.test(soNum[i]) || !/^[0-9A-Z]{8,}$/.test(soNum[i + 1])) continue;
        const s = soNum[i] + soNum[i + 1];
        for (let k = 0; k + 44 <= s.length; k++) {
          const c = s.slice(k, k + 44);
          if (c.slice(20, 22) === '55' && /^(0[1-9]|1[0-2])$/.test(c.slice(4, 6)) && chaveValida(c)) { chave = c; break; }
        }
      }
    }
    if (!chave) throw new Error('Não encontrei a chave de acesso neste PDF. Confira se é a DANFE de uma NF-e, ou use o XML.');
    /* Valor logo abaixo de um rótulo (mesma coluna) */
    const abaixo = (re, valRe) => {
      for (const it of items) {
        if (!re.test(up(it.str))) continue;
        const x0 = it.x - 4, x1 = it.x + Math.max(it.w || 0, 40) + 4;
        const cands = items.filter((o) => o.y > it.y + 1 && o.y < it.y + 22 && o.x + (o.w || 0) >= x0 && o.x <= x1 && valRe.test(String(o.str).trim()))
          .sort((a, b) => a.y - b.y || Math.abs(a.x - it.x) - Math.abs(b.x - it.x));
        if (cands.length) return String(cands[0].str).trim().match(valRe)[0];
      }
      return '';
    };
    const dataBr = abaixo(/DATA (DA |DE )?EMISSAO/, /\d{2}\/\d{2}\/\d{4}/);
    const emissao = dataBr ? dataBr.split('/').reverse().join('-') : '';
    const vNota = numBR(abaixo(/VALOR TOTAL DA NOTA/, /\d{1,3}(\.\d{3})*,\d{2}/));
    /* Emitente: o canhoto traz "RECEBEMOS DE <EMITENTE> OS PRODUTOS..." */
    const tudo = lns.map((l) => l.text).join(' ');
    const mRec = tudo.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i);
    let razao = mRec ? mRec[1].trim() : '';
    if (!razao) {
      const rot = items.find((t) => /IDENTIFICACAO DO EMITENTE/.test(up(t.str)));
      const nome = rot && items.filter((o) => o.y > rot.y + 1 && o.y < rot.y + 30 && o.x >= rot.x - 10 && o.x < rot.x + 150 && /[A-Za-z]{3}/.test(o.str))
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (nome) razao = String(nome.str).trim();
    }
    /* Itens: linhas com NCM (8 dígitos), CST, CFOP, unidade, quantidade, valor unitário e total */
    const N = '(\\d{1,3}(?:\\.\\d{3})*,\\d+|\\d+,\\d+|\\d+)';
    const reItem = new RegExp('^(\\S+)(?:\\s+(.+?))?\\s+(\\d{8}|\\d{4}\\.\\d{2}\\.\\d{2})\\s+(\\S{2,5})\\s+([1-7]\\.?\\d{3})\\s+([A-Za-z][A-Za-z0-9]{0,5})\\s+' + N + '\\s+' + N + '\\s+' + N + '(?:\\s|$)');
    const pagina = (y) => Math.floor(y / 10000);
    const colunas = (re) => items.filter((t) => re.test(up(t.str)));
    const colDesc = colunas(/^DESCRICAO/), colNcm = colunas(/^NCM/);
    const naColunaDesc = (l) => {
      const d = colDesc.find((t) => pagina(t.y) === pagina(l.y)) || colDesc[0];
      const n = colNcm.find((t) => pagina(t.y) === pagina(l.y)) || colNcm[0];
      return d && n ? l.x >= d.x - 8 && l.x < n.x - 2 : false;
    };
    /* Linhas de item valem em qualquer parte da DANFE, menos depois de "Dados adicionais" na mesma página */
    const fimProdutos = /DADOS ADICIONAIS|CALCULO DO ISSQN|INFORMACOES COMPLEMENTARES/;
    const itens = []; let fora = false, pag = -1, ult = null, ultY = 0, solta = null;
    lns.forEach((l) => {
      const u = up(l.text);
      if (pagina(l.y) !== pag) { pag = pagina(l.y); fora = false; ult = null; solta = null; }
      if (fimProdutos.test(u)) { fora = true; ult = null; return; }
      if (fora) return;
      const m = l.text.match(reItem);
      if (m) {
        let desc = (m[2] || '').trim();
        /* Descrição em linha própria, um pouco acima dos números */
        if (!desc && solta && l.y - solta.y < 14) { desc = solta.text; if (solta.dono) solta.dono.xProd = solta.dono.xProd.slice(0, -solta.text.length).trim(); }
        ult = { cProd: m[1], xProd: desc, uCom: m[6], qCom: numBR(m[7]), vUnCom: numBR(m[8]), vProd: numBR(m[9]) };
        itens.push(ult); ultY = l.y; solta = null; return;
      }
      /* Descrição quebrada em mais de uma linha: junta só texto na coluna da descrição, logo abaixo do item */
      if (naColunaDesc(l) && !/^(CODIGO|DESCRICAO)/.test(u)) {
        const dono = ult && l.y - ultY < 14 ? ult : null;
        if (dono) { dono.xProd = (dono.xProd + ' ' + l.text).trim(); ultY = l.y; }
        solta = { text: l.text, y: l.y, dono };
      } else solta = null;
    });
    itens.forEach((p) => { if (!p.xProd) p.xProd = p.cProd; });
    if (!itens.length) throw new Error('Li a DANFE, mas não consegui separar os itens. Use o XML da nota ou digite os itens.');
    return {
      nf: String(Number(chave.slice(25, 34))), serie: String(Number(chave.slice(22, 25))), emissao,
      fornecedor: razao, razao, cnpj: chave.slice(6, 20), chave,
      valorNota: vNota || Math.round(itens.reduce((a, p) => a + p.vProd, 0) * 100) / 100, itens,
    };
  }

  return { compute, porMes, ultimosMeses, similar, parseNFe, parseDanfe, chaveValida, norm, isoOf, toDate, daysBetween, monthKey, DEFAULT_PARAMS, ALERTA };
})();

  global.SferaStockCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
