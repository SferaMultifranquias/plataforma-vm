(function initStoresModule(global) {
  var allStores = [];
  var storeLoadState = 'idle';
  var storeLoadError = null;
  var currentPageDeps = null;
  var modalLojaOpener = null;

  function getAllStores() {
    return allStores.slice();
  }

  function setAllStores(stores) {
    allStores = Array.isArray(stores) ? stores.slice() : [];
  }

  function setStoreLoadState(state, error) {
    storeLoadState = state;
    storeLoadError = error || null;
  }

  function getStoreLoadState() {
    return {
      error: storeLoadError,
      items: getAllStores(),
      status: storeLoadState,
    };
  }

  function normalizeStore(store) {
    return {
      ativo: Boolean(store.ativo),
      cidade: store.cidade || '',
      codigo: store.codigo || '',
      estado: store.estado || '',
      id: store.id,
      marca: store.marca || '',
      nome: store.nome || '',
    };
  }

  function findStoreById(id) {
    return allStores.find(function findStore(item) {
      return String(item.id) === String(id);
    }) || null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getModalLoja() {
    return document.getElementById('modal-loja');
  }

  function getModalLojaPanel() {
    var modal = getModalLoja();
    return modal && typeof modal.querySelector === 'function' ? modal.querySelector('.stores-modal-panel') : null;
  }

  function isModalLojaVisible() {
    var modal = getModalLoja();
    return Boolean(modal && !modal.classList.contains('hidden'));
  }

  function setModalLojaSubtitle(isEdit) {
    var subtitle = document.getElementById('modal-loja-subtitle');
    if (!subtitle) return;
    subtitle.textContent = isEdit
      ? 'Atualize as informações da loja selecionada.'
      : 'Preencha as informações abaixo para cadastrar uma nova loja.';
  }

  function focusModalLojaNameField() {
    var nameField = document.getElementById('fl-nome');
    if (nameField && typeof nameField.focus === 'function') {
      nameField.focus();
    }
  }

  function restoreModalLojaFocus() {
    if (modalLojaOpener && typeof modalLojaOpener.focus === 'function') {
      modalLojaOpener.focus();
    }
    modalLojaOpener = null;
  }

  function getModalLojaFocusables() {
    var panel = getModalLojaPanel();
    if (!panel || typeof panel.querySelectorAll !== 'function') return [];

    return Array.prototype.slice.call(panel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function filterVisible(element) {
      return Boolean(element.offsetParent !== null || element === document.activeElement);
    });
  }

  function onModalLojaKeydown(event) {
    if (!isModalLojaVisible()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      fecharModalLoja();
      return;
    }

    if (event.key !== 'Tab') return;

    var focusables = getModalLojaFocusables();
    if (!focusables.length) return;

    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onModalLojaKeydown);
  }

  function renderTable(list) {
    var tbody = document.getElementById('tbody-lojas');
    if (!tbody) return;

    document.getElementById('lojas-contador').textContent = list.length + ' loja(s) encontrada(s)';
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-8" style="font-size:13px">Nenhuma loja encontrada para os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function mapStore(store) {
      var brandLabel = store.marca || '-';
      var city = store.cidade ? (store.cidade + (store.estado ? '/' + store.estado : '')) : '-';
      var statusLabel = store.ativo ? 'Ativa' : 'Inativa';
      var badgeClass = store.ativo ? 'stores-status-badge stores-status-badge--active' : 'stores-status-badge stores-status-badge--inactive';
      var toggleLabel = store.ativo ? 'Desativar' : 'Ativar';

      return (
        '<tr>' +
          '<td class="text-center font-mono" style="font-size:12px;color:#64748b">' + escapeHtml(store.codigo || '-') + '</td>' +
          '<td class="text-left font-medium">' + escapeHtml(store.nome) + '</td>' +
          '<td class="text-center">' + escapeHtml(brandLabel) + '</td>' +
          '<td class="text-center" style="color:#64748b">' + escapeHtml(city) + '</td>' +
          '<td class="text-center"><span class="' + badgeClass + '">' + statusLabel + '</span></td>' +
          '<td class="text-center">' +
            '<div class="flex items-center justify-center gap-1">' +
              '<button type="button" data-store-action="edit" data-store-id="' + escapeHtml(store.id) + '" class="stores-action stores-action--edit" aria-label="Editar loja">' +
                '<i data-lucide="pencil" class="w-3.5 h-3.5"></i> Editar' +
              '</button>' +
              '<button type="button" data-store-action="toggle" data-store-id="' + escapeHtml(store.id) + '" data-store-active="' + String(store.ativo) + '" class="stores-action stores-action--danger" aria-label="' + toggleLabel + ' loja">' +
                '<i data-lucide="' + (store.ativo ? 'power-off' : 'power') + '" class="w-3.5 h-3.5"></i> ' + toggleLabel +
              '</button>' +
              (store.ativo ? '' : '<button type="button" data-store-action="delete" data-store-id="' + escapeHtml(store.id) + '" class="stores-action stores-action--danger" aria-label="Excluir loja">' +
                '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Excluir' +
              '</button>') +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function bindLojasPageControls() {
    var search = document.getElementById('loja-busca');
    var brand = document.getElementById('loja-filtro-marca');
    var status = document.getElementById('loja-filtro-ativo');
    var createButton = document.getElementById('loja-nova');
    var tbody = document.getElementById('tbody-lojas');

    if (search && !search.dataset.bound) {
      search.addEventListener('input', filtrarLojas);
      search.dataset.bound = 'true';
    }

    if (brand && !brand.dataset.bound) {
      brand.addEventListener('change', filtrarLojas);
      brand.dataset.bound = 'true';
    }

    if (status && !status.dataset.bound) {
      status.addEventListener('change', filtrarLojas);
      status.dataset.bound = 'true';
    }

    if (createButton && !createButton.dataset.bound) {
      createButton.addEventListener('click', function openStoreModal(event) {
        abrirModalLoja(undefined, event && event.currentTarget ? event.currentTarget : createButton);
      });
      createButton.dataset.bound = 'true';
    }

    if (tbody && !tbody.dataset.bound) {
      tbody.addEventListener('click', function handleStoreAction(event) {
        var button = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-store-action]') : null;
        if (!button || !tbody.contains(button)) return;

        var action = button.getAttribute('data-store-action');
        var storeId = button.getAttribute('data-store-id');
        if (action === 'edit') {
          editarLoja(storeId, button);
          return;
        }

        if (action === 'toggle' && currentPageDeps) {
          toggleAtivoLoja(storeId, button.getAttribute('data-store-active') === 'true', currentPageDeps);
          return;
        }

        if (action === 'delete' && currentPageDeps) {
          excluirLoja(storeId, currentPageDeps);
        }
      });
      tbody.dataset.bound = 'true';
    }

    var modalCloseBtn = document.getElementById('modal-loja-close-btn');
    if (modalCloseBtn && !modalCloseBtn.dataset.bound) {
      modalCloseBtn.addEventListener('click', fecharModalLoja);
      modalCloseBtn.dataset.bound = 'true';
    }

    var modalCancelBtn = document.getElementById('modal-loja-cancel-btn');
    if (modalCancelBtn && !modalCancelBtn.dataset.bound) {
      modalCancelBtn.addEventListener('click', fecharModalLoja);
      modalCancelBtn.dataset.bound = 'true';
    }

    var modalSaveBtn = document.getElementById('modal-loja-btn-save');
    if (modalSaveBtn && !modalSaveBtn.dataset.bound) {
      modalSaveBtn.addEventListener('click', function onSaveStore() {
        if (typeof global.salvarLoja === 'function') {
          global.salvarLoja();
        }
      });
      modalSaveBtn.dataset.bound = 'true';
    }
  }

  async function loadStores(deps) {
    var sb = typeof deps.getSb === 'function' ? deps.getSb() : deps.sb;
    if (!sb) throw new Error('Cliente Supabase nao inicializado.');

    setStoreLoadState('loading');
    var result;

    try {
      result = await sb
        .from('lojas')
        .select('id,codigo,nome,marca,ativo,cidade,estado')
        .order('nome');
    } catch (error) {
      setAllStores([]);
      setStoreLoadState('error', error.message);
      throw error;
    }

    if (result.error) {
      setAllStores([]);
      setStoreLoadState('error', result.error.message);
      throw result.error;
    }

    var normalized = (result.data || []).map(normalizeStore);
    setAllStores(normalized);
    setStoreLoadState(normalized.length ? 'loaded' : 'empty');
    return getStoreLoadState();
  }

  async function carregarTabelaLojas(deps) {
    var tbody = document.getElementById('tbody-lojas');
    if (!tbody) return;

    if (deps) {
      currentPageDeps = deps;
    }

    try {
      if (!allStores.length || storeLoadState === 'idle') {
        await loadStores({ getSb: function getSb() { return deps.sb; } });
      }
      renderTable(getAllStores());
    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:#ef4444;padding:24px;font-size:13px">Erro: ' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  async function afterRenderLojasCadastro(deps) {
    currentPageDeps = deps || currentPageDeps;
    bindLojasPageControls();
    return carregarTabelaLojas(deps);
  }

  function filtrarLojas() {
    var busca = ((document.getElementById('loja-busca') || {}).value || '').toLowerCase();
    var marca = ((document.getElementById('loja-filtro-marca') || {}).value || '');
    var ativo = (document.getElementById('loja-filtro-ativo') || {}).value;
    var list = getAllStores();

    if (busca) {
      list = list.filter(function filterBySearch(store) {
        return ((store.nome || '') + (store.codigo || '')).toLowerCase().includes(busca);
      });
    }
    if (marca) {
      list = list.filter(function filterByBrand(store) {
        return store.marca === marca;
      });
    }
    if (ativo !== '') {
      list = list.filter(function filterByStatus(store) {
        return String(store.ativo) === ativo;
      });
    }

    renderTable(list);
  }

  function abrirModalLoja(store, opener) {
    var isEdit = Boolean(store);
    modalLojaOpener = opener || document.activeElement || null;
    document.getElementById('modal-loja-titulo').textContent = isEdit ? 'Editar Loja' : 'Nova Loja';
    setModalLojaSubtitle(isEdit);
    document.getElementById('fl-id').value = (store && store.id) || '';
    document.getElementById('fl-codigo').value = (store && store.codigo) || '';
    document.getElementById('fl-nome').value = (store && store.nome) || '';
    document.getElementById('fl-marca').value = (store && store.marca) || 'O Boticario';
    document.getElementById('fl-cidade').value = (store && store.cidade) || '';
    document.getElementById('fl-estado').value = (store && store.estado) || '';
    document.getElementById('fl-ativo').value = isEdit ? String(!!store.ativo) : 'true';
    document.getElementById('modal-loja-btn-save').innerHTML = isEdit
      ? '<i data-lucide="save" class="w-4 h-4"></i> Salvar alterações'
      : '<i data-lucide="plus" class="w-4 h-4"></i> Criar loja';
    document.getElementById('fl-ativo-wrapper').classList.toggle('hidden', !isEdit);
    document.getElementById('modal-loja').classList.remove('hidden');
    document.getElementById('modal-loja').setAttribute('aria-hidden', 'false');
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
    focusModalLojaNameField();
  }

  function fecharModalLoja() {
    document.getElementById('modal-loja').classList.add('hidden');
    document.getElementById('modal-loja').setAttribute('aria-hidden', 'true');
    document.getElementById('fl-id').value = '';
    document.getElementById('fl-ativo-wrapper').classList.add('hidden');
    restoreModalLojaFocus();
  }

  function editarLoja(id, opener) {
    var store = allStores.find(function findStore(item) {
      return String(item.id) === String(id);
    });
    if (store) abrirModalLoja(store, opener);
  }

  async function toggleAtivoLoja(id, ativo, deps) {
    var action = ativo ? 'desativar' : 'ativar';

    if (!(await ConfirmModal.confirm(action === 'desativar' ? 'Desativar loja' : 'Ativar loja', 'Deseja ' + action + ' esta loja?'))) return;

    var result = await deps.sb.from('lojas').update({ ativo: !ativo }).eq('id', id);
    if (result.error) {
      deps.showToast('Erro: ' + result.error.message);
      return;
    }

    setStoreLoadState('idle');
    deps.showToast('Loja ' + (ativo ? 'desativada' : 'ativada') + ' com sucesso.');
    await carregarTabelaLojas(deps);
  }

  var ESTADOS_BR = [
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
    'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
  ];

  function validarEstado(valor) {
    if (!valor) return null;
    return ESTADOS_BR.indexOf(valor) !== -1 ? null : 'Estado inválido. Use uma UF brasileira (ex: SP, RJ, MG).';
  }

  async function excluirLoja(id, deps) {
    var store = allStores.find(function findStore(item) {
      return String(item.id) === String(id);
    });
    var code = (store && store.codigo) || '';
    var name = (store && store.nome) || id;
    var label = code ? code + ' - ' + name : name;
    if (!(await ConfirmModal.confirm('Excluir loja', 'Excluir a loja ' + label + '? Esta acao nao pode ser desfeita.'))) return;

    try {
      var result = await deps.sb.rpc('delete_store', { p_store_id: Number(id) });
      if (result.error) throw result.error;

      setStoreLoadState('idle');
      deps.showToast('Loja excluida com sucesso.');
      await carregarTabelaLojas(deps);
    } catch (error) {
      deps.showToast('Erro: ' + error.message);
    }
  }

  async function salvarLoja(deps) {
    var id = document.getElementById('fl-id').value;
    var codigo = document.getElementById('fl-codigo').value.trim();
    var nome = document.getElementById('fl-nome').value.trim();
    var marca = document.getElementById('fl-marca').value;
    var cidade = document.getElementById('fl-cidade').value.trim();
    var estado = document.getElementById('fl-estado').value.trim().toUpperCase();
    var ativo = document.getElementById('fl-ativo').value === 'true';

    var errors = [];
    if (!codigo) errors.push('Código é obrigatório.');
    if (!nome) errors.push('Nome da loja é obrigatório.');
    if (!['O Boticario', 'QDB'].includes(marca)) errors.push('Selecione uma marca.');
    if (cidade && cidade.length > 50) errors.push('Cidade deve ter no máximo 50 caracteres.');
    if (estado && !/^[A-Z]{2}$/.test(estado)) {
      errors.push('Estado deve ter exatamente 2 letras (ex: SP).');
    } else if (estado) {
      var estadoErro = validarEstado(estado);
      if (estadoErro) errors.push(estadoErro);
    }

    if (errors.length) {
      deps.showToast(errors.join(' '));
      return;
    }

    var payload = {
      codigo: codigo,
      nome: nome,
      marca: marca,
      ativo: ativo,
      cidade: cidade || null,
      estado: estado || null,
    };

    try {
      if (id) {
        var updateResult = await deps.sb.from('lojas').update(payload).eq('id', id);
        if (updateResult.error) throw updateResult.error;
        deps.showToast('Loja atualizada com sucesso.');
      } else {
        var insertResult = await deps.sb.from('lojas').insert(payload);
        if (insertResult.error) throw insertResult.error;
        deps.showToast('Loja cadastrada com sucesso.');
      }

      setStoreLoadState('idle');
      fecharModalLoja();
      await carregarTabelaLojas(deps);
    } catch (error) {
      deps.showToast('Erro: ' + error.message);
    }
  }

  global.StoresModule = {
    afterRenderLojasCadastro: afterRenderLojasCadastro,
    abrirModalLoja: abrirModalLoja,
    carregarTabelaLojas: carregarTabelaLojas,
    editarLoja: editarLoja,
    excluirLoja: excluirLoja,
    fecharModalLoja: fecharModalLoja,
    filtrarLojas: filtrarLojas,
    findStoreById: findStoreById,
    getAllStores: getAllStores,
    getStoreLoadState: getStoreLoadState,
    loadStores: loadStores,
    renderTabelaLojas: renderTable,
    salvarLoja: salvarLoja,
    toggleAtivoLoja: toggleAtivoLoja,
  };
})(window);
