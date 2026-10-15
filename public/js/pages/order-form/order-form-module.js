(function initFormModule(global) {
  var listenersBound = false;
  var currentDeps = null;
  var formState = createInitialState();
  var cachedStores = [];
  var isSubmitting = false;

  function getRules() {
    if (!global.OrderRules) {
      throw new Error('Regras do formulario nao carregadas.');
    }
    return global.OrderRules;
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function isAdminUser(user) {
    return String(user?.papel || user?.role || '').toLowerCase() === 'admin';
  }

  function requireElement(id) {
    var element = getElement(id);
    if (!element) {
      throw new Error('Required form element not found: #' + id);
    }
    return element;
  }

  function logStage(stage, phase, meta) {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[order-submit] ' + stage + ':' + phase, meta || {});
    }
  }

  function createStageError(stage, code, message, cause) {
    var error = new Error(message);
    error.stage = stage;
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }

    return 'item-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function createItemState() {
    return {
      description: '',
      id: makeId(),
      notes: '',
      productCode: '',
      quantity: 1,
    };
  }

  function hasItemContent(item) {
    if (!item) return false;

    return Boolean(
      String(item.productCode || '').trim() ||
      String(item.description || '').trim() ||
      String(item.notes || '').trim() ||
      Number(item.quantity) !== 1
    );
  }

  function createInitialState() {
    return {
      dirty: false,
      errors: {},
      generalData: {
        brand: '',
        costCenter: '',
        justification: '',
        lojaId: '',
        notes: '',
        priority: 'NORMAL',
        purpose: '',
        store: '',
      },
      currentOrder: null,
      existingImages: [],
      items: [createItemState()],
      loading: false,
      mode: 'CREATE',
      newImages: [],
      orderId: null,
      removedImageIds: [],
      saving: false,
    };
  }

  function cloneState() {
    return {
      dirty: formState.dirty,
      errors: { ...formState.errors },
      generalData: { ...formState.generalData },
      currentOrder: formState.currentOrder ? { ...formState.currentOrder } : null,
      existingImages: formState.existingImages.slice(),
      items: formState.items.map(function mapItem(item) {
        return { ...item };
      }),
      loading: formState.loading,
      mode: formState.mode,
      newImages: formState.newImages.slice(),
      orderId: formState.orderId,
      removedImageIds: formState.removedImageIds.slice(),
      saving: formState.saving,
    };
  }

  function setState(nextState) {
    formState = nextState;
  }

  function getEditBanner() {
    return getElement('order-edit-banner');
  }

  function setEditBanner(text) {
    var element = getEditBanner();
    if (!element) return;

    if (!text) {
      element.textContent = '';
      element.classList.add('hidden');
      return;
    }

    element.textContent = text;
    element.classList.remove('hidden');
  }

  function markDirty() {
    formState.dirty = true;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getStoreById(id) {
    var currentUser = currentDeps && typeof currentDeps.getCurrentUser === 'function'
      ? currentDeps.getCurrentUser()
      : null;
    var adminUser = isAdminUser(currentUser);

    if (!adminUser) {
      return cachedStores.find(function findStore(store) {
        return String(store.id) === String(id);
      }) || null;
    }

    var store = null;
    if (global.StoresModule && typeof global.StoresModule.findStoreById === 'function') {
      store = global.StoresModule.findStoreById(id);
    }
    if (!store) {
      store = cachedStores.find(function findStore(store) {
        return String(store.id) === String(id);
      }) || null;
    }
    return store || null;
  }

  function getSelectedStore() {
    var select = getElement('f-loja');
    var storeId = select?.value || '';
    if (!storeId) return null;

    var store = getStoreById(storeId);
    if (!store || String(store.id) !== String(storeId)) {
      return null;
    }

    return store;
  }

  function syncStoreFieldsFromSelection() {
    var store = getSelectedStore();
    var brandInput = getElement('f-brand');
    var costCenterInput = getElement('f-cost-center');
    var select = getElement('f-loja');
    var storeId = select?.value || '';

    if (storeId && !store) {
      if (select) select.value = '';
      storeId = '';
      var submitBtn = getElement('btn-submit-form');
      if (submitBtn) submitBtn.disabled = true;
    }

    formState.generalData.lojaId = storeId;
    formState.generalData.store = store?.nome || '';
    formState.generalData.brand = store?.marca || '';
    formState.generalData.costCenter = store?.codigo || '';

    if (brandInput) brandInput.value = formState.generalData.brand;
    if (costCenterInput) costCenterInput.value = formState.generalData.costCenter;

    return store;
  }

  function syncGeneralStateFromDom() {
    var store = syncStoreFieldsFromSelection();
    var generalData = formState.generalData;

    generalData.purpose = getElement('f-tipo')?.value?.trim() || getElement('f-purpose')?.value?.trim() || '';
    generalData.justification = getElement('f-motivo')?.selectedOptions?.[0]?.text?.trim() || getElement('f-motivo')?.value?.trim() || getElement('f-justification')?.value?.trim() || '';
    generalData.priority = getElement('f-priority')?.value || 'NORMAL';
    generalData.notes = getElement('f-notes')?.value?.trim() || '';
    generalData.store = store?.nome || generalData.store;
    generalData.brand = store?.marca || generalData.brand;
    generalData.costCenter = store?.codigo || generalData.costCenter;
    generalData.lojaId = getElement('f-loja')?.value || '';
  }

  function syncItemsFromDom() {
    var rows = document.querySelectorAll('#items-container [data-order-item="true"]');
    var items = [];

    rows.forEach(function mapRow(row) {
      var itemId = row.getAttribute('data-item-id') || makeId();
      var customerCodeField = row.querySelector('[data-field="customerCode"]') || row.querySelector('[data-field="productCode"]');
      items.push({
        description: row.querySelector('[data-field="description"]')?.value?.trim() || '',
        id: itemId,
        notes: row.querySelector('[data-field="notes"]')?.value?.trim() || '',
        productCode: customerCodeField?.value?.trim() || '',
        quantity: Number(row.querySelector('[data-field="quantity"]')?.value || 0),
      });
    });

    formState.items = items.length ? items : [createItemState()];
  }

  function syncStateFromDom() {
    syncGeneralStateFromDom();
    syncItemsFromDom();
  }

  function renderErrorSlot(field, message) {
    var element = document.querySelector('[data-error-for="' + field + '"]');
    if (!element) return;

    if (!message) {
      element.textContent = '';
      element.classList.add('hidden');
      return;
    }

    element.textContent = message;
    element.classList.remove('hidden');
  }

  function clearErrors() {
    document.querySelectorAll('[data-error-for]').forEach(function clearSlot(element) {
      element.textContent = '';
      element.classList.add('hidden');
    });
  }

  function renderErrors(errors) {
    clearErrors();

    Object.keys(errors || {}).forEach(function renderKey(key) {
      var message = errors[key];
      if (!message) return;

      if (key === 'lojaId') {
        renderErrorSlot('f-loja', message);
        return;
      }

      if (key === 'brand') {
        renderErrorSlot('f-brand', message);
        return;
      }

      if (key === 'costCenter') {
        renderErrorSlot('f-cost-center', message);
        return;
      }

      if (key === 'purpose') {
        renderErrorSlot('f-tipo', message);
        renderErrorSlot('f-purpose', message);
        return;
      }

      if (key === 'justification') {
        renderErrorSlot('f-motivo', message);
        renderErrorSlot('f-justification', message);
        return;
      }

      if (key === 'priority') {
        renderErrorSlot('f-priority', message);
        return;
      }

      if (key === 'notes') {
        renderErrorSlot('f-notes', message);
        return;
      }

      if (key === 'foto') {
        renderErrorSlot('foto', message);
        return;
      }

      renderErrorSlot(key, message);
    });
  }

  function applyValidationState(result) {
    formState.errors = { ...result.errors };
    renderErrors(formState.errors);
  }

  function getItemById(itemId) {
    return formState.items.find(function findItem(item) {
      return String(item.id) === String(itemId);
    }) || null;
  }

  function updateItemField(itemId, field, value) {
    var item = getItemById(itemId);
    if (!item) return;

    if (field === 'quantity') {
      item.quantity = Number(value);
    } else if (field === 'customerCode' || field === 'productCode') {
      item.productCode = String(value ?? '');
    } else {
      item[field] = String(value ?? '');
    }

    markDirty();
  }

  function renderItemRow(item, index) {
    var hasRemove = index > 1 || hasItemContent(item);
    var cardStyle = 'padding: 18px 20px; border: 1px solid #d8e0ec; border-radius: 12px; background: #f8fafc;';
    var headerStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 4px;';
    var gridStyle = 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 28px; width: 100%; margin-top: 16px; align-items: start;';
    var fieldStyle = 'display: flex; flex-direction: column; gap: 8px; min-width: 0; width: 100%;';
    var inputStyle = 'display: block; width: 100%; box-sizing: border-box; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; color: #111827; font: inherit; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); min-height: 42px;';
    var textareaStyle = inputStyle + ' min-height: 88px; resize: vertical;';
    return (
      '<div id="item-' + index + '" data-layout-version="items-grid-v2" data-order-item="true" data-item-id="' + escapeHtml(item.id) + '" data-item-index="' + index + '" class="order-item-card" style="' + cardStyle + '">' +
        '<div class="order-item-header" style="' + headerStyle + '">' +
          '<div class="text-xs font-semibold text-slate-600">Item ' + index + '</div>' +
          (hasRemove
            ? '<button type="button" data-action="remove-item" data-item-id="' + escapeHtml(item.id) + '" class="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1"><i data-lucide="x" class="w-3 h-3"></i> Remover</button>'
            : '') +
        '</div>' +
        '<div class="order-item-grid" style="' + gridStyle + '">' +
          '<div class="order-item-field" style="' + fieldStyle + '">' +
            '<label class="form-label text-xs">Cód. Cliente <span class="text-red-500">*</span></label>' +
            '<input class="form-input item-field text-xs" style="' + inputStyle + '" data-field="customerCode" value="' + escapeHtml(item.productCode) + '" placeholder="Ex: TDAH5398" />' +
            '<p class="form-error hidden text-xs text-red-600 mt-1" data-error-for="item-' + index + '.productCode"></p>' +
          '</div>' +
          '<div class="order-item-field" style="' + fieldStyle + '">' +
            '<label class="form-label text-xs">Quantidade <span class="text-red-500">*</span></label>' +
            '<input class="form-input item-field text-xs" style="' + inputStyle + '" type="number" min="1" step="1" data-field="quantity" value="' + escapeHtml(item.quantity) + '" />' +
            '<p class="form-error hidden text-xs text-red-600 mt-1" data-error-for="item-' + index + '.quantity"></p>' +
          '</div>' +
          '<div class="order-item-field" style="' + fieldStyle + '">' +
            '<label class="form-label text-xs">Descrição <span class="text-red-500">*</span></label>' +
            '<input class="form-input item-field text-xs" style="' + inputStyle + '" data-field="description" value="' + escapeHtml(item.description) + '" placeholder="Descrição do item" />' +
            '<p class="form-error hidden text-xs text-red-600 mt-1" data-error-for="item-' + index + '.description"></p>' +
          '</div>' +
          '<div class="order-item-field" style="' + fieldStyle + '">' +
            '<label class="form-label text-xs">Observações</label>' +
            '<textarea class="form-input item-field item-field-area text-xs" style="' + textareaStyle + '" data-field="notes" placeholder="Opcional">' + escapeHtml(item.notes) + '</textarea>' +
            '<p class="form-error hidden text-xs text-red-600 mt-1" data-error-for="item-' + index + '.notes"></p>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function itemRow(itemOrIndex, index) {
    if (typeof itemOrIndex === 'object' && itemOrIndex) {
      return renderItemRow(itemOrIndex, index || 1);
    }

    return renderItemRow(createItemState(), Number(itemOrIndex) || 1);
  }

  function updateItemsCount() {
    var element = getElement('items-count');
    if (element) {
      element.textContent = formState.items.length + ' item(ns)';
    }
  }

  function getSubmitButton() {
    return getElement('btn-submit-form');
  }

  function getSubmitLabel() {
    var button = getSubmitButton();
    if (!button || typeof button.querySelector !== 'function') return null;
    return button.querySelector('#btn-submit-label');
  }

  function setSubmitState(isSaving) {
    var button = getSubmitButton();
    var label = getSubmitLabel();

    if (!button) return;

    button.disabled = Boolean(isSaving);
    if (typeof button.setAttribute === 'function') {
      button.setAttribute('aria-busy', isSaving ? 'true' : 'false');
    }

    if (label) {
      label.textContent = isSaving
        ? 'Enviando...'
        : formState.mode === 'EDIT_CHANGES'
          ? 'Reenviar alterações'
          : formState.orderId
            ? 'Tentar enviar novamente'
            : 'Enviar Pedido';
      return;
    }

    if (typeof button.innerHTML === 'string') {
      button.innerHTML = isSaving
        ? '<i data-lucide="send" class="w-4 h-4"></i> <span id="btn-submit-label">Enviando...</span>'
        : '<i data-lucide="send" class="w-4 h-4"></i> <span id="btn-submit-label">' + (formState.mode === 'EDIT_CHANGES' ? 'Reenviar alterações' : (formState.orderId ? 'Tentar enviar novamente' : 'Enviar Pedido')) + '</span>';
      if (global.lucide && typeof global.lucide.createIcons === 'function') {
        global.lucide.createIcons();
      }
    }
  }

  function validateImagesField(isRequired) {
    var files = formState.newImages;
    var existingRemaining = formState.existingImages.filter(function keepExisting(img) {
      return !formState.removedImageIds.includes(img.id);
    });
    var totalImages = files.length + existingRemaining.length;
    var errors = {};
    var maxSizeBytes = 5 * 1024 * 1024;

    if (totalImages === 0 && !isRequired) {
      return { errors: errors, files: files, valid: true };
    }

    if (totalImages === 0) {
      errors.foto = 'Selecione pelo menos uma foto do produto.';
      return { errors: errors, files: files, valid: false };
    }

    for (var i = 0; i < files.length; i++) {
      var file = files[i].file;
      if (!global.OrderRules.isAllowedImageMimeType(file.type)) {
        errors.foto = 'Todas as fotos devem ser JPG, PNG ou WEBP.';
        break;
      }
      if (!Number.isFinite(file.size) || file.size <= 0) {
        errors.foto = 'Uma das fotos e invalida.';
        break;
      }
      if (file.size > maxSizeBytes) {
        errors.foto = 'Cada foto deve ter no maximo 5 MB.';
        break;
      }
    }

    return {
      errors: errors,
      files: files,
      valid: Object.keys(errors).length === 0,
    };
  }

  function addNewImages(files) {
    var added = 0;
    Array.from(files).forEach(function processFile(file) {
      var fingerprint = file.name + '|' + file.size + '|' + file.type + '|' + file.lastModified;
      if (!file.type.startsWith('image/')) {
        return;
      }
      var isDup = formState.newImages.some(function matchFingerprint(i) { return i.fingerprint === fingerprint; });
      if (isDup) {
        return;
      }
      var isExistingDup = formState.existingImages.some(function matchExisting(i) { return i.original_filename === file.name && Number(i.file_size) === file.size; });
      if (isExistingDup) {
        return;
      }
      var previewUrl = '';
      try { previewUrl = URL.createObjectURL(file); } catch (e) { /* ignore */ }
      formState.newImages.push({
        fingerprint: fingerprint,
        file: file,
        id: global.crypto.randomUUID(),
        lastModified: file.lastModified,
        name: file.name,
        previewUrl: previewUrl,
        size: file.size,
        type: file.type,
      });
      added++;
    });
    if (added) {
      markDirty();
      renderImageGallery();
      renderEditImagesSection();
    }
    return added;
  }

  function removeNewImage(imageId) {
    var img = formState.newImages.find(function find(i) { return i.id === imageId; });
    if (img && img.previewUrl) try { URL.revokeObjectURL(img.previewUrl); } catch (e) { /* noop */ }
    formState.newImages = formState.newImages.filter(function keep(i) { return i.id !== imageId; });
    markDirty();
    renderImageGallery();
    renderEditImagesSection();
  }

  function toggleExistingImageRemoval(imageId) {
    var idx = formState.removedImageIds.indexOf(imageId);
    if (idx >= 0) {
      formState.removedImageIds.splice(idx, 1);
    } else {
      formState.removedImageIds.push(imageId);
    }
    markDirty();
    renderEditImagesSection();
  }

  function updateUploadLabel() {
    var label = getElement('image-upload-label');
    if (!label) return;
    if (formState.newImages.length) {
      label.textContent = 'Adicionar mais imagens';
    } else {
      label.textContent = 'Arraste as fotos ou clique para selecionar';
    }
  }

  function renderImageGallery() {
    var container = getElement('image-gallery-container');
    var gallery = getElement('image-gallery');
    var countEl = getElement('image-gallery-count');
    var uploadArea = getElement('upload-area');
    if (!container) return;

    if (uploadArea) uploadArea.classList.remove('hidden');
    updateUploadLabel();

    if (!formState.newImages.length) {
      gallery.classList.add('hidden');
      return;
    }

    gallery.classList.remove('hidden');
    if (countEl) countEl.textContent = formState.newImages.length + ' nova(s) imagem(ns) selecionada(s)';

    container.innerHTML = formState.newImages.map(function mapImage(img) {
      return (
        '<div class="relative group rounded-lg border border-slate-200 bg-white overflow-hidden">' +
          '<img src="' + img.previewUrl + '" alt="' + escapeHtml(img.name) + '" class="w-full h-24 object-cover bg-slate-100">' +
          '<div class="px-2 py-1.5 text-xs text-slate-500 truncate">' + escapeHtml(img.name) + '</div>' +
          '<button type="button" data-action="remove-new-image" data-image-id="' + escapeHtml(img.id) + '" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-red-600">' +
            '<i data-lucide="x" class="w-3 h-3"></i>' +
          '</button>' +
        '</div>'
      );
    }).join('');

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function renderEditImagesSection() {
    var section = getElement('edit-images-section');
    var container = getElement('edit-images-container');
    if (!section || !container) return;

    var editable = formState.mode === 'EDIT_CHANGES' && formState.existingImages.length;
    if (!editable) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    container.innerHTML = formState.existingImages.map(function mapImage(img) {
      var isRemoved = formState.removedImageIds.indexOf(img.id) >= 0;
      return (
        '<div class="relative group rounded-lg border ' + (isRemoved ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white') + ' overflow-hidden">' +
          (img.signedUrl
            ? '<img src="' + escapeHtml(img.signedUrl) + '" alt="' + escapeHtml(img.original_filename || '') + '" class="w-full h-24 object-cover bg-slate-100">'
            : '<div class="w-full h-24 flex items-center justify-center bg-slate-100 text-xs text-slate-400">Sem preview</div>'
          ) +
          '<div class="px-2 py-1.5 text-xs text-slate-500 truncate">' + escapeHtml(img.original_filename || '') + '</div>' +
          '<button type="button" data-action="toggle-existing-image" data-image-id="' + escapeHtml(img.id) + '" class="absolute top-1 right-1 w-6 h-6 rounded-full ' + (isRemoved ? 'bg-slate-500' : 'bg-red-500') + ' text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-red-600">' +
            '<i data-lucide="' + (isRemoved ? 'rotate-ccw' : 'x') + '" class="w-3 h-3"></i>' +
          '</button>' +
          (isRemoved ? '<div class="absolute inset-0 flex items-center justify-center bg-red-500/20"><span class="text-xs font-semibold text-red-700 bg-white px-2 py-0.5 rounded">Removida</span></div>' : '') +
        '</div>'
      );
    }).join('');

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function renderItems() {
    var container = getElement('items-container');
    if (!container) return;

    container.innerHTML = formState.items
      .map(function mapItem(item, index) {
        return renderItemRow(item, index + 1);
      })
      .join('');

    updateItemsCount();

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function buildItemFromOrderRow(item) {
    return {
      customerCode: item.customer_code || item.product_code || item.sku_digitado || '',
      description: item.description || item.produtos?.nome || '',
      id: item.id || makeId(),
      notes: item.notes || '',
      productCode: item.product_code || item.sku_digitado || '',
      quantity: Number(item.quantity || item.quantidade || 1) || 1,
    };
  }

  function populateFormFromOrder(order) {
    if (!order) return;

    formState.mode = 'EDIT_CHANGES';
    formState.orderId = order.id;
    formState.currentOrder = order;
    formState.generalData = {
      brand: order.brand || '',
      costCenter: order.cost_center || '',
      justification: order.justification || order.notes || '',
      lojaId: String(order.store_id || ''),
      notes: order.notes || '',
      priority: order.priority || 'NORMAL',
      purpose: order.purpose || '',
      store: order.lojas?.nome || order.store || '',
    };
    formState.items = Array.isArray(order.pedido_itens) && order.pedido_itens.length
      ? order.pedido_itens.map(buildItemFromOrderRow)
      : [createItemState()];
    formState.existingImages = Array.isArray(order.order_images)
      ? order.order_images.filter(function filterValid(img) { return img && img.id; })
      : [];
    formState.removedImageIds = [];
    formState.newImages = [];

    setSelectValue('f-loja', String(order.store_id || ''));
    setSelectValue('f-tipo', formState.generalData.purpose);
    setSelectValue('f-motivo', formState.generalData.justification);
    setElementValue('f-brand', formState.generalData.brand);
    setElementValue('f-cost-center', formState.generalData.costCenter);
    setElementValue('f-purpose', formState.generalData.purpose);
    setElementValue('f-justification', formState.generalData.justification);
    setElementValue('f-priority', formState.generalData.priority);
    setElementValue('f-notes', formState.generalData.notes);
    setEditBanner('Editando pedido ' + (order.internal_number || order.id) + '. Imagens atuais mantidas.');
    renderItems();
    renderImageGallery();
    renderEditImagesSection();
    clearErrors();
    setSubmitState(false);
  }

  function setStoreStatus(message) {
    var element = getElement('store-status-message');
    if (element) {
      element.textContent = message || '';
    }
  }

  function renderStoreOptions(stores) {
    var select = getElement('f-loja');
    if (!select) return;

    select.innerHTML = ['<option value="">Selecione a loja...</option>']
      .concat((stores || []).map(function mapStore(store) {
        return '<option value="' + escapeHtml(store.id) + '" data-brand="' + escapeHtml(store.marca || '') + '" data-codigo="' + escapeHtml(store.codigo || '') + '">' + escapeHtml(store.nome || '-') + '</option>';
      }))
      .join('');

    if (formState.generalData.lojaId && (stores || []).some(function hasStore(store) {
      return String(store.id) === String(formState.generalData.lojaId);
    })) {
      select.value = formState.generalData.lojaId;
    } else {
      select.value = '';
    }

    syncStoreFieldsFromSelection();
  }

  function setStoreLoadUi(stores, message, disabled) {
    cachedStores = Array.isArray(stores) ? stores.slice() : [];
    renderStoreOptions(cachedStores);
    setStoreStatus(message || '');

    var select = getElement('f-loja');
    if (select) select.disabled = Boolean(disabled);

    var submit = getElement('btn-submit-form');
    if (submit && !isSubmitting) submit.disabled = Boolean(disabled);

    return cachedStores;
  }

  function setSelectValue(id, value) {
    var element = getElement(id);
    if (element) {
      element.value = value;
    }
  }

  function addItem() {
    var emptyItem = formState.items.find(function findEmpty(item) {
      return !hasItemContent(item);
    });

    if (emptyItem) {
      renderItems();
      focusItemField(emptyItem.id, 'customerCode');
      return;
    }

    formState.items.push(createItemState());
    markDirty();
    renderItems();
    focusItemField(formState.items[formState.items.length - 1].id, 'customerCode');
  }

  async function removeItem(itemId) {
    var current = getItemById(itemId);
    if (current && hasItemContent(current) && !(await ConfirmModal.confirm('Remover item', 'Remover este item?'))) {
      return;
    }

    formState.items = formState.items.filter(function keepItem(item) {
      return String(item.id) !== String(itemId);
    });

    if (!formState.items.length) {
      formState.items = [createItemState()];
    }

    markDirty();
    renderItems();
  }

  function focusItemField(itemId, field) {
    setTimeout(function focusLater() {
      var selector = '[data-item-id="' + String(itemId).replace(/"/g, '\\"') + '"] [data-field="' + field + '"]';
      var element = document.querySelector(selector);
      if (element && typeof element.focus === 'function') {
        element.focus();
      }
    }, 0);
  }

  function toggleCiclo() {
    return null;
  }

  function toggleMotivoOutro() {
    return null;
  }

  function bindListeners(deps) {
    if (listenersBound) return;
    currentDeps = deps || currentDeps;

    var form = requireElement('form-pedido');
    var itemsContainer = requireElement('items-container');
    var addButton = requireElement('btn-add-item');
    var uploadArea = requireElement('upload-area');
    var clearButton = requireElement('btn-clear-form');
    var fotoInput = getElement('foto-input');

    requireElement('f-loja');
    requireElement('f-tipo');
    requireElement('f-motivo');

    form?.addEventListener('input', function handleFormInput(event) {
      var target = event.target;
      if (!target) return;

      if (target.id === 'f-loja' || target.id === 'f-tipo' || target.id === 'f-motivo' || target.id === 'f-purpose' || target.id === 'f-justification' || target.id === 'f-priority' || target.id === 'f-notes') {
        syncGeneralStateFromDom();
        markDirty();
        return;
      }
    });

    form?.addEventListener('submit', function handleFormSubmit(event) {
      event.preventDefault();
      submitForm(currentDeps || deps || {});
    });

    form?.addEventListener('change', function handleFormChange(event) {
      var target = event.target;
      if (!target) return;

      if (target.id === 'f-loja' || target.id === 'f-tipo' || target.id === 'f-motivo') {
        syncGeneralStateFromDom();
        markDirty();
      }
    });

    itemsContainer?.addEventListener('input', function handleItemInput(event) {
      var target = event.target;
      var row = target && target.closest('[data-order-item="true"]');
      if (!target || !row) return;

      var itemId = row.getAttribute('data-item-id');
      var field = target.getAttribute('data-field');
      if (!itemId || !field) return;

      updateItemField(itemId, field, target.value);
      syncItemsFromDom();
    });

    itemsContainer?.addEventListener('click', function handleItemClick(event) {
      var button = event.target && event.target.closest('[data-action="remove-item"]');
      if (!button) return;

      removeItem(button.getAttribute('data-item-id'));
    });

    addButton?.addEventListener('click', function handleAddClick() {
      addItem();
    });

    clearButton?.addEventListener('click', function handleClearClick() {
      resetForm();
    });

    uploadArea?.addEventListener('click', function handleUploadClick() {
      if (fotoInput && typeof fotoInput.click === 'function') {
        fotoInput.click();
      }
    });

    uploadArea?.addEventListener('dragover', function handleUploadDragOver(event) {
      event.preventDefault();
      uploadArea.classList.add('border-blue-400', 'bg-blue-50');
    });

    uploadArea?.addEventListener('dragleave', function handleUploadDragLeave() {
      uploadArea.classList.remove('border-blue-400', 'bg-blue-50');
    });

    uploadArea?.addEventListener('drop', function handleUploadDrop(event) {
      handleImagesDrop(event, currentDeps || deps || {});
    });

    fotoInput?.addEventListener('change', function handleFotoChange(event) {
      handleImagesUpload(event.target);
    });

    var recentOrders = getElement('form-pedidos-recentes');
    recentOrders?.addEventListener('click', function handleRecentOrdersClick(event) {
      var card = event.target && event.target.closest('[data-order-id]');
      if (!card || typeof global.openPedido !== 'function') return;

      global.openPedido(card.getAttribute('data-order-id'));
    });

    var galleryContainer = getElement('image-gallery-container');
    galleryContainer?.addEventListener('click', function handleGalleryClick(event) {
      var button = event.target && event.target.closest('[data-action="remove-new-image"]');
      if (button) {
        removeNewImage(button.getAttribute('data-image-id'));
      }
    });

    var editContainer = getElement('edit-images-container');
    editContainer?.addEventListener('click', function handleEditImagesClick(event) {
      var button = event.target && event.target.closest('[data-action="toggle-existing-image"]');
      if (button) {
        toggleExistingImageRemoval(button.getAttribute('data-image-id'));
      }
    });

    listenersBound = true;
  }

  function carregarAlertasAtivos() {
    var element = getElement('form-alertas-ativos');
    if (element) {
      element.innerHTML = '<div class="text-xs text-amber-600">Centro de custo bloqueado apenas por origem da loja.</div>';
    }
  }

  async function loadStoresIntoSelect(deps) {
    var select = getElement('f-loja');
    if (!select) return [];
    cachedStores = [];
    select.disabled = true;

    var submit = getElement('btn-submit-form');
    if (submit && !isSubmitting) submit.disabled = true;

    try {
      var result = await deps.carregarLojas();
      var stores = Array.isArray(result)
        ? result
        : result && Array.isArray(result.items)
          ? result.items
          : (global.StoresModule && typeof global.StoresModule.getAllStores === 'function' ? global.StoresModule.getAllStores() : []);
      var currentUser = typeof deps.getCurrentUser === 'function' ? deps.getCurrentUser() : null;
      var adminUser = isAdminUser(currentUser);

      stores = stores.filter(function filterActiveStore(store) {
        return store && store.ativo !== false;
      });

      if (adminUser) {
        stores = stores.slice();
        if (!stores.length) {
          return setStoreLoadUi([], 'Nenhuma loja ativa encontrada.', true);
        }

        return setStoreLoadUi(stores, stores.length + ' loja(s) carregada(s).', false);
      }

      if (currentUser && !currentUser.id) {
        return setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
      }

      if (!currentUser || typeof deps.getSb !== 'function') {
        return setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
      }

      var allowedStoreIds = null;

      if (currentUser && !adminUser && typeof deps.getSb === 'function') {
        try {
          var sb = deps.getSb();
          if (sb && typeof sb.from === 'function') {
            var accessResult = await sb
              .from('user_stores')
              .select('store_id')
              .eq('user_id', currentUser.id);

            if (!accessResult.error) {
              allowedStoreIds = new Set((accessResult.data || []).map(function mapAccess(row) {
                return String(row.store_id);
              }));
            } else {
              return setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
            }
          } else {
            return setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
          }
        } catch (accessError) {
          console.warn('[stores] user access lookup failed:', accessError && accessError.message ? accessError.message : accessError);
          return setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
        }
      }

      if (!allowedStoreIds || !allowedStoreIds.size) {
        return setStoreLoadUi([], 'Nenhuma loja vinculada ao seu usuário', true);
      }

      stores = stores.filter(function filterAllowedStore(store) {
        return allowedStoreIds.has(String(store.id));
      });

      if (!stores.length) {
        return setStoreLoadUi([], 'Nenhuma loja vinculada ao seu usuário', true);
      }

      return setStoreLoadUi(stores, stores.length + ' loja(s) carregada(s).', false);
    } catch (error) {
      setStoreLoadUi([], 'Não foi possível carregar suas lojas vinculadas.', true);
      console.error('[stores] loading failed:', error);
      return [];
    }
  }



  async function afterRenderFormulario(deps) {
    listenersBound = false;
    currentDeps = deps || currentDeps;
    var required = {
      form: requireElement('form-pedido'),
      store: requireElement('f-loja'),
      type: requireElement('f-tipo'),
      reason: requireElement('f-motivo'),
      items: requireElement('items-container'),
      addItem: requireElement('btn-add-item'),
      upload: requireElement('upload-area'),
      clear: requireElement('btn-clear-form'),
      submit: requireElement('btn-submit-form'),
    };
    bindListeners(currentDeps);

    try {
      await loadStoresIntoSelect(deps);
    } catch (error) {
      console.warn('loadStoresIntoSelect error:', error.message);
    }

    var requestedOrderId = String((deps && deps.params && deps.params.orderId) || '').trim();
    if (requestedOrderId && typeof deps.carregarPedido === 'function') {
      try {
        var order = await deps.carregarPedido(requestedOrderId);
        var currentUser = typeof deps.getCurrentUser === 'function' ? deps.getCurrentUser() : null;
        if (!order || !global.AppUtils || typeof global.AppUtils.canEditOrder !== 'function' || !global.AppUtils.canEditOrder(currentUser, order)) {
          throw new Error('Pedido nao editavel pelo usuario atual.');
        }

        populateFormFromOrder(order);
      } catch (error) {
        console.warn('loadExistingOrderForEdit error:', error.message);
        deps.showToast?.('Nao foi possivel abrir pedido para edicao.');
      }
    }

    syncStateFromDom();
    renderItems();
    carregarAlertasAtivos();

    try {
      var pedidos = await deps.carregarPedidos({ limit: 4 });
      var element = getElement('form-pedidos-recentes');
      if (!element) return;

      if (!pedidos.length) {
        element.innerHTML = '<div class="text-xs text-blue-400">Nenhum pedido ainda.</div>';
        return;
      }

      element.innerHTML = pedidos.map(function mapOrder(order) {
        var loja = order.lojas?.nome || '-';
        var sku = order.pedido_itens?.[0]?.product_code || order.pedido_itens?.[0]?.sku_digitado || '-';
        var qty = order.pedido_itens?.[0]?.quantity || order.pedido_itens?.[0]?.quantidade || 1;
        var data = order.criado_em?.slice(0, 10) || '';
        return (
          '<button type="button" data-order-id="' + escapeHtml(order.id) + '" class="w-full text-left mb-2 pb-2 border-b border-blue-100 last:border-0 last:mb-0 cursor-pointer hover:opacity-80">' +
            '<div class="text-xs font-medium text-blue-900">' + escapeHtml(loja.trim()) + '</div>' +
            '<div class="text-xs text-blue-700">' + escapeHtml(sku) + ' · ' + escapeHtml(qty) + 'un</div>' +
            '<div class="text-xs text-blue-400 flex items-center gap-1 mt-0.5">' + escapeHtml(data) + ' · ' + deps.statusBadge(order.status) + '</div>' +
          '</button>'
        );
      }).join('');

      if (global.lucide && typeof global.lucide.createIcons === 'function') {
        global.lucide.createIcons();
      }
    } catch (error) {
      console.warn('Pedidos recentes erro:', error.message);
    }
  }

  function validateCurrentFormState() {
    syncStateFromDom();
    var validation = getRules().validateOrderForm({
      generalData: formState.generalData,
      items: formState.items,
    });
    var imageValidation = validateImagesField(formState.mode !== 'EDIT_CHANGES');
    var errors = { ...validation.errors, ...imageValidation.errors };

    return {
      errors: errors,
      general: validation.general,
      imageValidation: imageValidation,
      items: validation.items,
      valid: validation.valid && imageValidation.valid,
    };
  }

  async function submitForm(deps) {
    var runtimeDeps = deps || currentDeps || {};
    if (isSubmitting) {
      logStage('duplicate-blocked', 'complete');
      return;
    }

    logStage('event', 'start', {
      hasSubmitHandler: true,
    });

    logStage('validation', 'start');
    var validation = validateCurrentFormState();
    logStage('validation', 'complete', {
      imageCount: formState.newImages.length,
      existingCount: formState.existingImages.length,
      removedCount: formState.removedImageIds.length,
      valid: validation.valid,
    });
    applyValidationState(validation);

    if (!validation.valid) {
      runtimeDeps.showToast?.(validation.errors.foto || validation.errors.items || 'Corrija os campos destacados.');
      return;
    }

    if (!runtimeDeps.API_OK || !runtimeDeps.API_OK()) {
      runtimeDeps.showToast?.('Sem conexao com o banco de dados.');
      return;
    }

    var isEditResubmit = formState.mode === 'EDIT_CHANGES' && typeof runtimeDeps.resubmitChangedOrderAPI === 'function';
    var payload = isEditResubmit
      ? {
          currentOrder: formState.currentOrder,
          newImages: formState.newImages.slice(),
          removedImageIds: formState.removedImageIds.slice(),
          items: formState.items.map(function mapItem(item) {
            return {
              description: item.description || '',
              notes: item.notes || '',
              productCode: item.productCode || '',
              quantity: Number(item.quantity || 0),
            };
          }),
          justification: formState.generalData.justification,
          notes: formState.generalData.notes,
          order_id: formState.orderId,
          priority: formState.generalData.priority,
          purpose: formState.generalData.purpose,
          store_id: formState.generalData.lojaId,
        }
      : new FormData();

    if (isEditResubmit) {
      logStage('payload', 'ready', {
        hasNewImages: Boolean(payload.newImages && payload.newImages.length),
        removedCount: payload.removedImageIds.length,
        hasStoreId: Boolean(payload.store_id),
        itemCount: payload.items.length,
        storeIdType: typeof payload.store_id,
      });
    } else {
      payload.append('loja_id', formState.generalData.lojaId);
      payload.append('brand', formState.generalData.brand);
      payload.append('cost_center', formState.generalData.costCenter);
      payload.append('purpose', formState.generalData.purpose);
      payload.append('justification', formState.generalData.justification);
      payload.append('priority', formState.generalData.priority);
      payload.append('notes', formState.generalData.notes);
      payload.append('itens', JSON.stringify(formState.items.map(function mapItem(item) {
        return {
          description: item.description || '',
          customerCode: item.productCode || '',
          notes: item.notes || '',
          productCode: item.productCode || '',
          quantity: Number(item.quantity || 0),
        };
      })));

      formState.newImages.forEach(function appendImage(img) {
        payload.append('fotos', img.file);
      });

      if (formState.orderId) {
        payload.append('draft_order_id', formState.orderId);
      }

      logStage('payload', 'ready', {
        imageCount: formState.newImages.length,
        hasStoreId: Boolean(payload.get('loja_id')),
        itemCount: JSON.parse(String(payload.get('itens') || '[]')).length,
        storeIdType: typeof payload.get('loja_id'),
      });
    }

    var sendOrder = isEditResubmit ? runtimeDeps.resubmitChangedOrderAPI : runtimeDeps.enviarPedidoAPI;

    if (typeof sendOrder !== 'function') {
      runtimeDeps.showToast?.('Dependência de envio ausente.');
      console.error('[form-submit] enviarPedidoAPI ausente', runtimeDeps);
      return;
    }

    isSubmitting = true;
    setSubmitState(true);

    var submitStageError = null;
    try {
      var result = await sendOrder(payload);
      logStage('success', 'complete', {
        status: result?.status || null,
      });
      runtimeDeps.showToast?.('Pedido enviado! Protocolo ' + result.protocolo);
      resetForm();
      if (window.history && window.history.replaceState) {
        var cleanUrl = new URL(window.location.href);
        if (cleanUrl.searchParams.has('orderId')) {
          cleanUrl.searchParams.delete('orderId');
          window.history.replaceState(window.history.state, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        }
      }
      if (runtimeDeps.afterRenderForm) {
        await runtimeDeps.afterRenderForm();
      }
    } catch (error) {
      var stage = String(error && error.stage || 'unknown');
      var messageMap = {
        'create-order': 'Nao foi possivel criar o pedido.',
        'image-link': 'A imagem foi enviada, mas nao pode ser vinculada ao pedido.',
        'image-upload': 'O pedido foi criado, mas a imagem nao pode ser enviada.',
        items: 'O pedido foi criado, mas os itens nao puderam ser salvos.',
        'resubmit-order': 'Nao foi possivel reenviar as alteracoes.',
        'submit-order': 'O pedido foi criado como rascunho, mas nao pode ser enviado para aprovacao.',
      };
      console.error('[order-submit] error', {
        code: error?.code ?? null,
        message: error?.message ?? 'Unknown error',
        stage: stage,
      });
      logStage('error', 'complete', {
        stage: stage,
      });
      if (stage === 'submit-order' && error && error.orderId) {
        formState.orderId = error.orderId;
        formState.mode = 'RESUME_SUBMIT';
        setSubmitState(false);
      }
      submitStageError = stage === 'submit-order' && error && error.orderId ? error : null;
      var fallbackMessage = error && error.message ? error.message : 'Erro desconhecido.';
      runtimeDeps.showToast?.(messageMap[stage] || ('Erro ao enviar: ' + fallbackMessage));
    } finally {
      isSubmitting = false;
      if (!submitStageError) {
        setSubmitState(false);
      }
      logStage('finished', 'complete');
    }
  }

  function resetForm() {
    formState.newImages.forEach(function revokeUrl(img) {
      if (img.previewUrl) try { URL.revokeObjectURL(img.previewUrl); } catch (e) { /* noop */ }
    });
    setState(createInitialState());

    setSelectValue('f-loja', '');
    setElementValue('f-brand', '');
    setElementValue('f-cost-center', '');
    setElementValue('f-purpose', '');
    setElementValue('f-justification', '');
    setElementValue('f-priority', 'NORMAL');
    setElementValue('f-notes', '');
    setElementValue('foto-input', '');
    setEditBanner('');
    var uploadArea = getElement('upload-area');
    if (uploadArea) uploadArea.classList.remove('hidden');

    updateUploadLabel();

    var gallery = getElement('image-gallery');
    if (gallery) gallery.classList.add('hidden');
    var editSection = getElement('edit-images-section');
    if (editSection) editSection.classList.add('hidden');

    renderItems();
    clearErrors();

    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function setElementValue(id, value) {
    var element = getElement(id);
    if (element) {
      element.value = value;
    }
  }

  function handleImagesUpload(input) {
    if (!input || !input.files || !input.files.length) {
      return;
    }
    var files = Array.from(input.files);
    addNewImages(files);
    input.value = '';
  }

  function handleImagesDrop(event, deps) {
    event.preventDefault();
    var runtimeDeps = deps || currentDeps || {};
    var files = event.dataTransfer?.files;
    if (!files || !files.length) {
      runtimeDeps.showToast?.('Selecione arquivos de imagem validos.');
      return;
    }

    addNewImages(files);

    var uploadArea = getElement('upload-area');
    if (uploadArea) {
      uploadArea.classList.remove('border-blue-400', 'bg-blue-50');
    }
  }

  global.FormModule = {
    addItem: addItem,
    addNewImages: addNewImages,
    afterRenderFormulario: afterRenderFormulario,
    carregarAlertasAtivos: carregarAlertasAtivos,
    handleImagesDrop: handleImagesDrop,
    handleImagesUpload: handleImagesUpload,
    itemRow: itemRow,
    removeItem: removeItem,
    removeNewImage: removeNewImage,
    resetForm: resetForm,
    submitForm: submitForm,
    toggleCiclo: toggleCiclo,
    toggleExistingImageRemoval: toggleExistingImageRemoval,
    toggleMotivoOutro: toggleMotivoOutro,
    updateItemField: updateItemField,
  };
})(window);
