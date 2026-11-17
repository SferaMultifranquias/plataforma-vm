(function initSuppliesDataModule(global) {
  var PAGE_SIZE = 1000;

  // ───────────── Regras puras (testadas em tests/frontend/supplies.test.js) ─────────────
  function parseNumero(valor) {
    if (valor === '' || valor === null || valor === undefined) return NaN;
    var texto = String(valor).trim().replace(/R\$\s*/i, '');
    if (!texto) return NaN;
    return texto.includes(',') ? parseFloat(texto.replace(/\./g, '').replace(',', '.')) : parseFloat(texto);
  }

  function normalizarTexto(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function calcularLinha(item, fisico) {
    var ideal = Number(item.estoque_ideal) || 0;
    var custo = item.custo_unitario === null || item.custo_unitario === undefined ? null : Number(item.custo_unitario);
    var contado = fisico !== null && fisico !== undefined && fisico !== '' && !isNaN(Number(fisico));
    var qtdFisica = contado ? Number(fisico) : null;
    var compra = contado ? Math.max(0, Math.round((ideal - qtdFisica) * 100) / 100) : 0;
    return {
      ideal: ideal,
      fisico: qtdFisica,
      contado: contado,
      compra: compra,
      custo: custo,
      total: custo !== null && compra > 0 ? Math.round(custo * compra * 100) / 100 : 0,
    };
  }

  function montarSolicitacao(itens, valores) {
    var linhas = [];
    var total = 0;
    (itens || []).forEach(function eachItem(item) {
      if (item.ativo === false) return;
      var calc = calcularLinha(item, valores ? valores[item.id] : null);
      if (calc.compra <= 0) return;
      total += calc.total;
      linhas.push({
        item: item.id,
        nome: item.nome,
        categoria: item.categoria,
        und: item.unidade,
        fornecedor: item.fornecedor || null,
        ideal: calc.ideal,
        fisico: calc.fisico,
        compra: calc.compra,
        custo: calc.custo,
      });
    });
    return { itens: linhas, total: Math.round(total * 100) / 100 };
  }

  function moda(valores) {
    var contagem = {};
    var melhor = null;
    var max = 0;
    valores.forEach(function eachValue(valor) {
      if (valor === null || valor === undefined || valor === '') return;
      var chave = String(valor);
      contagem[chave] = (contagem[chave] || 0) + 1;
      if (contagem[chave] > max) {
        max = contagem[chave];
        melhor = valor;
      }
    });
    return melhor;
  }

  // Agrupa os itens de todas as lojas pelo nome, para o cadastro central.
  function agruparCatalogo(linhas) {
    var grupos = {};
    (linhas || []).forEach(function eachRow(linha) {
      var chave = normalizarTexto(linha.nome);
      if (!grupos[chave]) grupos[chave] = { chave: chave, linhas: [] };
      grupos[chave].linhas.push(linha);
    });
    return Object.keys(grupos).map(function mapGroup(chave) {
      var grupo = grupos[chave];
      var rows = grupo.linhas;
      var custos = [];
      rows.forEach(function eachCost(r) {
        if (r.custo_unitario !== null && r.custo_unitario !== undefined) {
          var c = Number(r.custo_unitario);
          if (custos.indexOf(c) === -1) custos.push(c);
        }
      });
      var lojas = {};
      rows.forEach(function eachStore(r) { lojas[r.store_id] = true; });
      return {
        chave: chave,
        linhas: rows,
        nome: moda(rows.map(function n(r) { return r.nome; })),
        categoria: moda(rows.map(function c(r) { return r.categoria; })) || 'Geral',
        unidade: moda(rows.map(function u(r) { return r.unidade; })) || 'UN',
        custo: moda(rows.map(function k(r) { return r.custo_unitario === null || r.custo_unitario === undefined ? null : Number(r.custo_unitario); })),
        custoVaria: custos.length > 1,
        custoMin: custos.length ? Math.min.apply(null, custos) : null,
        custoMax: custos.length ? Math.max.apply(null, custos) : null,
        fornecedor: moda(rows.map(function f(r) { return r.fornecedor; })),
        ideal: moda(rows.map(function i(r) { return Number(r.estoque_ideal); })),
        lojas: Object.keys(lojas).map(Number),
      };
    }).sort(function sortGroups(a, b) {
      return String(a.categoria).localeCompare(String(b.categoria), 'pt-BR') || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
  }

  // Separa os itens de uma solicitação por fornecedor (um pedido/PDF para cada).
  function separarPorFornecedor(solicitacao, fornecedorPorItem) {
    var SEM = 'Sem fornecedor definido';
    var mapa = fornecedorPorItem || {};
    var grupos = [];
    (solicitacao.itens || []).forEach(function eachLine(linha, indice) {
      var qtd = Number(linha.compra) || 0;
      if (qtd <= 0) return;
      var fornecedor = String(linha.fornecedor || mapa[linha.item] || '').trim() || SEM;
      var grupo = grupos.find(function findGroup(g) { return g.fornecedor === fornecedor; });
      if (!grupo) {
        grupo = { fornecedor: fornecedor, linhas: [] };
        grupos.push(grupo);
      }
      grupo.linhas.push({
        chave: indice,
        nome: linha.nome,
        und: linha.und || '',
        qtd: qtd,
        custo: linha.custo === null || linha.custo === undefined ? null : Number(linha.custo),
        incluir: true,
      });
    });
    grupos.sort(function sortSup(a, b) {
      return (a.fornecedor === SEM) - (b.fornecedor === SEM) || a.fornecedor.localeCompare(b.fornecedor, 'pt-BR');
    });
    grupos.forEach(function number(g, i) {
      g.numero = grupos.length > 1 ? solicitacao.numero + '-' + (i + 1) : solicitacao.numero;
      g.nomeFornecedor = g.fornecedor === SEM ? '' : g.fornecedor;
    });
    return grupos;
  }

  // Lê linhas coladas do Excel: Item · Categoria · Und · Estoque ideal · Custo · Fornecedor
  function lerColagemExcel(texto) {
    return String(texto || '').split(/\r?\n/).map(function splitLine(linha) {
      return linha.split('\t').map(function trim(c) { return c.trim(); });
    }).filter(function hasName(c) {
      return c[0] && !/^item$/i.test(c[0]);
    }).map(function toItem(c) {
      var custo = parseNumero(c[4]);
      return {
        nome: c[0],
        categoria: c[1] || 'Geral',
        unidade: (c[2] || 'UN').toUpperCase(),
        estoque_ideal: parseNumero(c[3]),
        custo_unitario: isNaN(custo) || custo <= 0 ? null : custo,
        fornecedor: c[5] || null,
      };
    }).filter(function validIdeal(i) {
      return !isNaN(i.estoque_ideal) && i.estoque_ideal >= 0;
    });
  }

  // ───────────── Acesso a dados (Supabase com RLS) ─────────────
  function check(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  async function paginar(montarConsulta) {
    var todos = [];
    for (var inicio = 0; ; inicio += PAGE_SIZE) {
      var lote = check(await montarConsulta().range(inicio, inicio + PAGE_SIZE - 1)) || [];
      todos = todos.concat(lote);
      if (lote.length < PAGE_SIZE) break;
    }
    return todos;
  }

  async function listarLojas(sb, usuario) {
    if (usuario && usuario.papel === 'admin') {
      return check(await sb.from('lojas').select('id,codigo,nome,marca,ativo,usa_vm,centro_custo').eq('ativo', true).order('nome')) || [];
    }
    var vinculos = check(await sb.from('user_stores').select('store_id').eq('user_id', usuario.id)) || [];
    var ids = vinculos.map(function id(v) { return v.store_id; });
    if (!ids.length) return [];
    return check(await sb.from('lojas').select('id,codigo,nome,marca,ativo,usa_vm,centro_custo').in('id', ids).eq('ativo', true).order('nome')) || [];
  }

  async function listarItensDaLoja(sb, storeId) {
    return check(await sb.from('sup_itens').select('*').eq('store_id', storeId).order('nome')) || [];
  }

  async function listarTodosItens(sb) {
    return paginar(function query() {
      return sb.from('sup_itens').select('*').order('id');
    });
  }

  async function carregarContagem(sb, storeId) {
    var linhas = check(await sb.from('sup_contagens').select('*').eq('store_id', storeId)) || [];
    return linhas[0] || { store_id: storeId, valores: {}, atualizado_em: null };
  }

  async function listarContagens(sb) {
    return check(await sb.from('sup_contagens').select('store_id,valores,atualizado_em')) || [];
  }

  async function salvarContagem(sb, storeId, valores) {
    return check(await sb.from('sup_contagens').upsert({ store_id: storeId, valores: valores }, { onConflict: 'store_id' }).select());
  }

  async function listarSolicitacoes(sb, storeId) {
    var consulta = function query() {
      var q = sb.from('sup_solicitacoes').select('*').order('criado_em', { ascending: false });
      return storeId ? q.eq('store_id', storeId) : q;
    };
    return paginar(consulta);
  }

  async function enviarSolicitacao(sb, storeId, montagem, observacao) {
    var linhas = check(await sb.from('sup_solicitacoes').insert({
      store_id: storeId,
      numero: 'auto',
      itens: montagem.itens,
      total: montagem.total,
      observacao: observacao || null,
    }).select());
    return linhas && linhas[0];
  }

  async function responderSolicitacao(sb, id, status, resposta) {
    return check(await sb.from('sup_solicitacoes').update({ status: status, resposta: resposta || null }).eq('id', id).select());
  }

  async function fornecedoresDosItens(sb, ids) {
    if (!ids.length) return {};
    var linhas = check(await sb.from('sup_itens').select('id,fornecedor').in('id', ids)) || [];
    var mapa = {};
    linhas.forEach(function eachRow(r) { mapa[r.id] = r.fornecedor; });
    return mapa;
  }

  async function inserirItens(sb, itens) {
    if (!itens.length) return [];
    return check(await sb.from('sup_itens').insert(itens).select());
  }

  async function atualizarItens(sb, ids, alteracao) {
    if (!ids.length) return [];
    return check(await sb.from('sup_itens').update(alteracao).in('id', ids).select());
  }

  async function excluirItens(sb, ids) {
    if (!ids.length) return [];
    return check(await sb.from('sup_itens').delete().in('id', ids));
  }

  global.SuppliesDataModule = {
    agruparCatalogo: agruparCatalogo,
    atualizarItens: atualizarItens,
    calcularLinha: calcularLinha,
    carregarContagem: carregarContagem,
    enviarSolicitacao: enviarSolicitacao,
    excluirItens: excluirItens,
    fornecedoresDosItens: fornecedoresDosItens,
    inserirItens: inserirItens,
    lerColagemExcel: lerColagemExcel,
    listarContagens: listarContagens,
    listarItensDaLoja: listarItensDaLoja,
    listarLojas: listarLojas,
    listarSolicitacoes: listarSolicitacoes,
    listarTodosItens: listarTodosItens,
    montarSolicitacao: montarSolicitacao,
    normalizarTexto: normalizarTexto,
    parseNumero: parseNumero,
    responderSolicitacao: responderSolicitacao,
    salvarContagem: salvarContagem,
    separarPorFornecedor: separarPorFornecedor,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.SuppliesDataModule;
  }
})(typeof window !== 'undefined' ? window : globalThis);
