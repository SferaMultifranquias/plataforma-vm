(function initOrderRules(global) {
  const DECISIONABLE_STATUSES = new Set(['PENDING_APPROVAL']);
  const FINAL_STATUSES = new Set(['RECEIVED', 'REJECTED', 'CANCELLED']);
  const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const PRIORITY_VALUES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeStatus(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function mapRole(role) {
    return normalizeStatus(role) === 'ADMIN' ? 'admin' : 'loja';
  }

  function canReviewOrder(status) {
    return DECISIONABLE_STATUSES.has(normalizeStatus(status));
  }

  function isFinalStatus(status) {
    return FINAL_STATUSES.has(normalizeStatus(status));
  }

  function isAllowedImageMimeType(mimeType) {
    return ALLOWED_IMAGE_MIME_TYPES.has(String(mimeType ?? '').toLowerCase());
  }

  function normalizePriority(value) {
    const priority = normalizeStatus(value);
    return PRIORITY_VALUES.has(priority) ? priority : '';
  }

  function validateGeneralData(generalData) {
    const data = generalData || {};
    const errors = {};
    const lojaId = normalizeText(data.lojaId || data.storeId);
    const brand = normalizeText(data.brand);
    const costCenter = normalizeText(data.costCenter || data.cost_center);
    const purpose = normalizeText(data.purpose || data.tipo);
    const justification = normalizeText(data.justification || data.observacoes || data.motivoTexto);
    const priority = normalizePriority(data.priority);
    const notes = normalizeText(data.notes);

    if (!lojaId) errors.lojaId = 'Selecione a loja.';
    if (!brand) errors.brand = 'Marca obrigatoria.';
    if (!costCenter) errors.costCenter = 'Centro de custo obrigatorio.';
    if (!purpose) errors.purpose = 'Informe a finalidade.';
    if (!justification) errors.justification = 'Informe a justificativa.';
    if (!priority) errors.priority = 'Prioridade obrigatoria.';
    if (notes && notes.length > 500) errors.notes = 'Observacoes muito longas.';

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: {
        brand,
        costCenter,
        justification,
        lojaId,
        notes,
        priority,
        purpose,
      },
    };
  }

  function validateOrderItem(item) {
    const data = item || {};
    const errors = {};
    const productCode = normalizeText(data.productCode || data.customerCode || data.sku_digitado || data.product_code).toUpperCase();
    const description = normalizeText(data.description);
    const notes = normalizeText(data.notes);
    const quantity = Number(data.quantity ?? data.quantidade ?? 0);

    if (!productCode) errors.productCode = 'Informe o cod. cliente.';
    if (!description) errors.description = 'Informe a descricao.';
    if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = 'Quantidade maior que zero.';
    if (notes && notes.length > 500) errors.notes = 'Observacoes muito longas.';

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      item: {
        ...data,
        description,
        notes,
        productCode,
        quantity,
      },
    };
  }

  function validateOrderItems(items) {
    const list = Array.isArray(items) ? items : [];
    const errors = {};
    const normalized = [];

    if (!list.length) {
      errors.items = 'Adicione pelo menos um item.';
    }

    list.forEach((item, index) => {
      const result = validateOrderItem(item);
      normalized.push(result.item);
      if (!result.valid) {
        errors[`item-${index + 1}`] = result.errors;
      }
    });

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      items: normalized,
    };
  }

  function validateOrderForm(formData) {
    const data = formData || {};
    const general = validateGeneralData(data.generalData);
    const items = validateOrderItems(data.items);
    const errors = { ...general.errors };

    Object.keys(items.errors).forEach((key) => {
      if (key === 'items') {
        errors.items = items.errors.items;
        return;
      }

      const rowErrors = items.errors[key];
      Object.keys(rowErrors).forEach((field) => {
        errors[`${key}.${field}`] = rowErrors[field];
      });
    });

    return {
      errors,
      general,
      items,
      valid: general.valid && items.valid,
    };
  }

  function buildOrderInput(input) {
    const data = input || {};
    const store = data.store || data.loja || {};
    const general = data.generalData || {};
    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.itens) ? data.itens : [];
    const brand = normalizeText(store.marca || data.brand || general.brand);
    const storeName = normalizeText(store.nome || data.storeName || general.store);
    const costCenter = normalizeText(store.codigo || data.costCenter || general.costCenter);
    const purpose = normalizeText(data.purpose || general.purpose || data.tipo);
    const justification = normalizeText(data.justification || general.justification || data.observacoes);
    const priority = normalizePriority(data.priority || general.priority || 'NORMAL') || 'NORMAL';
    const notes = normalizeText(data.notes || general.notes || justification);

    if (!storeName) {
      throw new Error('Loja obrigatoria.');
    }

    const normalizedItems = items
      .map((item) => {
        const result = validateOrderItem(item);
        return {
          description: result.item.description,
          notes: result.item.notes || null,
          product_code: result.item.productCode || null,
          quantity: result.item.quantity,
        };
      })
      .filter((item) => item.product_code && item.description && Number.isFinite(item.quantity) && item.quantity > 0);

    if (!normalizedItems.length) {
      throw new Error('Pelo menos um item valido e obrigatorio.');
    }

    return {
      brand,
      cost_center: costCenter,
      items: normalizedItems,
      notes,
      priority,
      purpose,
      store: storeName,
      justification,
    };
  }

  const api = {
    buildOrderInput,
    canReviewOrder,
    isAllowedImageMimeType,
    isFinalStatus,
    mapRole,
    normalizeText,
    validateGeneralData,
    validateOrderForm,
    validateOrderItem,
    validateOrderItems,
  };

  global.OrderRules = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
