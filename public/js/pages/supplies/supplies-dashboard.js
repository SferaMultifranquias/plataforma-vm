(function initSuppliesDashboardModule(global) {
  // Dashboard de acompanhamento de Suprimentos.
  // Regras puras (filtros, KPIs, agrupamentos) + HTML dos cards/gráficos.
  // O estado e os eventos ficam em supplies-module.js; aqui só se calcula e se desenha.
  // Reaproveita as classes visuais do Dashboard do VM (styles/pages/dashboard.css).

  var STATUS = {
    pendente: { label: 'Pendente', cls: 'sup-pill--warn', cor: '#f59e0b' },
    aprovada: { label: 'Aprovada', cls: 'sup-pill--info', cor: '#2563eb' },
    entregue: { label: 'Entregue', cls: 'sup-pill--ok', cor: '#16a34a' },
    recusada: { label: 'Recusada', cls: 'sup-pill--bad', cor: '#e11d48' },
  };
  var STATUS_ORDEM = ['pendente', 'aprovada', 'entregue', 'recusada'];
  var CORES = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316'];
  var KPI_CORES = {
    blue: 'bg-blue-50 text-blue-600',
    violet: 'bg-violet-50 text-violet-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };

  // ───────────── utilidades ─────────────
  function esc(valor) {
    return String(valor === null || valor === undefined ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function numero(valor, casas) {
    var n = Number(valor);
    if (!isFinite(n)) n = 0;
    var partes = n.toFixed(casas).split('.');
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return partes.length > 1 ? inteiro + ',' + partes[1] : inteiro;
  }
  function moeda(valor) { return 'R$ ' + numero(valor, 2); }
  function quantidade(valor) {
    var n = Math.round((Number(valor) || 0) * 100) / 100;
    return numero(n, n % 1 === 0 ? 0 : 2);
  }

  function dataLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var dois = function dois(n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }
  function dataBR(iso) {
    var d = dataLocal(iso);
    return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—';
  }
  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function nomeLoja(lojas, id) {
    var l = (lojas || []).find(function f(x) { return String(x.id) === String(id); });
    return l ? l.nome : 'Loja #' + id;
  }
  function linhas(s) { return Array.isArray(s && s.itens) ? s.itens : []; }

  // ───────────── regras puras ─────────────
  function filtrosVazios() {
    return { dateStart: '', dateEnd: '', lojas: [], status: [] };
  }

  function filtrar(sols, f) {
    f = f || filtrosVazios();
    return (sols || []).filter(function keep(s) {
      var dia = dataLocal(s.criado_em);
      if (f.dateStart && (!dia || dia < f.dateStart)) return false;
      if (f.dateEnd && (!dia || dia > f.dateEnd)) return false;
      if (f.lojas && f.lojas.length && f.lojas.indexOf(String(s.store_id)) === -1) return false;
      if (f.status && f.status.length && f.status.indexOf(s.status) === -1) return false;
      return true;
    });
  }

  function porStatus(sols) {
    var cont = {};
    (sols || []).forEach(function each(s) { cont[s.status] = (cont[s.status] || 0) + 1; });
    return cont;
  }

  function kpis(sols) {
    var cont = porStatus(sols);
    var lojas = {};
    var itens = 0;
    var valor = 0;
    var valorEntregue = 0;
    (sols || []).forEach(function each(s) {
      lojas[String(s.store_id)] = true;
      linhas(s).forEach(function l(i) { itens += Number(i.compra) || 0; });
      valor += Number(s.total) || 0;
      if (s.status === 'entregue') valorEntregue += Number(s.total) || 0;
    });
    return {
      total: (sols || []).length,
      pendentes: cont.pendente || 0,
      aprovadas: cont.aprovada || 0,
      emAndamento: (cont.pendente || 0) + (cont.aprovada || 0),
      entregues: cont.entregue || 0,
      recusadas: cont.recusada || 0,
      lojas: Object.keys(lojas).length,
      itens: itens,
      valor: valor,
      valorEntregue: valorEntregue,
    };
  }

  function evolucaoMensal(sols) {
    var mapa = {};
    (sols || []).forEach(function each(s) {
      var dia = dataLocal(s.criado_em);
      if (dia) mapa[dia.slice(0, 7)] = (mapa[dia.slice(0, 7)] || 0) + 1;
    });
    return Object.keys(mapa).sort().map(function p(m) {
      return { rotulo: m.slice(5) + '/' + m.slice(2, 4), valor: mapa[m], texto: mapa[m] + (mapa[m] === 1 ? ' solicitação' : ' solicitações') };
    });
  }

  function evolucaoValorDiaria(sols) {
    var mapa = {};
    (sols || []).forEach(function each(s) {
      var dia = dataLocal(s.criado_em);
      var v = Number(s.total) || 0;
      if (dia && v > 0) mapa[dia] = (mapa[dia] || 0) + v;
    });
    return Object.keys(mapa).sort().map(function p(d) {
      return { rotulo: d.slice(8, 10) + '/' + d.slice(5, 7), valor: mapa[d], texto: moeda(mapa[d]) };
    });
  }

  function valorPorLoja(sols, lojas, limite) {
    var mapa = {};
    (sols || []).forEach(function each(s) {
      var v = Number(s.total) || 0;
      if (v <= 0) return;
      var k = String(s.store_id);
      if (!mapa[k]) mapa[k] = { rotulo: nomeLoja(lojas, s.store_id), valor: 0 };
      mapa[k].valor += v;
    });
    return Object.keys(mapa).map(function m(k) { return mapa[k]; })
      .sort(function ord(a, b) { return b.valor - a.valor; })
      .slice(0, limite || 5)
      .map(function fmt(x) { return { rotulo: x.rotulo, valor: x.valor, texto: moeda(x.valor) }; });
  }

  // Itens iguais em lojas diferentes têm ids diferentes: agrupa pelo nome.
  function itensMaisPedidos(sols, limite) {
    var mapa = {};
    (sols || []).forEach(function each(s) {
      linhas(s).forEach(function l(i) {
        var q = Number(i.compra) || 0;
        var chave = normalizar(i.nome);
        if (!chave || q <= 0) return;
        if (!mapa[chave]) mapa[chave] = { rotulo: i.nome, und: i.und || '', valor: 0 };
        mapa[chave].valor += q;
      });
    });
    return Object.keys(mapa).map(function m(k) { return mapa[k]; })
      .sort(function ord(a, b) { return b.valor - a.valor; })
      .slice(0, limite || 8)
      .map(function fmt(x) { return { rotulo: x.rotulo, valor: x.valor, texto: quantidade(x.valor) + (x.und ? ' ' + x.und : '') }; });
  }

  // ───────────── HTML ─────────────
  function kpiCard(titulo, valor, sub, icone, cor, id) {
    return '<div class="dashboard-kpi-card" id="' + id + '">' +
      '<div class="dashboard-kpi-icon ' + (KPI_CORES[cor] || KPI_CORES.blue) + '"><i data-lucide="' + icone + '" class="w-4 h-4"></i></div>' +
      '<div class="dashboard-kpi-body">' +
        '<div class="dashboard-kpi-label">' + esc(titulo) + '</div>' +
        '<div class="stat-val dashboard-kpi-value">' + esc(valor) + '</div>' +
        '<div class="stat-sub dashboard-kpi-sub">' + esc(sub) + '</div>' +
      '</div></div>';
  }

  function vazio(icone, texto) {
    return '<div class="dashboard-state"><i data-lucide="' + icone + '" class="w-6 h-6 text-slate-300"></i><span>' + esc(texto) + '</span></div>';
  }

  function graficoStatus(cont) {
    var chaves = STATUS_ORDEM.filter(function f(k) { return cont[k] > 0; });
    var total = chaves.reduce(function sum(a, k) { return a + cont[k]; }, 0);
    if (!total) return vazio('pie-chart', 'Sem solicitações no período');
    var acumulado = 0;
    var fatias;
    if (chaves.length === 1) {
      fatias = '<circle cx="50" cy="50" r="40" fill="' + STATUS[chaves[0]].cor + '"><title>' + esc(STATUS[chaves[0]].label) + ': ' + cont[chaves[0]] + '</title></circle>';
    } else {
      fatias = chaves.map(function fatia(k) {
        var ini = (acumulado / total) * 360;
        acumulado += cont[k];
        var fim = (acumulado / total) * 360;
        var r1 = (ini - 90) * Math.PI / 180;
        var r2 = (fim - 90) * Math.PI / 180;
        return '<path d="M50,50 L' + (50 + 40 * Math.cos(r1)).toFixed(1) + ',' + (50 + 40 * Math.sin(r1)).toFixed(1) +
          ' A40,40 0 ' + (fim - ini > 180 ? 1 : 0) + ',1 ' + (50 + 40 * Math.cos(r2)).toFixed(1) + ',' + (50 + 40 * Math.sin(r2)).toFixed(1) +
          ' Z" fill="' + STATUS[k].cor + '"><title>' + esc(STATUS[k].label) + ': ' + cont[k] + '</title></path>';
      }).join('');
    }
    var legenda = chaves.map(function l(k) {
      return '<div class="flex items-center gap-2 text-xs"><span style="width:10px;height:10px;border-radius:2px;background:' + STATUS[k].cor + ';display:inline-block"></span>' +
        esc(STATUS[k].label) + ' · ' + cont[k] + ' (' + ((cont[k] / total) * 100).toFixed(1).replace('.', ',') + '%)</div>';
    }).join('');
    return '<div class="dashboard-donut flex items-center p-3 gap-4"><svg width="200" height="200" viewBox="0 0 100 100" role="img" aria-label="Solicitações por status">' + fatias +
      '<circle cx="50" cy="50" r="25" fill="white"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700">' + total + '</text></svg>' +
      '<div class="flex flex-col gap-1">' + legenda + '</div></div>';
  }

  function graficoLinha(pontos, textoVazio) {
    if (!pontos.length) return vazio('trending-up', textoVazio);
    var w = 420, h = 160, pad = 8;
    var plotW = w - pad * 2, plotH = h - pad * 2;
    var n = pontos.length;
    var max = Math.max.apply(null, pontos.map(function v(p) { return p.valor; }).concat([1]));
    var xy = pontos.map(function p(pt, i) {
      return { x: n === 1 ? w / 2 : pad + (i / (n - 1)) * plotW, y: pad + plotH - (pt.valor / max) * plotH };
    });
    var linha = xy.map(function p(q) { return q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ');
    var area = xy.map(function p(q, i) { return (i === 0 ? 'M' : 'L') + q.x.toFixed(1) + ',' + q.y.toFixed(1); }).join(' ') + ' L' + xy[n - 1].x.toFixed(1) + ',' + (pad + plotH) + ' L' + xy[0].x.toFixed(1) + ',' + (pad + plotH) + ' Z';
    var pontosSvg = xy.map(function p(q, i) {
      return '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="5" fill="' + CORES[0] + '" stroke="#fff" stroke-width="2"><title>' + esc(pontos[i].rotulo + ': ' + pontos[i].texto) + '</title></circle>';
    }).join('');
    var passo = Math.ceil(n / 8);
    var rotulos = xy.map(function p(q, i) {
      if (i % passo !== 0 && i !== n - 1) return '';
      return '<text x="' + q.x.toFixed(1) + '" y="' + (h + 18) + '" text-anchor="' + (n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '" font-size="11" fill="#94a3b8">' + esc(pontos[i].rotulo) + '</text>';
    }).join('');
    return '<div class="p-3" style="overflow:hidden"><svg width="100%" height="200" viewBox="0 0 ' + w + ' ' + (h + 24) + '" preserveAspectRatio="xMidYMid meet">' +
      '<path d="' + area + '" fill="' + CORES[0] + '" opacity="0.08"/>' +
      '<polyline points="' + linha + '" fill="none" stroke="' + CORES[0] + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
      pontosSvg + rotulos + '</svg></div>';
  }

  function graficoBarras(grupos, textoVazio, icone) {
    if (!grupos.length) return vazio(icone, textoVazio);
    var max = Math.max.apply(null, grupos.map(function v(g) { return g.valor; }).concat([1]));
    return '<div class="p-3">' + grupos.map(function barra(g, i) {
      return '<div class="flex items-center gap-2 text-sm mb-2">' +
        '<span class="text-slate-700 w-32 truncate text-xs font-medium" title="' + esc(g.rotulo) + '">' + esc(g.rotulo) + '</span>' +
        '<div class="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden"><div class="h-full rounded-full" style="width:' + ((g.valor / max) * 100).toFixed(1) + '%;background:' + CORES[i % CORES.length] + '"></div></div>' +
        '<span class="text-slate-600 text-xs font-mono w-24 text-right">' + esc(g.texto) + '</span></div>';
    }).join('') + '</div>';
  }

  function pill(status) {
    var m = STATUS[status] || { label: status, cls: '' };
    return '<span class="sup-pill ' + m.cls + '">' + esc(m.label) + '</span>';
  }

  function tabelaRecentes(sols, lojas, limite) {
    var lista = (sols || []).slice().sort(function ord(a, b) { return String(b.criado_em || '') > String(a.criado_em || '') ? 1 : -1; }).slice(0, limite || 8);
    if (!lista.length) return '<div class="dashboard-table-scroll"><table class="dashboard-table"><tbody><tr><td class="text-center text-slate-400 py-6">Nenhuma solicitação encontrada.</td></tr></tbody></table></div>';
    return '<div class="dashboard-table-scroll"><table class="dashboard-table"><thead><tr><th>Número</th><th>Loja</th><th class="text-right">Itens</th><th>Status</th><th class="text-right">Valor</th><th>Data</th></tr></thead><tbody>' +
      lista.map(function row(s) {
        return '<tr class="cursor-pointer" data-sol="' + esc(s.id) + '"><td class="font-medium">' + esc(s.numero) + '</td><td>' + esc(nomeLoja(lojas, s.store_id)) + '</td>' +
          '<td class="text-right">' + linhas(s).length + '</td><td>' + pill(s.status) + '</td><td class="text-right">' + (Number(s.total) > 0 ? moeda(s.total) : '—') + '</td>' +
          '<td class="text-xs text-slate-400">' + dataBR(s.criado_em) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // Parte que muda quando o filtro muda (KPIs, gráficos e tabela).
  function renderCorpo(ctx) {
    var sols = filtrar(ctx.sols, ctx.filtros);
    var k = kpis(sols);
    return '<div class="dashboard-kpi-grid">' +
        kpiCard('Solicitações Totais', k.total, 'Solicitações filtradas', 'trending-up', 'blue', 'sup-dash-total') +
        kpiCard('Em Andamento', k.emAndamento, k.pendentes + ' pendentes · ' + k.aprovadas + ' aprovadas', 'loader', 'violet', 'sup-dash-andamento') +
        kpiCard('Entregas Confirmadas', k.entregues, 'Solicitações entregues', 'package-check', 'emerald', 'sup-dash-entregues') +
        kpiCard('Solicitações Recusadas', k.recusadas, 'Recusadas pela Sfera', 'x-circle', 'amber', 'sup-dash-recusadas') +
      '</div>' +
      '<div class="dashboard-kpi-grid">' +
        kpiCard('Total de Lojas', k.lojas, 'com solicitações', 'store', 'blue', 'sup-dash-lojas') +
        kpiCard('Itens Solicitados', quantidade(k.itens), 'unidades pedidas', 'package', 'emerald', 'sup-dash-itens') +
        kpiCard('Valor Total Solicitado', moeda(k.valor), 'Soma das solicitações', 'dollar-sign', 'emerald', 'sup-dash-valor') +
        kpiCard('Valor Entregue', moeda(k.valorEntregue), 'solicitações entregues', 'file-check', 'violet', 'sup-dash-valor-entregue') +
      '</div>' +
      '<div class="dashboard-chart-grid">' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Solicitações por Status</h3></div><div class="dashboard-chart-body-new">' + graficoStatus(porStatus(sols)) + '</div></div>' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Evolução de Solicitações</h3></div><div class="dashboard-chart-body-new">' + graficoLinha(evolucaoMensal(sols), 'Sem solicitações recentes') + '</div></div>' +
      '</div>' +
      '<div class="dashboard-chart-grid">' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Valor por Loja</h3></div><div class="dashboard-chart-body-new">' + graficoBarras(valorPorLoja(sols, ctx.lojas, 5), 'Sem dados de valor por loja', 'bar-chart-3') + '</div></div>' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Itens Mais Pedidos</h3></div><div class="dashboard-chart-body-new">' + graficoBarras(itensMaisPedidos(sols, 8), 'Sem itens solicitados', 'package') + '</div></div>' +
      '</div>' +
      '<div class="dashboard-chart-grid">' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Evolução R$ das Solicitações</h3></div><div class="dashboard-chart-body-new">' + graficoLinha(evolucaoValorDiaria(sols), 'Sem dados de valor por dia') + '</div></div>' +
        '<div class="dashboard-card"><div class="dashboard-card-header"><h3 class="dashboard-card-title">Solicitações Recentes</h3></div>' + tabelaRecentes(sols, ctx.lojas, 6) + '</div>' +
      '</div>';
  }

  function rotuloSelecao(qtd) {
    return qtd === 0 ? 'Selecione' : qtd + ' selecionado' + (qtd > 1 ? 's' : '');
  }

  function dropdown(id, titulo, opcoes, marcados, aberto, placeholder) {
    return '<div class="dashboard-filter-field"><label>' + esc(titulo) + '</label><div class="dash-dd">' +
      '<button type="button" class="dash-dd-toggle' + (aberto ? ' dash-dd-open' : '') + '" data-dash-toggle="' + id + '">' +
        '<span class="dash-dd-label" id="' + id + '-label">' + rotuloSelecao(marcados.length) + '</span>' +
        '<i data-lucide="chevron-down" class="w-4 h-4 dash-dd-arrow"></i></button>' +
      '<div id="' + id + '" class="dash-dd-content' + (aberto ? '' : ' hidden') + '">' +
        '<div class="dash-dd-search-wrapper"><input type="text" class="dash-dd-search" data-dash-search="' + id + '" placeholder="' + esc(placeholder) + '"></div>' +
        '<div class="dash-dd-checkboxes">' + opcoes.map(function o(op) {
          return '<label class="dashboard-filter-checkbox-item"><input type="checkbox" data-dash-filter="' + id.replace('sup-dash-', '') + '" value="' + esc(op.valor) + '"' + (marcados.indexOf(op.valor) !== -1 ? ' checked' : '') + '> ' + esc(op.rotulo) + '</label>';
        }).join('') + '</div></div></div></div>';
  }

  function renderPagina(ctx) {
    var f = ctx.filtros || filtrosVazios();
    var lojas = (ctx.lojas || []).map(function l(x) { return { valor: String(x.id), rotulo: x.nome || 'Loja #' + x.id }; });
    var status = STATUS_ORDEM.map(function s(k) { return { valor: k, rotulo: STATUS[k].label }; });
    return '<section class="animate-in space-y-3">' +
      '<div class="dashboard-filter-card"><div class="dashboard-filter-grid">' +
        '<div class="dashboard-filter-field"><label for="sup-dash-de">De</label><input type="date" id="sup-dash-de" class="form-input" data-dash-filter="dateStart" value="' + esc(f.dateStart) + '"></div>' +
        '<div class="dashboard-filter-field"><label for="sup-dash-ate">Até</label><input type="date" id="sup-dash-ate" class="form-input" data-dash-filter="dateEnd" value="' + esc(f.dateEnd) + '"></div>' +
        dropdown('sup-dash-lojas', 'Lojas', lojas, f.lojas, ctx.aberto === 'sup-dash-lojas', 'Buscar por nome...') +
        dropdown('sup-dash-status', 'Status', status, f.status, ctx.aberto === 'sup-dash-status', 'Buscar status...') +
        '<div class="dashboard-filter-field dashboard-filter-actions"><label aria-hidden="true">&nbsp;</label>' +
          '<button type="button" class="dashboard-filter-clear" data-action="dash-limpar"><i data-lucide="x" class="w-4 h-4"></i> Limpar Filtro</button></div>' +
      '</div></div>' +
      '<div id="sup-dash-body" class="space-y-3">' + renderCorpo(ctx) + '</div>' +
    '</section>';
  }

  // ───────────── tela própria (rota /dashboard-suprimentos) ─────────────
  // Admin enxerga todas as lojas; usuário de loja enxerga só as suas (RLS no banco).
  var S = null;
  var deps = null;
  var bound = [];

  function on(el, type, fn) { if (!el) return; el.addEventListener(type, fn); bound.push([el, type, fn]); }
  function icons() { if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons(); }
  function raiz() { return document.getElementById('supdash-root'); }
  function ctx() { return { sols: S.sols, lojas: S.lojas, filtros: S.filtros, aberto: S.aberto }; }
  function desenharPagina() { raiz().innerHTML = renderPagina(ctx()); icons(); }

  function desenharCorpo() {
    var corpo = document.getElementById('sup-dash-body');
    if (!corpo) return;
    corpo.innerHTML = renderCorpo(ctx());
    icons();
  }

  function fecharDropdowns() {
    if (S) S.aberto = null;
    document.querySelectorAll('.dash-dd-content').forEach(function c(el) { el.classList.add('hidden'); });
    document.querySelectorAll('.dash-dd-toggle').forEach(function t(el) { el.classList.remove('dash-dd-open'); });
  }

  function alternarDropdown(botao) {
    var id = botao.getAttribute('data-dash-toggle');
    var conteudo = document.getElementById(id);
    if (!conteudo) return;
    var estavaAberto = !conteudo.classList.contains('hidden');
    fecharDropdowns();
    if (!estavaAberto) {
      conteudo.classList.remove('hidden');
      botao.classList.add('dash-dd-open');
      S.aberto = id;
    }
  }

  function onClick(ev) {
    var t = ev.target;
    var toggle = t.closest('[data-dash-toggle]');
    if (toggle) return alternarDropdown(toggle);
    if (t.closest('[data-action="dash-limpar"]')) {
      S.filtros = filtrosVazios();
      S.aberto = null;
      return desenharPagina();
    }
    // Abrir a solicitação (responder, PDF) é na tela de Suprimentos.
    if (t.closest('tr[data-sol]') && deps && typeof deps.navigateTo === 'function') {
      return deps.navigateTo(S.admin ? '/suprimentos?aba=solicitacoes' : '/suprimentos?aba=minhas');
    }
  }

  function onChange(ev) {
    var el = ev.target;
    var chave = el.getAttribute && el.getAttribute('data-dash-filter');
    if (!chave) return;
    if (chave === 'dateStart' || chave === 'dateEnd') {
      S.filtros[chave] = el.value || '';
    } else if (chave === 'lojas' || chave === 'status') {
      S.filtros[chave] = Array.from(document.querySelectorAll('input[data-dash-filter="' + chave + '"]:checked')).map(function v(cb) { return cb.value; });
      var rotulo = document.getElementById('sup-dash-' + chave + '-label');
      if (rotulo) rotulo.textContent = rotuloSelecao(S.filtros[chave].length);
    }
    desenharCorpo();
  }

  function onInput(ev) {
    var id = ev.target.getAttribute && ev.target.getAttribute('data-dash-search');
    var caixa = id && document.getElementById(id);
    if (!caixa) return;
    var q = normalizar(ev.target.value);
    Array.from(caixa.querySelectorAll('.dashboard-filter-checkbox-item')).forEach(function l(label) {
      label.style.display = normalizar(label.textContent).indexOf(q) !== -1 ? '' : 'none';
    });
  }

  async function afterRenderDashboardSuprimentos(routeDeps) {
    deps = routeDeps;
    var D = global.SuppliesDataModule;
    var usuario = deps.getCurrentUser();
    var sb = await deps.getSb();
    S = { sb: sb, admin: Boolean(usuario && usuario.papel === 'admin'), sols: [], lojas: [], filtros: filtrosVazios(), aberto: null };
    var el = raiz();
    if (!el) return;
    el.innerHTML = '<div class="sup-empty">Carregando…</div>';
    on(el, 'click', onClick);
    on(el, 'change', onChange);
    on(el, 'input', onInput);
    on(document, 'click', function onDocClick(ev) { if (!ev.target.closest('.dash-dd')) fecharDropdowns(); });
    try {
      var res = await Promise.all([D.listarLojas(sb, usuario), D.listarSolicitacoes(sb, null)]);
      S.lojas = res[0];
      S.sols = res[1];
    } catch (e) {
      console.error('[Dashboard Suprimentos]', e);
      el.innerHTML = '<div class="sup-empty">Não foi possível carregar o dashboard. Tente de novo.</div>';
      return;
    }
    desenharPagina();
  }

  function beforeLeave() {
    bound.forEach(function off(b) { b[0].removeEventListener(b[1], b[2]); });
    bound = [];
    S = null;
  }

  global.SuppliesDashboardModule = {
    afterRenderDashboardSuprimentos: afterRenderDashboardSuprimentos,
    beforeLeave: beforeLeave,
    STATUS: STATUS,
    evolucaoMensal: evolucaoMensal,
    evolucaoValorDiaria: evolucaoValorDiaria,
    filtrar: filtrar,
    filtrosVazios: filtrosVazios,
    graficoStatus: graficoStatus,
    itensMaisPedidos: itensMaisPedidos,
    kpis: kpis,
    porStatus: porStatus,
    renderCorpo: renderCorpo,
    renderPagina: renderPagina,
    rotuloSelecao: rotuloSelecao,
    valorPorLoja: valorPorLoja,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SuppliesDashboardModule;
  }
})(typeof window !== 'undefined' ? window : globalThis);
