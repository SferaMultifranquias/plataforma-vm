(function initSuppliesNoticesModule(global) {
  // Avisos de Suprimentos dentro do sistema (selo com contador no menu lateral).
  // - Sfera (admin): solicitações pendentes de resposta.
  // - Loja: entregas para confirmar + respostas da Sfera desde a última visita à tela "Meus pedidos".
  // A última visita fica guardada neste navegador (localStorage), por usuário.
  var CHAVE_VISITA = 'sup_visto_';
  var INTERVALO_MS = 20000;
  var ultimoCalculo = 0;
  var emAndamento = false;
  var ultimoContexto = null;
  var ouvindo = false;

  function ultimaVisita(userId) {
    try { return global.localStorage.getItem(CHAVE_VISITA + userId); } catch (e) { return null; }
  }

  function marcarVisto(userId) {
    try { global.localStorage.setItem(CHAVE_VISITA + userId, new Date().toISOString()); } catch (e) { /* sem armazenamento: o aviso apenas não some sozinho */ }
  }

  function pintar(id, total, titulo) {
    var el = global.document && global.document.getElementById(id);
    if (!el) return;
    if (total > 0) {
      el.textContent = total > 99 ? '99+' : String(total);
      el.title = titulo || '';
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  async function buscar(sb) {
    var r = await sb.from('sup_solicitacoes').select('id,status,respondido_em,recebido_em').order('criado_em', { ascending: false }).limit(500);
    // Banco ainda sem as colunas de recebimento: conta só o que dá (pendentes e respostas).
    if (r && r.error) r = await sb.from('sup_solicitacoes').select('id,status,respondido_em').order('criado_em', { ascending: false }).limit(500);
    return r && !r.error ? r.data || [] : null;
  }

  async function atualizar(contexto, forcar) {
    if (contexto) ultimoContexto = contexto;
    contexto = ultimoContexto;
    if (!contexto || emAndamento) return;
    if (!forcar && Date.now() - ultimoCalculo < INTERVALO_MS) return;
    var D = global.SuppliesDataModule;
    var usuario = contexto.getCurrentUser && contexto.getCurrentUser();
    if (!usuario || !D) return;
    emAndamento = true;
    try {
      var sb = await Promise.resolve(contexto.getSb());
      if (!sb) return;
      var linhas = await buscar(sb);
      if (!linhas) return;
      ultimoCalculo = Date.now();
      if (usuario.papel === 'admin') {
        var pend = D.contarAvisosAdmin(linhas);
        pintar('badge-sup-solicitacoes', pend, pend + (pend === 1 ? ' solicitação pendente' : ' solicitações pendentes'));
        pintar('badge-sup-minhas', 0);
      } else {
        var av = D.contarAvisosLoja(linhas, ultimaVisita(usuario.id));
        var partes = [];
        if (av.confirmar) partes.push(av.confirmar + (av.confirmar === 1 ? ' entrega para confirmar' : ' entregas para confirmar'));
        if (av.respostas) partes.push(av.respostas + (av.respostas === 1 ? ' resposta nova da Sfera' : ' respostas novas da Sfera'));
        pintar('badge-sup-minhas', av.total, partes.join(' · '));
        pintar('badge-sup-solicitacoes', 0);
      }
    } catch (e) {
      // Aviso é opcional: se falhar, o menu simplesmente fica sem selo.
    } finally {
      emAndamento = false;
    }
  }

  function ouvirMudancas() {
    if (ouvindo || !global.addEventListener) return;
    ouvindo = true;
    global.addEventListener('sup:avisos', function onMudanca() { atualizar(null, true); });
  }
  ouvirMudancas();

  global.SuppliesNoticesModule = {
    atualizar: atualizar,
    marcarVisto: marcarVisto,
    ultimaVisita: ultimaVisita,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SuppliesNoticesModule;
  }
})(typeof window !== 'undefined' ? window : globalThis);
