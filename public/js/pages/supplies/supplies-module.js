(function initSuppliesModule(global) {
  var JSPDF_SRC = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  var JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
  var AUTOTABLE_SRC = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
  var AUTOTABLE_SRI = 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3';
  var STATUS = {
    pendente: { label: 'Pendente', cls: 'sup-pill--warn' },
    aprovada: { label: 'Aprovada', cls: 'sup-pill--info' },
    entregue: { label: 'Entregue', cls: 'sup-pill--ok' },
    recusada: { label: 'Recusada', cls: 'sup-pill--bad' },
  };
  var CATEGORIAS_PADRAO = ['Limpeza', 'Escritório', 'Higiene', 'Copa e Cozinha'];

  var D = null; // SuppliesDataModule
  var S = null; // estado da página
  var deps = null;
  var bound = [];

  // ───────────── utilidades ─────────────
  function $(id) { return document.getElementById(id); }
  function esc(v) { return global.AppUtils ? global.AppUtils.escapeHtml(v) : String(v == null ? '' : v); }
  function brl(v) { return v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function num(v) { return v === null || v === undefined || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function dataHora(s) { return s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function data(s) { return s ? new Date(s).toLocaleDateString('pt-BR') : '—'; }
  function decimalBR(v) { return v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','); }
  function toast(msg) { if (deps && deps.showToast) deps.showToast(msg); }
  function erro(e, msg) { console.error('[Suprimentos]', e); toast(msg || ('Erro: ' + (e && e.message ? e.message : 'falha inesperada'))); }
  function icons() { if (global.lucide && typeof global.lucide.createIcons === 'function') global.lucide.createIcons(); }
  function pill(status) { var m = STATUS[status] || { label: status, cls: '' }; return '<span class="sup-pill ' + m.cls + '">' + esc(m.label) + '</span>'; }
  function lojaNome(id) { var l = S.lojas.find(function f(x) { return String(x.id) === String(id); }); return l ? l.nome : String(id); }
  function on(el, type, fn) { if (!el) return; el.addEventListener(type, fn); bound.push([el, type, fn]); }

  // ───────────── ciclo de vida ─────────────
  async function afterRenderSuprimentos(routeDeps) {
    deps = routeDeps;
    D = global.SuppliesDataModule;
    var usuario = deps.getCurrentUser();
    var sb = await deps.getSb();
    S = {
      sb: sb,
      usuario: usuario,
      admin: Boolean(usuario && usuario.papel === 'admin'),
      lojas: [],
      lojaId: null,
      itens: [],
      contagem: { valores: {} },
      local: {},
      dirty: false,
      saveTimer: null,
      sols: [],
      aba: null,
      busca: '',
      categoria: 'Todas',
      filtroStatus: 'pendente',
      filtroLoja: '',
      catalogo: null,
      catalogoRows: null,
      resumo: null,
      lojaDetalhe: null,
    };
    bindShell();
    try {
      S.lojas = await D.listarLojas(sb, usuario);
    } catch (e) {
      erro(e, 'Não foi possível carregar as lojas.');
      S.lojas = [];
    }
    if (S.admin) {
      $('sup-store-select').innerHTML = '<option value="">Escolher loja…</option>' + S.lojas.map(function opt(l) { return '<option value="' + esc(l.id) + '">' + esc(l.nome) + '</option>'; }).join('');
    }
    var params = deps.params || {};
    var abaPedida = params.aba || (typeof params.get === 'function' ? params.get('aba') : null);
    var abas = abasDisponiveis();
    S.aba = abas.some(function f(a) { return a.key === abaPedida; }) ? abaPedida : abas[0].key;
    if (!S.admin) {
      if (!S.lojas.length) {
        renderTabs();
        $('sup-content').innerHTML = '<div class="sup-empty">Seu usuário ainda não está ligado a nenhuma loja. Fale com a Sfera.</div>';
        return;
      }
      S.lojaId = S.lojas[0].id;
      montarSeletorLoja();
      await carregarLoja();
    }
    renderTabs();
    await renderAba();
  }

  async function beforeLeave() {
    if (S && S.dirty) await salvarContagemAgora();
    bound.forEach(function off(b) { b[0].removeEventListener(b[1], b[2]); });
    bound = [];
    if (S && S.saveTimer) clearTimeout(S.saveTimer);
  }

  function abasDisponiveis() {
    if (S.admin) {
      return [
        { key: 'solicitacoes', label: 'Solicitações das lojas', icon: 'inbox' },
        { key: 'contagem', label: 'Novo pedido por loja', icon: 'clipboard-list', oculta: true },
        { key: 'itens', label: 'Cadastro de itens', icon: 'list' },
        { key: 'lojas', label: 'Lojas', icon: 'store' },
      ];
    }
    return [
      { key: 'contagem', label: 'Novo pedido', icon: 'clipboard-list' },
      { key: 'minhas', label: 'Minhas solicitações', icon: 'send' },
    ];
  }

  function renderTabs() {
    $('sup-tabs').innerHTML = abasDisponiveis().filter(function visivel(a) { return !a.oculta; }).map(function tab(a) {
      return '<button type="button" class="sup-tab' + (S.aba === a.key ? ' is-active' : '') + '" data-tab="' + a.key + '"><i data-lucide="' + a.icon + '" class="w-4 h-4"></i><span>' + esc(a.label) + '</span></button>';
    }).join('');
    // Admin só vê o seletor de loja na aba "Pedido por loja".
    if (S.admin) $('sup-store-wrapper').classList.toggle('hidden', S.aba !== 'contagem');
    icons();
  }

  // Mantém a URL (?aba=) e o destaque do menu lateral em sincronia com a aba aberta.
  function sincronizarUrl() {
    try {
      window.history.replaceState({}, '', '/suprimentos?aba=' + encodeURIComponent(S.aba));
      window.dispatchEvent(new Event('sup:aba'));
    } catch (e) { /* sem URL/menu sincronizado: a aba continua funcionando */ }
  }

  // Troca de aba por botão dentro da tela (sem passar pela barra de abas).
  async function irParaAba(chave) {
    if (S.dirty) await salvarContagemAgora();
    S.aba = chave;
    S.busca = '';
    S.lojaDetalhe = null;
    sincronizarUrl();
    if (S.admin && chave === 'contagem' && S.lojaId) await carregarLoja();
    renderTabs();
    renderAba();
  }

  function montarSeletorLoja() {
    var wrap = $('sup-store-wrapper');
    var sel = $('sup-store-select');
    if (S.lojas.length > 1) {
      sel.innerHTML = S.lojas.map(function opt(l) { return '<option value="' + esc(l.id) + '">' + esc(l.nome) + '</option>'; }).join('');
      sel.value = String(S.lojaId);
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
  }

  function bindShell() {
    on($('sup-tabs'), 'click', async function onTab(ev) {
      var b = ev.target.closest('[data-tab]');
      if (!b) return;
      if (S.dirty) await salvarContagemAgora();
      S.aba = b.dataset.tab;
      S.busca = '';
      S.lojaDetalhe = null;
      sincronizarUrl();
      if (S.admin && S.aba === 'contagem' && S.lojaId) await carregarLoja();
      renderTabs();
      renderAba();
    });
    on($('sup-store-select'), 'change', async function onStore(ev) {
      if (S.dirty) await salvarContagemAgora();
      S.lojaId = ev.target.value ? Number(ev.target.value) : null;
      if (S.lojaId) await carregarLoja();
      renderAba();
    });
    on($('sup-content'), 'click', onContentClick);
    on($('sup-content'), 'input', onContentInput);
    on($('sup-content'), 'change', onContentChange);
    on($('sup-modal'), 'click', function onModalClick(ev) {
      if (ev.target.closest('[data-sup-close]')) fecharModal();
    });
    on(document, 'keydown', function onKey(ev) {
      if (ev.key === 'Escape' && !$('sup-modal').classList.contains('hidden')) fecharModal();
    });
  }

  async function renderAba() {
    var el = $('sup-content');
    if (!el) return;
    el.innerHTML = '<div class="sup-empty">Carregando…</div>';
    try {
      if (S.aba === 'contagem') {
        if (S.admin && !S.lojaId) el.innerHTML = '<div class="sup-card"><div class="sup-empty">Escolha a loja no campo “Loja” acima para fazer o pedido de suprimentos por ela.</div><div class="sup-actions"><button type="button" class="sup-btn" data-action="voltar-pedidos"><i data-lucide="arrow-left" class="w-4 h-4"></i><span>Voltar aos pedidos</span></button></div></div>';
        else renderContagem();
      }
      else if (S.aba === 'minhas') renderMinhas();
      else if (S.aba === 'solicitacoes') await renderSolicitacoesAdmin();
      else if (S.aba === 'itens') await renderCatalogo();
      else if (S.aba === 'lojas') await (S.lojaDetalhe ? renderLojaDetalhe() : renderLojasAdmin());
    } catch (e) {
      erro(e);
      el.innerHTML = '<div class="sup-empty">Não foi possível carregar. Tente de novo.</div>';
    }
    icons();
  }

  // ───────────── modal ─────────────
  function abrirModal(titulo, corpo, rodape, largo) {
    $('sup-modal-title').textContent = titulo;
    $('sup-modal-body').innerHTML = corpo;
    $('sup-modal-footer').innerHTML = rodape || '<button type="button" class="sup-btn" data-sup-close>Fechar</button>';
    $('sup-modal').classList.toggle('sup-modal--wide', Boolean(largo));
    $('sup-modal').classList.remove('hidden');
    icons();
    return $('sup-modal');
  }
  function fecharModal() {
    $('sup-modal').classList.add('hidden');
    $('sup-modal-body').innerHTML = '';
    $('sup-modal-footer').innerHTML = '';
    if (S && S.onModalClose) { var f = S.onModalClose; S.onModalClose = null; f(); }
  }

  // ───────────── LOJA: contagem ─────────────
  async function carregarLoja() {
    var res = await Promise.all([
      D.listarItensDaLoja(S.sb, S.lojaId),
      D.carregarContagem(S.sb, S.lojaId),
      D.listarSolicitacoes(S.sb, S.lojaId),
    ]);
    S.itens = res[0];
    S.contagem = res[1];
    S.sols = res[2];
    S.local = {};
    S.dirty = false;
  }

  function valorFisico(id) {
    if (Object.prototype.hasOwnProperty.call(S.local, id)) return S.local[id];
    var v = (S.contagem.valores || {})[id];
    return v === undefined ? '' : v;
  }

  function valoresAtuais() {
    var v = Object.assign({}, S.contagem.valores || {});
    Object.keys(S.local).forEach(function k(id) {
      if (S.local[id] === '' || S.local[id] === null) delete v[id];
      else v[id] = S.local[id];
    });
    return v;
  }

  function itensVisiveis() {
    var q = D.normalizarTexto(S.busca);
    return S.itens.filter(function f(i) {
      return i.ativo !== false && (S.categoria === 'Todas' || i.categoria === S.categoria) && (!q || D.normalizarTexto(i.nome + ' ' + i.categoria).includes(q));
    }).sort(function s(a, b) {
      return String(a.categoria).localeCompare(String(b.categoria), 'pt-BR') || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
  }

  function resumoContagem() {
    var valores = valoresAtuais();
    var ativos = S.itens.filter(function a(i) { return i.ativo !== false; });
    var r = { itens: ativos.length, contados: 0, comprar: 0, total: 0 };
    ativos.forEach(function each(i) {
      var c = D.calcularPedidoLinha(i, valores[i.id]);
      if (c.compra > 0) { r.contados++; r.comprar++; r.total += c.total; }
    });
    return r;
  }

  function linhaContagem(i) {
    var c = D.calcularPedidoLinha(i, valorFisico(i.id));
    return '<tr data-row="' + esc(i.id) + '"' + (c.compra > 0 ? ' class="sup-row--buy"' : '') + '>' +
      '<td><div class="sup-item-name">' + esc(i.nome) + '</div></td>' +
      '<td class="sup-muted">' + esc(i.categoria) + '</td>' +
      '<td class="sup-muted sup-center">' + esc(i.unidade) + '</td>' +
      '<td class="sup-num"><input class="form-input sup-qty" inputmode="decimal" data-fisico="' + esc(i.id) + '" value="' + esc(decimalBR(valorFisico(i.id))) + '" placeholder="0" aria-label="Quantidade a pedir de ' + esc(i.nome) + '"></td>' +
      '<td class="sup-num">' + brl(c.custo) + '</td>' +
      '<td class="sup-num" data-cell="total">' + (c.total ? brl(c.total) : '<span class="sup-muted">—</span>') + '</td>' +
    '</tr>';
  }

  function kpisContagem() {
    var r = resumoContagem();
    return '<div class="sup-kpis" id="sup-kpis">' +
      kpi('Itens da loja', r.itens, 'lista disponível para pedir') +
      kpi('Itens no pedido', r.comprar, 'com quantidade preenchida') +
      kpi('Valor do pedido', brl(r.total), 'pela quantidade informada', 'accent') +
      kpi('Rascunho salvo', S.contagem.atualizado_em ? dataHora(S.contagem.atualizado_em) : 'nunca', S.dirty ? 'salvando…' : 'salvo automaticamente') +
    '</div>';
  }
  function kpi(titulo, valor, sub, tom) {
    return '<div class="sup-kpi' + (tom ? ' sup-kpi--' + tom : '') + '"><span class="sup-kpi-label">' + esc(titulo) + '</span><span class="sup-kpi-value">' + esc(valor) + '</span><span class="sup-kpi-sub">' + esc(sub) + '</span></div>';
  }

  function filtrosItens() {
    var cats = ['Todas'].concat(Array.from(new Set(S.itens.map(function c(i) { return i.categoria; }))).sort());
    return '<div class="sup-filters"><div class="sup-search"><i data-lucide="search" class="w-4 h-4"></i><input id="sup-busca" type="search" class="form-input" placeholder="Buscar item…" value="' + esc(S.busca) + '"></div>' +
      '<div class="sup-chips">' + cats.map(function chip(c) { return '<button type="button" class="sup-chip' + (S.categoria === c ? ' is-active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
  }

  function renderContagem() {
    var lista = itensVisiveis();
    $('sup-content').innerHTML = kpisContagem() +
      '<div class="sup-card">' +
        '<div class="sup-card-head">' + filtrosItens() +
          '<div class="sup-actions">' + (S.admin ? '<button type="button" class="sup-btn" data-action="voltar-pedidos"><i data-lucide="arrow-left" class="w-4 h-4"></i><span>Voltar aos pedidos</span></button>' : '') + '<button type="button" class="sup-btn sup-btn--primary" data-action="abrir-envio"><i data-lucide="send" class="w-4 h-4"></i><span>Enviar pedido</span></button></div></div>' +
        (S.itens.length ? '' : '<div class="sup-empty">' + (S.admin ? 'Esta loja ainda não tem lista de itens. Cadastre em “Lojas” (colar lista do Excel ou copiar de outra loja).' : 'A Sfera ainda não cadastrou a lista de itens desta loja.') + '</div>') +
        '<div class="sup-table-scroll"><table class="sup-table"><thead><tr><th>Item</th><th>Categoria</th><th class="sup-center">Und</th><th class="sup-num">Quantidade a pedir</th><th class="sup-num">Custo unit.</th><th class="sup-num">Valor total</th></tr></thead>' +
        '<tbody>' + (lista.map(function l(i) { return linhaContagem(i); }).join('') || (S.itens.length ? '<tr><td colspan="6" class="sup-empty">Nenhum item encontrado.</td></tr>' : '')) + '</tbody></table></div>' +
        '<p class="sup-hint">Digite só a quantidade que a loja precisa pedir. O rascunho é salvo sozinho; quando terminar, clique em <b>Enviar pedido</b>.</p>' +
      '</div>';
  }

  function atualizarLinha(id) {
    var tr = document.querySelector('tr[data-row="' + CSS.escape(id) + '"]');
    var item = S.itens.find(function f(i) { return i.id === id; });
    if (!tr || !item) return;
    var c = D.calcularPedidoLinha(item, valorFisico(id));
    tr.classList.toggle('sup-row--buy', c.compra > 0);
    tr.querySelector('[data-cell="total"]').innerHTML = c.total ? brl(c.total) : '<span class="sup-muted">—</span>';
    var k = $('sup-kpis');
    if (k) k.outerHTML = kpisContagem();
  }

  function agendarSalvar() {
    S.dirty = true;
    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(salvarContagemAgora, 1200);
  }

  async function salvarContagemAgora() {
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (!S.dirty || !S.lojaId) return;
    var valores = valoresAtuais();
    try {
      var r = await D.salvarContagem(S.sb, S.lojaId, valores);
      S.contagem = (r && r[0]) || { store_id: S.lojaId, valores: valores, atualizado_em: new Date().toISOString() };
      S.local = {};
      S.dirty = false;
      var k = $('sup-kpis');
      if (k) k.outerHTML = kpisContagem();
    } catch (e) {
      erro(e, 'Não foi possível salvar a contagem. Verifique a internet.');
    }
  }

  function abrirEnvio() {
    var m = D.montarPedido(S.itens, valoresAtuais());
    if (!m.itens.length) {
      toast('Informe a quantidade de pelo menos um item antes de enviar.');
      return;
    }
    abrirModal(S.admin ? 'Registrar pedido da loja' : 'Enviar pedido para a Sfera',
      '<div class="sup-table-scroll sup-table-scroll--modal"><table class="sup-table"><thead><tr><th>Item</th><th class="sup-center">Und</th><th class="sup-num">Quantidade</th><th class="sup-num">Valor</th></tr></thead><tbody>' +
      m.itens.map(function l(i) { return '<tr><td>' + esc(i.nome) + '</td><td class="sup-center sup-muted">' + esc(i.und) + '</td><td class="sup-num">' + num(i.compra) + '</td><td class="sup-num">' + brl(i.custo !== null ? i.custo * i.compra : null) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="3">Total</td><td class="sup-num">' + brl(m.total) + '</td></tr></tfoot></table></div>' +
      '<label class="sup-field"><span>Observação (opcional)</span><textarea id="sup-envio-obs" class="form-input" rows="2" maxlength="500"></textarea></label>',
      '<button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-envio-ok">Enviar ' + m.itens.length + ' itens · ' + brl(m.total) + '</button>');
    $('sup-envio-ok').addEventListener('click', async function enviar(ev) {
      var b = ev.currentTarget;
      b.disabled = true;
      try {
        await salvarContagemAgora();
        var obs = $('sup-envio-obs').value.trim();
        if (S.admin) obs = ('[Feito pela Sfera] ' + obs).trim().slice(0, 500);
        var s = await D.enviarSolicitacao(S.sb, S.lojaId, m, obs);
        // Pedido enviado: o próximo começa em branco.
        S.local = {};
        S.contagem = { store_id: S.lojaId, valores: {}, atualizado_em: null };
        try { await D.salvarContagem(S.sb, S.lojaId, {}); } catch (e) { /* rascunho antigo pode ficar; o pedido já foi enviado */ }
        fecharModal();
        toast('Solicitação ' + (s && s.numero ? s.numero : '') + (S.admin ? ' registrada.' : ' enviada para a Sfera.'));
        S.sols = await D.listarSolicitacoes(S.sb, S.admin ? null : S.lojaId);
        S.aba = S.admin ? 'solicitacoes' : 'minhas';
        sincronizarUrl();
        renderTabs();
        renderAba();
      } catch (e) {
        b.disabled = false;
        erro(e, 'Não foi possível enviar a solicitação.');
      }
    });
  }

  // ───────────── LOJA: minhas solicitações ─────────────
  function listaSolicitacoes(sols, comLoja) {
    if (!sols.length) return '<div class="sup-empty">Nenhuma solicitação.</div>';
    return '<div class="sup-table-scroll"><table class="sup-table sup-table--click"><thead><tr>' + (comLoja ? '<th>Loja</th>' : '') + '<th>Número</th><th>Enviada em</th><th class="sup-num">Itens</th><th class="sup-num">Total</th><th>Status</th><th>Resposta da Sfera</th></tr></thead><tbody>' +
      sols.map(function row(s) {
        return '<tr data-sol="' + esc(s.id) + '">' + (comLoja ? '<td><b class="sup-strong">' + esc(lojaNome(s.store_id)) + '</b></td>' : '') +
          '<td class="sup-mono">' + esc(s.numero) + '</td><td>' + dataHora(s.criado_em) + '</td><td class="sup-num">' + (s.itens || []).length + '</td><td class="sup-num">' + brl(s.total) + '</td><td>' + pill(s.status) + '</td><td class="sup-muted sup-ellipsis">' + esc(s.resposta || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderMinhas() {
    $('sup-content').innerHTML = '<div class="sup-card">' + listaSolicitacoes(S.sols, false) + '</div>';
  }

  function tabelaItensSolicitacao(s, mostrarIdeal) {
    return '<div class="sup-table-scroll sup-table-scroll--modal"><table class="sup-table"><thead><tr><th>Item</th><th class="sup-center">Und</th>' + (mostrarIdeal ? '<th class="sup-num">Ideal</th><th class="sup-num">Físico</th>' : '') + '<th class="sup-num">Quantidade</th><th class="sup-num">Custo unit.</th><th class="sup-num">Total</th></tr></thead><tbody>' +
      (s.itens || []).map(function l(i) { return '<tr><td>' + esc(i.nome) + '<div class="sup-muted sup-small">' + esc(i.fornecedor || '') + '</div></td><td class="sup-center sup-muted">' + esc(i.und) + '</td>' + (mostrarIdeal ? '<td class="sup-num">' + num(i.ideal) + '</td><td class="sup-num">' + num(i.fisico) + '</td>' : '') + '<td class="sup-num"><b>' + num(i.compra) + '</b></td><td class="sup-num">' + brl(i.custo) + '</td><td class="sup-num">' + brl(i.custo !== null && i.custo !== undefined ? i.custo * i.compra : null) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="' + (mostrarIdeal ? 6 : 4) + '">Total</td><td class="sup-num">' + brl(s.total) + '</td></tr></tfoot></table></div>';
  }

  function verSolicitacaoLoja(s) {
    abrirModal('Solicitação ' + s.numero,
      '<div class="sup-meta">' + pill(s.status) + '<span>Enviada em ' + dataHora(s.criado_em) + '</span></div>' +
      (s.resposta ? '<div class="sup-banner">Resposta da Sfera: ' + esc(s.resposta) + '</div>' : '') +
      (s.observacao ? '<p class="sup-muted">Sua observação: ' + esc(s.observacao) + '</p>' : '') +
      tabelaItensSolicitacao(s, false), null, true);
  }

  // ───────────── ADMIN: solicitações ─────────────
  async function renderSolicitacoesAdmin() {
    S.sols = await D.listarSolicitacoes(S.sb, null);
    var cont = { pendente: 0, aprovada: 0, entregue: 0, recusada: 0 };
    S.sols.forEach(function c(s) { cont[s.status] = (cont[s.status] || 0) + 1; });
    var filtros = [['pendente', 'Pendentes'], ['aprovada', 'Aprovadas'], ['entregue', 'Entregues'], ['recusada', 'Recusadas'], ['todas', 'Todas']];
    var lista = S.sols.filter(function f(s) { return (S.filtroStatus === 'todas' || s.status === S.filtroStatus) && (!S.filtroLoja || String(s.store_id) === S.filtroLoja); });
    $('sup-content').innerHTML = '<div class="sup-card"><div class="sup-card-head"><div class="sup-chips">' +
      filtros.map(function f(x) { return '<button type="button" class="sup-chip' + (S.filtroStatus === x[0] ? ' is-active' : '') + '" data-status="' + x[0] + '">' + x[1] + ' · ' + (x[0] === 'todas' ? S.sols.length : cont[x[0]] || 0) + '</button>'; }).join('') +
      '</div><div class="sup-actions"><select id="sup-filtro-loja" class="form-select sup-control"><option value="">Todas as lojas</option>' +
      S.lojas.map(function o(l) { return '<option value="' + esc(l.id) + '"' + (String(l.id) === S.filtroLoja ? ' selected' : '') + '>' + esc(l.nome) + '</option>'; }).join('') +
      '</select><button type="button" class="sup-btn sup-btn--primary" data-action="novo-pedido-loja"><i data-lucide="plus" class="w-4 h-4"></i><span>Novo pedido</span></button><button type="button" class="sup-btn" data-action="consolidado"><i data-lucide="copy" class="w-4 h-4"></i><span>Copiar consolidado</span></button></div></div>' +
      listaSolicitacoes(lista, true) + '</div>';
  }

  function verSolicitacaoAdmin(s) {
    abrirModal('Solicitação ' + s.numero + ' · ' + lojaNome(s.store_id),
      '<div class="sup-meta">' + pill(s.status) + '<span>Enviada em ' + dataHora(s.criado_em) + '</span>' + (s.respondido_em ? '<span>Respondida em ' + dataHora(s.respondido_em) + '</span>' : '') + '</div>' +
      (s.observacao ? '<div class="sup-banner">Observação da loja: ' + esc(s.observacao) + '</div>' : '') +
      tabelaItensSolicitacao(s, (s.itens || []).some(function temFisico(i) { return i.fisico !== null && i.fisico !== undefined; })) +
      '<div class="sup-grid2"><label class="sup-field"><span>Status</span><select id="sup-resp-status" class="form-select">' +
      Object.keys(STATUS).map(function o(k) { return '<option value="' + k + '"' + (s.status === k ? ' selected' : '') + '>' + STATUS[k].label + '</option>'; }).join('') +
      '</select></label><label class="sup-field"><span>Resposta para a loja</span><input id="sup-resp-texto" class="form-input" maxlength="300" value="' + esc(s.resposta || '') + '" placeholder="Ex.: pedido feito, entrega até sexta"></label></div>',
      '<button type="button" class="sup-btn" id="sup-resp-pdf"><i data-lucide="file-down" class="w-4 h-4"></i><span>PDF para fornecedor</span></button><span class="sup-spacer"></span><button type="button" class="sup-btn" data-sup-close>Fechar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-resp-ok">Salvar resposta</button>', true);
    $('sup-resp-ok').addEventListener('click', async function salvar(ev) {
      ev.currentTarget.disabled = true;
      try {
        await D.responderSolicitacao(S.sb, s.id, $('sup-resp-status').value, $('sup-resp-texto').value.trim());
        fecharModal();
        toast('Resposta salva. A loja já vê no sistema dela.');
        renderAba();
      } catch (e) { ev.currentTarget.disabled = false; erro(e); }
    });
    $('sup-resp-pdf').addEventListener('click', function pdf() { pedidoFornecedor(s); });
  }

  function copiarConsolidado() {
    var lista = S.sols.filter(function f(s) { return (S.filtroStatus === 'todas' || s.status === S.filtroStatus) && (!S.filtroLoja || String(s.store_id) === S.filtroLoja); });
    var linhas = ['Loja\tSolicitação\tItem\tUnd\tQuantidade\tCusto unit.\tTotal\tFornecedor\tStatus'];
    lista.forEach(function each(s) {
      (s.itens || []).forEach(function l(i) {
        linhas.push([lojaNome(s.store_id), s.numero, i.nome, i.und, decimalBR(i.compra), decimalBR(i.custo), decimalBR(i.custo !== null && i.custo !== undefined ? Math.round(i.custo * i.compra * 100) / 100 : ''), i.fornecedor || '', (STATUS[s.status] || {}).label || s.status].join('\t'));
      });
    });
    copiarTexto(linhas.join('\n'), (linhas.length - 1) + ' linhas copiadas. Cole no Excel.');
  }

  function copiarTexto(texto, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function ok() { toast(msg); }, function ko() { mostrarTexto(texto); });
    } else {
      mostrarTexto(texto);
    }
  }
  function mostrarTexto(texto) {
    abrirModal('Copie o texto abaixo', '<textarea class="form-input sup-mono" rows="12" readonly>' + esc(texto) + '</textarea>');
  }

  // ───────────── ADMIN: PDF do pedido para o fornecedor ─────────────
  function carregarScript(src, sri) {
    return new Promise(function load(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.integrity = sri;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function fail() { reject(new Error('Não foi possível carregar o gerador de PDF. Verifique a internet.')); };
      document.head.appendChild(s);
    });
  }
  async function jsPdfPronto() {
    if (!(global.jspdf && global.jspdf.jsPDF)) await carregarScript(JSPDF_SRC, JSPDF_SRI);
    if (!global.jspdf.jsPDF.API.autoTable) await carregarScript(AUTOTABLE_SRC, AUTOTABLE_SRI);
    return global.jspdf.jsPDF;
  }

  async function pedidoFornecedor(s) {
    var semFornecedor = (s.itens || []).filter(function f(l) { return !l.fornecedor && l.item; }).map(function i(l) { return l.item; });
    var mapa = {};
    try { mapa = await D.fornecedoresDosItens(S.sb, semFornecedor); } catch (e) { console.warn(e); }
    var grupos = D.separarPorFornecedor(s, mapa);
    if (!grupos.length) { toast('Essa solicitação não tem itens para comprar.'); return; }
    var loja = S.lojas.find(function f(l) { return String(l.id) === String(s.store_id); }) || { id: s.store_id, nome: lojaNome(s.store_id) };
    var totalGrupo = function tg(g) { return g.linhas.filter(function i(l) { return l.incluir; }).reduce(function sum(a, l) { return a + (l.custo || 0) * l.qtd; }, 0); };
    var secao = function sec(g, gi) {
      return '<div class="sup-pdf-group" data-g="' + gi + '"><div class="sup-grid3"><label class="sup-field"><span>Fornecedor</span><input class="form-input" data-fn value="' + esc(g.nomeFornecedor) + '" placeholder="Nome do fornecedor"></label>' +
        '<label class="sup-field"><span>Nº do pedido</span><input class="form-input sup-mono" data-num value="' + esc(g.numero) + '"></label>' +
        '<div class="sup-field sup-field--end"><button type="button" class="sup-btn sup-btn--primary" data-baixar>Baixar PDF</button></div></div>' +
        '<div class="sup-table-scroll sup-table-scroll--modal"><table class="sup-table"><thead><tr><th></th><th>Item</th><th class="sup-center">Und</th><th class="sup-num">Qtd</th><th class="sup-num">Valor unit.</th><th class="sup-num">Valor total</th></tr></thead><tbody>' +
        g.linhas.map(function l(x) { return '<tr data-k="' + x.chave + '"><td><input type="checkbox" data-inc checked aria-label="Incluir item"></td><td>' + esc(x.nome) + '</td><td class="sup-center sup-muted">' + esc(x.und) + '</td><td class="sup-num"><input class="form-input sup-qty" data-q value="' + esc(decimalBR(x.qtd)) + '"></td><td class="sup-num"><input class="form-input sup-qty" data-c value="' + esc(x.custo === null ? '' : x.custo.toFixed(2).replace('.', ',')) + '" placeholder="—"></td><td class="sup-num" data-t>' + brl(x.custo === null ? null : x.custo * x.qtd) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="5">Total do pedido</td><td class="sup-num" data-tot>' + brl(totalGrupo(g)) + '</td></tr></tfoot></table></div></div>';
    };
    var modal = abrirModal('Pedido para fornecedor · ' + s.numero,
      '<p class="sup-muted">' + esc(loja.nome) + ' · ' + (grupos.length > 1 ? grupos.length + ' fornecedores, um PDF para cada' : '1 fornecedor') + '. Ajuste quantidade ou valor se precisar; desmarque o que não vai pedir.</p>' +
      grupos.map(secao).join('') +
      '<label class="sup-field"><span>Observação no pedido (opcional)</span><input id="sup-pdf-obs" class="form-input" maxlength="300" placeholder="Ex.: entregar até sexta, faturar para o CNPJ da loja"></label>' +
      (s.status === 'pendente' ? '<label class="sup-check"><input type="checkbox" id="sup-pdf-aprovar" checked> Marcar a solicitação como Aprovada ao baixar</label>' : ''),
      '<button type="button" class="sup-btn" data-sup-close>Fechar</button>' + (grupos.length > 1 ? '<button type="button" class="sup-btn sup-btn--primary" id="sup-pdf-todos">Baixar todos os PDFs</button>' : ''), true);
    var ler = function ler(gi) {
      var g = grupos[gi];
      var el = modal.querySelector('[data-g="' + gi + '"]');
      g.nomeFornecedor = el.querySelector('[data-fn]').value.trim();
      g.numero = el.querySelector('[data-num]').value.trim() || s.numero;
      el.querySelectorAll('tr[data-k]').forEach(function row(tr) {
        var l = g.linhas.find(function f(x) { return String(x.chave) === tr.dataset.k; });
        l.incluir = tr.querySelector('[data-inc]').checked;
        var q = D.parseNumero(tr.querySelector('[data-q]').value);
        l.qtd = isNaN(q) ? 0 : q;
        var c = D.parseNumero(tr.querySelector('[data-c]').value);
        l.custo = isNaN(c) ? null : c;
        tr.querySelector('[data-t]').textContent = brl(l.custo === null ? null : l.custo * l.qtd);
        tr.classList.toggle('sup-row--off', !l.incluir);
      });
      el.querySelector('[data-tot]').textContent = brl(totalGrupo(g));
      return g;
    };
    modal.querySelectorAll('[data-g]').forEach(function bind(el) {
      var gi = Number(el.dataset.g);
      el.addEventListener('input', function i() { ler(gi); });
      el.addEventListener('change', function c() { ler(gi); });
    });
    var aprovou = false;
    var baixar = async function baixar(indices, botao) {
      var gs = indices.map(ler).filter(function f(g) { return g.linhas.some(function l(x) { return x.incluir && x.qtd > 0; }); });
      if (!gs.length) { toast('Nenhum item marcado para pedir.'); return; }
      botao.disabled = true;
      try {
        for (var i = 0; i < gs.length; i++) await gerarPdfPedido(s, loja, gs[i], $('sup-pdf-obs').value.trim());
        var ap = $('sup-pdf-aprovar');
        if (ap && ap.checked && !aprovou) {
          await D.responderSolicitacao(S.sb, s.id, 'aprovada', s.resposta || 'Pedido enviado ao fornecedor');
          aprovou = true;
          s.status = 'aprovada';
        }
        toast(gs.length > 1 ? gs.length + ' PDFs gerados' : 'PDF do pedido ' + gs[0].numero + ' gerado');
      } catch (e) {
        erro(e, e && e.message);
      } finally {
        botao.disabled = false;
      }
    };
    modal.querySelectorAll('[data-baixar]').forEach(function b(btn) {
      btn.addEventListener('click', function click() { baixar([Number(btn.closest('[data-g]').dataset.g)], btn); });
    });
    var todos = $('sup-pdf-todos');
    if (todos) todos.addEventListener('click', function all() { baixar(grupos.map(function i(_, k) { return k; }), todos); });
    S.onModalClose = function refresh() { if (aprovou && S.aba === 'solicitacoes') renderAba(); };
  }

  async function gerarPdfPedido(s, loja, g, obs) {
    var JsPDF = await jsPdfPronto();
    var doc = new JsPDF({ unit: 'mm', format: 'a4' });
    var W = doc.internal.pageSize.getWidth();
    var M = 14;
    var money = function money(v) { return v === null || v === undefined ? '-' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var itens = g.linhas.filter(function f(l) { return l.incluir && l.qtd > 0; });
    var total = itens.reduce(function sum(a, l) { return a + (l.custo || 0) * l.qtd; }, 0);
    doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, 26, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('SFERA MULTIFRANQUIAS', M, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Suprimentos  ·  Pedido de compra', M, 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Pedido Nº ' + g.numero, W - M, 11, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Emissão: ' + new Date().toLocaleDateString('pt-BR'), W - M, 18, { align: 'right' });
    var y = 34;
    var half = (W - 2 * M - 6) / 2;
    var bloco = function bloco(x, titulo, linhas) {
      doc.setDrawColor(210); doc.setFillColor(247, 248, 250); doc.roundedRect(x, y, half, 26, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(110); doc.text(titulo.toUpperCase(), x + 4, y + 6);
      doc.setTextColor(30);
      linhas.forEach(function line(t, i) { doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 11 : 9); doc.text(doc.splitTextToSize(t, half - 8)[0], x + 4, y + 12.5 + i * 5); });
    };
    bloco(M, 'Fornecedor', [g.nomeFornecedor || 'A definir']);
    bloco(M + half + 6, 'Entregar em (loja)', [loja.nome, 'Código da loja: ' + (loja.codigo || loja.id) + (loja.centro_custo ? '  ·  Centro de custo: ' + loja.centro_custo : ''), 'Ref. solicitação da loja: ' + s.numero + ' (' + data(s.criado_em) + ')']);
    doc.autoTable({
      startY: y + 32,
      margin: { left: M, right: M },
      head: [['#', 'Produto', 'Und', 'Qtd', 'Valor unit.', 'Valor total']],
      body: itens.map(function row(l, i) { return [String(i + 1), l.nome, l.und, Number(l.qtd).toLocaleString('pt-BR', { maximumFractionDigits: 3 }), money(l.custo), l.custo === null ? '-' : money(l.custo * l.qtd)]; }),
      foot: [[{ content: itens.length + (itens.length === 1 ? ' item' : ' itens'), colSpan: 4, styles: { halign: 'left', fontStyle: 'normal' } }, { content: 'TOTAL', styles: { halign: 'right' } }, { content: money(total), styles: { halign: 'right' } }]],
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, lineColor: [220, 223, 228], lineWidth: 0.2, textColor: 30 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [238, 241, 245], textColor: 20, fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: { 0: { cellWidth: 9, halign: 'center' }, 2: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 27, halign: 'right' }, 5: { cellWidth: 29, halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 8;
    if (obs) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Observações', M, y);
      doc.setFont('helvetica', 'normal');
      var t = doc.splitTextToSize(obs, W - 2 * M);
      doc.text(t, M, y + 5);
      y += 7 + t.length * 4.5;
    }
    doc.setFontSize(8.5); doc.setTextColor(90);
    doc.text(doc.splitTextToSize('Favor confirmar o recebimento deste pedido, o prazo de entrega e enviar a nota fiscal com o número do pedido.', W - 2 * M), M, y + 2);
    var pages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      var H = doc.internal.pageSize.getHeight();
      doc.setFontSize(8); doc.setTextColor(140);
      doc.text('Sfera Multifranquias · Pedido ' + g.numero + ' · ' + loja.nome, M, H - 8);
      doc.text('Página ' + p + ' de ' + pages, W - M, H - 8, { align: 'right' });
    }
    var slug = function slug(t) { return D.normalizarTexto(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); };
    doc.save('Pedido_' + g.numero + '_' + slug(g.nomeFornecedor || 'fornecedor') + '_' + slug(loja.nome) + '.pdf');
  }

  // ───────────── ADMIN: cadastro de itens (todas as lojas) ─────────────
  async function carregarCatalogo() {
    S.catalogoRows = await D.listarTodosItens(S.sb);
    S.catalogo = D.agruparCatalogo(S.catalogoRows);
  }

  async function renderCatalogo() {
    if (!S.catalogo) await carregarCatalogo();
    var cats = ['Todas'].concat(Array.from(new Set(S.catalogo.map(function c(g) { return g.categoria; }))));
    var q = D.normalizarTexto(S.busca);
    var lista = S.catalogo.filter(function f(g) { return (S.categoria === 'Todas' || g.categoria === S.categoria) && (!q || D.normalizarTexto(g.nome + ' ' + (g.fornecedor || '')).includes(q)); });
    $('sup-content').innerHTML = '<div class="sup-card"><div class="sup-card-head"><div class="sup-filters"><div class="sup-search"><i data-lucide="search" class="w-4 h-4"></i><input id="sup-busca" type="search" class="form-input" placeholder="Buscar item ou fornecedor…" value="' + esc(S.busca) + '"></div>' +
      '<div class="sup-chips">' + cats.map(function chip(c) { return '<button type="button" class="sup-chip' + (S.categoria === c ? ' is-active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '<div class="sup-actions"><button type="button" class="sup-btn" data-action="catalogo-excel"><i data-lucide="copy" class="w-4 h-4"></i><span>Copiar para Excel</span></button><button type="button" class="sup-btn sup-btn--primary" data-action="item-novo"><i data-lucide="plus" class="w-4 h-4"></i><span>Novo item</span></button></div></div>' +
      '<p class="sup-hint sup-hint--top">Cadastre um item uma vez e escolha em quais lojas ele entra. Alterar preço, fornecedor ou nome aqui vale para todas as lojas que têm o item.</p>' +
      '<div class="sup-table-scroll"><table class="sup-table sup-table--click"><thead><tr><th>Item</th><th>Categoria</th><th class="sup-center">Und</th><th class="sup-num">Custo unit.</th><th>Fornecedor</th><th class="sup-num">Ideal (mais comum)</th><th class="sup-num">Lojas</th></tr></thead><tbody>' +
      (lista.map(function row(g) {
        return '<tr data-grupo="' + esc(g.chave) + '"><td class="sup-strong">' + esc(g.nome) + '</td><td class="sup-muted">' + esc(g.categoria) + '</td><td class="sup-center sup-muted">' + esc(g.unidade) + '</td><td class="sup-num">' + brl(g.custo) + (g.custoVaria ? '<div class="sup-warn sup-small">varia ' + brl(g.custoMin) + '–' + brl(g.custoMax) + '</div>' : '') + '</td><td class="sup-muted">' + esc(g.fornecedor || '—') + '</td><td class="sup-num">' + num(g.ideal) + '</td><td class="sup-num">' + g.lojas.length + '<span class="sup-muted">/' + S.lojas.length + '</span></td></tr>';
      }).join('') || '<tr><td colspan="7" class="sup-empty">Nenhum item encontrado.</td></tr>') +
      '</tbody></table></div><p class="sup-hint">' + lista.length + ' itens · ' + S.catalogoRows.length + ' cadastros nas lojas</p></div>';
  }

  function seletorLojas(excluir) {
    var marcas = Array.from(new Set(S.lojas.map(function m(l) { return l.marca || 'Sem marca'; })));
    return '<div class="sup-store-select" data-seletor>' +
      '<div class="sup-chips sup-chips--small"><span class="sup-muted">Marcar:</span><button type="button" class="sup-chip" data-sg="*">Todas</button>' +
      marcas.map(function m(x) { return '<button type="button" class="sup-chip" data-sg="m:' + esc(x) + '">' + esc(x) + '</button>'; }).join('') +
      '<button type="button" class="sup-chip" data-sg="vm">Só Suprimentos (fora do VM)</button><button type="button" class="sup-chip" data-sg="-">Nenhuma</button></div>' +
      '<div class="sup-store-grid">' + S.lojas.filter(function f(l) { return !excluir || excluir.indexOf(Number(l.id)) === -1; }).map(function box(l) {
        return '<label class="sup-check"><input type="checkbox" data-lj="' + esc(l.id) + '" data-marca="' + esc(l.marca || 'Sem marca') + '" data-vm="' + (l.usa_vm === false ? '0' : '1') + '"> ' + esc(l.nome) + '</label>';
      }).join('') + '</div><span class="sup-muted sup-small" data-cnt></span></div>';
  }

  function ligarSeletor(root) {
    var el = root.querySelector('[data-seletor]');
    if (!el) return function none() { return []; };
    var boxes = function b() { return Array.from(el.querySelectorAll('[data-lj]')); };
    var cnt = function c() { el.querySelector('[data-cnt]').textContent = boxes().filter(function x(b) { return b.checked; }).length + ' lojas marcadas'; };
    el.addEventListener('click', function click(ev) {
      var c = ev.target.closest('[data-sg]');
      if (!c) return;
      var g = c.dataset.sg;
      boxes().forEach(function each(b) {
        if (g === '-') b.checked = false;
        else if (g === '*') b.checked = true;
        else if (g === 'vm') { if (b.dataset.vm === '0') b.checked = true; }
        else if (g.indexOf('m:') === 0 && b.dataset.marca === g.slice(2)) b.checked = true;
      });
      cnt();
    });
    el.addEventListener('change', cnt);
    cnt();
    return function marcadas() { return boxes().filter(function x(b) { return b.checked; }).map(function id(b) { return Number(b.dataset.lj); }); };
  }

  function camposItem(base, comIdeal) {
    var cats = Array.from(new Set(((S.catalogo || []).map(function c(g) { return g.categoria; })).concat(CATEGORIAS_PADRAO)));
    return '<datalist id="sup-cats">' + cats.map(function o(c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist>' +
      '<div class="sup-grid4"><label class="sup-field sup-span2"><span>Item</span><input id="sup-it-nome" class="form-input" maxlength="120" value="' + esc(base.nome) + '" placeholder="Ex.: Detergente 500ML"></label>' +
      '<label class="sup-field"><span>Categoria</span><input id="sup-it-cat" class="form-input" list="sup-cats" value="' + esc(base.categoria) + '"></label>' +
      '<label class="sup-field"><span>Und</span><input id="sup-it-und" class="form-input" maxlength="10" value="' + esc(base.unidade) + '"></label>' +
      '<label class="sup-field"><span>Custo unitário (R$)</span><input id="sup-it-custo" class="form-input" inputmode="decimal" value="' + esc(decimalBR(base.custo)) + '"></label>' +
      '<label class="sup-field sup-span2"><span>Fornecedor</span><input id="sup-it-forn" class="form-input" maxlength="80" value="' + esc(base.fornecedor || '') + '"></label>' +
      (comIdeal ? '<label class="sup-field"><span>Estoque ideal</span><input id="sup-it-ideal" class="form-input" inputmode="decimal" value="' + esc(decimalBR(base.ideal)) + '" placeholder="Ex.: 2"></label>' : '') +
      '</div>';
  }

  function lerCamposItem() {
    var custo = D.parseNumero($('sup-it-custo').value);
    return {
      nome: $('sup-it-nome').value.trim(),
      categoria: $('sup-it-cat').value.trim() || 'Geral',
      unidade: ($('sup-it-und').value.trim() || 'UN').toUpperCase(),
      custo_unitario: isNaN(custo) || custo <= 0 ? null : custo,
      fornecedor: $('sup-it-forn').value.trim() || null,
    };
  }

  async function aposAlterarItens(msg) {
    fecharModal();
    toast(msg);
    S.catalogo = null;
    S.resumo = null;
    if (S.lojaDetalhe) S.itens = await D.listarItensDaLoja(S.sb, S.lojaDetalhe);
    renderAba();
  }

  function novoItemCatalogo(lojaFixa) {
    var modal = abrirModal('Novo item',
      camposItem({ nome: '', categoria: 'Limpeza', unidade: 'UN', custo: null, fornecedor: '', ideal: '' }, true) +
      (lojaFixa ? '<p class="sup-muted">O item será cadastrado em ' + esc(lojaNome(lojaFixa)) + '.</p>' : '<div class="sup-field"><span>Em quais lojas este item entra?</span>' + seletorLojas(null) + '</div>'),
      '<button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-it-ok">Cadastrar</button>', true);
    var marcadas = lojaFixa ? function fixa() { return [Number(lojaFixa)]; } : ligarSeletor(modal);
    $('sup-it-ok').addEventListener('click', async function salvar(ev) {
      var b = ev.currentTarget;
      var base = lerCamposItem();
      var ideal = D.parseNumero($('sup-it-ideal').value);
      var lojas = marcadas();
      if (!base.nome) return toast('Informe o nome do item.');
      if (isNaN(ideal) || ideal < 0) return toast('Informe o estoque ideal.');
      if (!lojas.length) return toast('Marque pelo menos uma loja.');
      b.disabled = true;
      try {
        if (!S.catalogoRows) await carregarCatalogo();
        var chave = D.normalizarTexto(base.nome);
        var ja = S.catalogoRows.filter(function f(r) { return D.normalizarTexto(r.nome) === chave; }).map(function s(r) { return Number(r.store_id); });
        var alvo = lojas.filter(function f(l) { return ja.indexOf(l) === -1; });
        if (!alvo.length) { b.disabled = false; return toast('As lojas marcadas já têm esse item.'); }
        await D.inserirItens(S.sb, alvo.map(function row(l) { return Object.assign({}, base, { store_id: l, estoque_ideal: ideal, ativo: true }); }));
        await aposAlterarItens('Item cadastrado em ' + alvo.length + (alvo.length === 1 ? ' loja' : ' lojas') + (lojas.length > alvo.length ? ' (' + (lojas.length - alvo.length) + ' já tinham)' : ''));
      } catch (e) {
        b.disabled = false;
        erro(e, /duplicate|unique/i.test(e && e.message) ? 'Alguma loja já tem um item com esse nome.' : null);
      }
    });
  }

  function editarItemCatalogo(g) {
    var rows = g.linhas.slice().sort(function s(a, b) { return lojaNome(a.store_id).localeCompare(lojaNome(b.store_id), 'pt-BR'); });
    var modal = abrirModal('Editar item · em ' + g.lojas.length + (g.lojas.length === 1 ? ' loja' : ' lojas'),
      camposItem({ nome: g.nome, categoria: g.categoria, unidade: g.unidade, custo: g.custo, fornecedor: g.fornecedor }, false) +
      (g.custoVaria ? '<div class="sup-banner sup-banner--warn">O custo hoje varia entre as lojas (' + brl(g.custoMin) + ' a ' + brl(g.custoMax) + '). Ao salvar, todas passam a usar o custo informado acima.</div>' : '') +
      '<details class="sup-details"><summary>Lojas com este item e estoque ideal de cada uma</summary><div class="sup-table-scroll sup-table-scroll--modal"><table class="sup-table"><thead><tr><th>Loja</th><th class="sup-num">Estoque ideal</th><th class="sup-center">Ativo</th><th></th></tr></thead><tbody>' +
      rows.map(function r(x) { return '<tr data-r="' + esc(x.id) + '"><td>' + esc(lojaNome(x.store_id)) + '</td><td class="sup-num"><input class="form-input sup-qty" data-ideal value="' + esc(decimalBR(x.estoque_ideal)) + '"></td><td class="sup-center"><input type="checkbox" data-ativo' + (x.ativo !== false ? ' checked' : '') + '></td><td class="sup-num"><button type="button" class="sup-link" data-rm>Remover</button></td></tr>'; }).join('') +
      '</tbody></table></div></details>' +
      '<details class="sup-details"><summary>Adicionar em mais lojas</summary><label class="sup-field sup-field--narrow"><span>Estoque ideal nessas lojas</span><input id="sup-it-ideal2" class="form-input" inputmode="decimal" value="' + esc(decimalBR(g.ideal)) + '"></label>' + seletorLojas(g.lojas) + '</details>',
      '<button type="button" class="sup-btn sup-btn--danger" id="sup-it-del">Excluir de todas as lojas</button><span class="sup-spacer"></span><button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-it-ok">Salvar</button>', true);
    var marcadas = ligarSeletor(modal);
    var removidos = {};
    modal.querySelectorAll('[data-rm]').forEach(function rm(btn) {
      btn.addEventListener('click', function toggle() {
        var tr = btn.closest('tr');
        var id = tr.dataset.r;
        removidos[id] = !removidos[id];
        tr.classList.toggle('sup-row--off', removidos[id]);
        btn.textContent = removidos[id] ? 'Desfazer' : 'Remover';
      });
    });
    $('sup-it-ok').addEventListener('click', async function salvar(ev) {
      var b = ev.currentTarget;
      var base = lerCamposItem();
      if (!base.nome) return toast('Informe o nome do item.');
      var idsGrupo = rows.map(function i(r) { return r.id; });
      var chave = D.normalizarTexto(base.nome);
      var conflito = S.catalogoRows.filter(function f(r) { return g.lojas.indexOf(Number(r.store_id)) !== -1 && D.normalizarTexto(r.nome) === chave && idsGrupo.indexOf(r.id) === -1; });
      if (conflito.length) return toast('Já existe "' + base.nome + '" em: ' + conflito.slice(0, 3).map(function n(r) { return lojaNome(r.store_id); }).join(', '));
      var novas = marcadas();
      var ideal2 = D.parseNumero($('sup-it-ideal2').value);
      if (novas.length && (isNaN(ideal2) || ideal2 < 0)) return toast('Informe o estoque ideal para as novas lojas.');
      b.disabled = true;
      try {
        var manter = rows.filter(function f(r) { return !removidos[r.id]; });
        await D.atualizarItens(S.sb, manter.map(function i(r) { return r.id; }), base);
        for (var k = 0; k < manter.length; k++) {
          var r = manter[k];
          var tr = modal.querySelector('tr[data-r="' + CSS.escape(r.id) + '"]');
          var iv = D.parseNumero(tr.querySelector('[data-ideal]').value);
          var at = tr.querySelector('[data-ativo]').checked;
          var mud = {};
          if (!isNaN(iv) && iv >= 0 && iv !== Number(r.estoque_ideal)) mud.estoque_ideal = iv;
          if (at !== (r.ativo !== false)) mud.ativo = at;
          if (Object.keys(mud).length) await D.atualizarItens(S.sb, [r.id], mud);
        }
        var rem = Object.keys(removidos).filter(function f(id) { return removidos[id]; });
        if (rem.length) await D.excluirItens(S.sb, rem);
        if (novas.length) await D.inserirItens(S.sb, novas.map(function n(l) { return Object.assign({}, base, { store_id: l, estoque_ideal: ideal2, ativo: true }); }));
        await aposAlterarItens('Item atualizado em ' + manter.length + (manter.length === 1 ? ' loja' : ' lojas') + (novas.length ? ', incluído em mais ' + novas.length : '') + (rem.length ? ', removido de ' + rem.length : ''));
      } catch (e) {
        b.disabled = false;
        erro(e, /duplicate|unique/i.test(e && e.message) ? 'Alguma loja já tem um item com esse nome.' : null);
      }
    });
    $('sup-it-del').addEventListener('click', async function del(ev) {
      var b = ev.currentTarget;
      if (!b.dataset.confirm) {
        b.dataset.confirm = '1';
        b.textContent = 'Confirmar: excluir de ' + g.lojas.length + ' lojas';
        return;
      }
      b.disabled = true;
      try {
        await D.excluirItens(S.sb, rows.map(function i(r) { return r.id; }));
        await aposAlterarItens('Item excluído de ' + g.lojas.length + ' lojas');
      } catch (e) { b.disabled = false; erro(e); }
    });
  }

  function copiarCatalogo() {
    var q = D.normalizarTexto(S.busca);
    var lista = S.catalogo.filter(function f(g) { return (S.categoria === 'Todas' || g.categoria === S.categoria) && (!q || D.normalizarTexto(g.nome + ' ' + (g.fornecedor || '')).includes(q)); });
    var linhas = ['Item\tCategoria\tUnd\tCusto unit.\tFornecedor\tIdeal\tLojas'].concat(lista.map(function l(g) {
      return [g.nome, g.categoria, g.unidade, decimalBR(g.custo), g.fornecedor || '', decimalBR(g.ideal), g.lojas.length].join('\t');
    }));
    copiarTexto(linhas.join('\n'), lista.length + ' itens copiados. Cole no Excel.');
  }

  // ───────────── ADMIN: lojas ─────────────
  async function carregarResumo() {
    var res = await Promise.all([D.listarTodosItens(S.sb), D.listarContagens(S.sb), D.listarSolicitacoes(S.sb, null)]);
    var R = {};
    S.lojas.forEach(function init(l) { R[l.id] = { itens: 0, contados: 0, compra: 0, ult: null, pend: 0 }; });
    var cont = {};
    res[1].forEach(function c(x) { cont[x.store_id] = x; if (R[x.store_id]) R[x.store_id].ult = x.atualizado_em; });
    res[0].forEach(function i(item) {
      var r = R[item.store_id];
      if (!r || item.ativo === false) return;
      r.itens++;
      var calc = D.calcularPedidoLinha(item, ((cont[item.store_id] || {}).valores || {})[item.id]);
      if (calc.compra > 0) r.contados++;
      r.compra += calc.total;
    });
    res[2].forEach(function s(x) { if (R[x.store_id] && x.status === 'pendente') R[x.store_id].pend++; });
    S.resumo = R;
  }

  async function renderLojasAdmin() {
    if (!S.resumo) await carregarResumo();
    var R = S.resumo;
    var q = D.normalizarTexto(S.busca);
    var lista = S.lojas.filter(function f(l) { return !q || D.normalizarTexto(l.nome + ' ' + (l.codigo || '') + ' ' + (l.marca || '')).includes(q); });
    var semLista = S.lojas.filter(function f(l) { return !(R[l.id] || {}).itens; }).length;
    $('sup-content').innerHTML = '<div class="sup-card"><div class="sup-card-head"><div class="sup-filters"><div class="sup-search"><i data-lucide="search" class="w-4 h-4"></i><input id="sup-busca" type="search" class="form-input" placeholder="Buscar loja, código ou marca…" value="' + esc(S.busca) + '"></div></div>' +
      '<div class="sup-actions"><span class="sup-muted">' + (semLista ? semLista + ' lojas sem lista de itens' : 'Todas as lojas têm lista') + '</span><button type="button" class="sup-btn" data-action="atualizar-lojas"><i data-lucide="refresh-cw" class="w-4 h-4"></i><span>Atualizar</span></button></div></div>' +
      '<div class="sup-table-scroll"><table class="sup-table sup-table--click"><thead><tr><th>Loja</th><th>Marca</th><th>Acesso</th><th class="sup-num">Itens</th><th>Último rascunho</th><th class="sup-num">Itens no rascunho</th><th class="sup-num">Valor do rascunho</th><th class="sup-num">Pendentes</th></tr></thead><tbody>' +
      lista.map(function row(l) {
        var r = R[l.id] || {};
        return '<tr data-loja="' + esc(l.id) + '"><td><b class="sup-strong">' + esc(l.nome) + '</b> <span class="sup-muted sup-small">' + esc(l.codigo || '') + '</span></td><td class="sup-muted">' + esc(l.marca || '') + '</td><td>' + (l.usa_vm === false ? '<span class="sup-pill sup-pill--info">Só Suprimentos</span>' : '<span class="sup-muted sup-small">VM + Suprimentos</span>') + '</td>' +
          '<td class="sup-num">' + (r.itens ? r.itens : '<span class="sup-pill sup-pill--warn">sem lista</span>') + '</td><td>' + (r.ult ? dataHora(r.ult) : '<span class="sup-muted">nunca</span>') + '</td><td class="sup-num">' + (r.itens ? r.contados + '/' + r.itens : '—') + '</td><td class="sup-num">' + (r.compra ? brl(r.compra) : '—') + '</td><td class="sup-num">' + (r.pend ? '<span class="sup-pill sup-pill--warn">' + r.pend + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  async function abrirLojaDetalhe(id) {
    S.lojaDetalhe = Number(id);
    S.lojaId = Number(id);
    S.busca = '';
    S.categoria = 'Todas';
    await carregarLoja();
    renderAba();
  }

  function renderLojaDetalhe() {
    var lista = S.itens.slice().filter(function f(i) {
      var q = D.normalizarTexto(S.busca);
      return (S.categoria === 'Todas' || i.categoria === S.categoria) && (!q || D.normalizarTexto(i.nome).includes(q));
    }).sort(function s(a, b) { return String(a.categoria).localeCompare(String(b.categoria), 'pt-BR') || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    var valores = S.contagem.valores || {};
    $('sup-content').innerHTML = '<div class="sup-card"><div class="sup-card-head"><div class="sup-title-row"><button type="button" class="sup-btn" data-action="voltar-lojas"><i data-lucide="arrow-left" class="w-4 h-4"></i><span>Lojas</span></button><h3 class="sup-h3">' + esc(lojaNome(S.lojaDetalhe)) + '</h3></div>' +
      '<div class="sup-actions"><button type="button" class="sup-btn" data-action="copiar-de-loja"><i data-lucide="copy-plus" class="w-4 h-4"></i><span>Copiar lista de outra loja</span></button><button type="button" class="sup-btn" data-action="colar-excel"><i data-lucide="clipboard-paste" class="w-4 h-4"></i><span>Colar lista do Excel</span></button><button type="button" class="sup-btn sup-btn--primary" data-action="item-novo-loja"><i data-lucide="plus" class="w-4 h-4"></i><span>Novo item</span></button></div></div>' +
      filtrosItens() +
      '<div class="sup-table-scroll"><table class="sup-table sup-table--click"><thead><tr><th>Item</th><th>Categoria</th><th class="sup-center">Und</th><th class="sup-num">Estoque ideal</th><th class="sup-num">Último físico</th><th class="sup-num">Custo unit.</th><th>Fornecedor</th><th class="sup-center">Ativo</th></tr></thead><tbody>' +
      (lista.map(function row(i) {
        return '<tr data-item="' + esc(i.id) + '"><td class="sup-strong">' + esc(i.nome) + '</td><td class="sup-muted">' + esc(i.categoria) + '</td><td class="sup-center sup-muted">' + esc(i.unidade) + '</td><td class="sup-num">' + num(i.estoque_ideal) + '</td><td class="sup-num">' + (valores[i.id] !== undefined ? num(valores[i.id]) : '<span class="sup-muted">—</span>') + '</td><td class="sup-num">' + brl(i.custo_unitario) + '</td><td class="sup-muted">' + esc(i.fornecedor || '') + '</td><td class="sup-center">' + (i.ativo === false ? '<span class="sup-pill">inativo</span>' : '<span class="sup-ok">ativo</span>') + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="sup-empty">Nenhum item. Use "Colar lista do Excel" ou "Copiar lista de outra loja".</td></tr>') +
      '</tbody></table></div><div class="sup-subcard"><h4 class="sup-h4">Solicitações desta loja</h4>' + listaSolicitacoes(S.sols, false) + '</div></div>';
  }

  function editarItemLoja(id) {
    var it = S.itens.find(function f(i) { return i.id === id; });
    if (!it) return;
    abrirModal('Editar item · ' + lojaNome(it.store_id),
      camposItem({ nome: it.nome, categoria: it.categoria, unidade: it.unidade, custo: it.custo_unitario, fornecedor: it.fornecedor, ideal: it.estoque_ideal }, true) +
      '<label class="sup-check"><input type="checkbox" id="sup-it-ativo"' + (it.ativo !== false ? ' checked' : '') + '> Item ativo (aparece na contagem da loja)</label>',
      '<button type="button" class="sup-btn sup-btn--danger" id="sup-it-del">Excluir</button><span class="sup-spacer"></span><button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-it-ok">Salvar</button>');
    $('sup-it-ok').addEventListener('click', async function salvar(ev) {
      var base = lerCamposItem();
      var ideal = D.parseNumero($('sup-it-ideal').value);
      if (!base.nome || isNaN(ideal) || ideal < 0) return toast('Informe o nome e um estoque ideal válido.');
      ev.currentTarget.disabled = true;
      try {
        await D.atualizarItens(S.sb, [id], Object.assign(base, { estoque_ideal: ideal, ativo: $('sup-it-ativo').checked }));
        await aposAlterarItens('Item salvo');
      } catch (e) { ev.currentTarget.disabled = false; erro(e, /duplicate|unique/i.test(e && e.message) ? 'Já existe um item com esse nome nesta loja.' : null); }
    });
    $('sup-it-del').addEventListener('click', async function del(ev) {
      var b = ev.currentTarget;
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Confirmar exclusão'; return; }
      b.disabled = true;
      try { await D.excluirItens(S.sb, [id]); await aposAlterarItens('Item excluído'); } catch (e) { b.disabled = false; erro(e); }
    });
  }

  async function importarParaLoja(linhas, botao) {
    var existentes = {};
    S.itens.forEach(function e(i) { existentes[D.normalizarTexto(i.nome)] = i; });
    var novos = [];
    var n = 0;
    for (var k = 0; k < linhas.length; k++) {
      var l = linhas[k];
      var ex = existentes[D.normalizarTexto(l.nome)];
      var body = { nome: l.nome, categoria: l.categoria, unidade: l.unidade, estoque_ideal: l.estoque_ideal, custo_unitario: l.custo_unitario, fornecedor: l.fornecedor, ativo: true };
      if (ex) { await D.atualizarItens(S.sb, [ex.id], body); n++; botao.textContent = 'Importando ' + n + '…'; }
      else novos.push(Object.assign(body, { store_id: S.lojaDetalhe }));
    }
    if (novos.length) await D.inserirItens(S.sb, novos);
    await aposAlterarItens((n + novos.length) + ' itens importados (' + novos.length + ' novos, ' + n + ' atualizados)');
  }

  function colarExcel() {
    abrirModal('Colar lista do Excel · ' + lojaNome(S.lojaDetalhe),
      '<p class="sup-muted">Copie no Excel as colunas nesta ordem: <b>Item · Categoria · Und · Estoque ideal · Custo unitário · Fornecedor</b> e cole abaixo. Itens com o mesmo nome são atualizados; os novos são cadastrados.</p>' +
      '<textarea id="sup-colar" class="form-input sup-mono" rows="10"></textarea><p id="sup-colar-prev" class="sup-muted sup-small"></p>',
      '<button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-colar-ok" disabled>Importar</button>', true);
    var linhas = [];
    $('sup-colar').addEventListener('input', function ler(ev) {
      linhas = D.lerColagemExcel(ev.target.value);
      $('sup-colar-prev').textContent = linhas.length ? linhas.length + ' itens prontos para importar' : '';
      $('sup-colar-ok').disabled = !linhas.length;
    });
    $('sup-colar-ok').addEventListener('click', async function ok(ev) {
      var b = ev.currentTarget;
      b.disabled = true;
      try { await importarParaLoja(linhas, b); } catch (e) { b.disabled = false; erro(e); }
    });
  }

  async function copiarDeOutraLoja() {
    if (!S.resumo) await carregarResumo();
    var outras = S.lojas.filter(function f(l) { return Number(l.id) !== S.lojaDetalhe && (S.resumo[l.id] || {}).itens; });
    abrirModal('Copiar lista de outra loja',
      '<p class="sup-muted">Traz os itens, o estoque ideal, o custo e o fornecedor da loja escolhida. Itens que já existem aqui são atualizados.</p>' +
      '<label class="sup-field"><span>Loja de origem</span><select id="sup-copiar-loja" class="form-select">' + outras.map(function o(l) { return '<option value="' + esc(l.id) + '">' + esc(l.nome) + ' · ' + S.resumo[l.id].itens + ' itens</option>'; }).join('') + '</select></label>',
      '<button type="button" class="sup-btn" data-sup-close>Cancelar</button><button type="button" class="sup-btn sup-btn--primary" id="sup-copiar-ok"' + (outras.length ? '' : ' disabled') + '>Copiar itens</button>');
    $('sup-copiar-ok').addEventListener('click', async function ok(ev) {
      var b = ev.currentTarget;
      b.disabled = true;
      try {
        var origem = await D.listarItensDaLoja(S.sb, Number($('sup-copiar-loja').value));
        await importarParaLoja(origem.filter(function a(i) { return i.ativo !== false; }).map(function m(i) {
          return { nome: i.nome, categoria: i.categoria, unidade: i.unidade, estoque_ideal: Number(i.estoque_ideal), custo_unitario: i.custo_unitario, fornecedor: i.fornecedor };
        }), b);
      } catch (e) { b.disabled = false; erro(e); }
    });
  }

  // ───────────── eventos delegados ─────────────
  async function onContentClick(ev) {
    var t = ev.target;
    var cat = t.closest('[data-cat]');
    if (cat) { S.categoria = cat.dataset.cat; return renderAba(); }
    var st = t.closest('[data-status]');
    if (st) { S.filtroStatus = st.dataset.status; return renderAba(); }
    var sol = t.closest('tr[data-sol]');
    if (sol) {
      var s = S.sols.find(function f(x) { return x.id === sol.dataset.sol; });
      if (s) return S.admin ? verSolicitacaoAdmin(s) : verSolicitacaoLoja(s);
    }
    var grupo = t.closest('tr[data-grupo]');
    if (grupo) {
      var g = S.catalogo.find(function f(x) { return x.chave === grupo.dataset.grupo; });
      if (g) return editarItemCatalogo(g);
    }
    var lj = t.closest('tr[data-loja]');
    if (lj) return abrirLojaDetalhe(lj.dataset.loja);
    var it = t.closest('tr[data-item]');
    if (it) return editarItemLoja(it.dataset.item);
    var act = t.closest('[data-action]');
    if (!act) return;
    var a = act.dataset.action;
    if (a === 'abrir-envio') return abrirEnvio();
    if (a === 'novo-pedido-loja') return irParaAba('contagem');
    if (a === 'voltar-pedidos') return irParaAba('solicitacoes');
    if (a === 'consolidado') return copiarConsolidado();
    if (a === 'item-novo') return novoItemCatalogo(null);
    if (a === 'item-novo-loja') return novoItemCatalogo(S.lojaDetalhe);
    if (a === 'catalogo-excel') return copiarCatalogo();
    if (a === 'atualizar-lojas') { S.resumo = null; return renderAba(); }
    if (a === 'voltar-lojas') { S.lojaDetalhe = null; S.busca = ''; S.categoria = 'Todas'; return renderAba(); }
    if (a === 'colar-excel') return colarExcel();
    if (a === 'copiar-de-loja') return copiarDeOutraLoja();
  }

  function onContentInput(ev) {
    var t = ev.target;
    if (t.id === 'sup-busca') {
      S.busca = t.value;
      var pos = t.selectionStart;
      renderAba().then(function refocus() {
        var nb = $('sup-busca');
        if (nb) { nb.focus(); nb.setSelectionRange(pos, pos); }
      });
      return;
    }
    if (t.dataset && t.dataset.fisico) {
      var v = t.value.trim();
      var n = D.parseNumero(v);
      S.local[t.dataset.fisico] = v === '' ? '' : (isNaN(n) || n < 0 ? '' : n);
      atualizarLinha(t.dataset.fisico);
      agendarSalvar();
    }
  }

  function onContentChange(ev) {
    if (ev.target.id === 'sup-filtro-loja') {
      S.filtroLoja = ev.target.value;
      renderAba();
    }
  }

  global.SuppliesModule = {
    afterRenderSuprimentos: afterRenderSuprimentos,
    beforeLeave: beforeLeave,
  };
})(window);
