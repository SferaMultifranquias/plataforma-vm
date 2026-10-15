(function initOrdersDataModule(global) {
  function getSb(deps) {
    return typeof deps.getSb === 'function' ? deps.getSb() : deps.sb;
  }

  function logSubmitStage(stage, phase, meta) {
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

  function normalizeOrderResult(result, stage) {
    var data = result && typeof result === 'object' ? result.data : result;
    var candidate = null;

    if (typeof data === 'string') {
      candidate = { id: data };
    } else if (Array.isArray(data)) {
      candidate = data[0] || null;
    } else if (data && typeof data === 'object') {
      candidate = data;
    }

    var id = candidate && (candidate.id || candidate.order_id || candidate.internal_id || candidate.uuid);
    if (!id) {
      throw createStageError(stage, 'INVALID_ORDER_RESPONSE', 'The ' + stage + ' operation did not return a usable order ID.');
    }

    return {
      id: id,
      internal_number: candidate.internal_number || candidate.internalNumber || candidate.protocolo || null,
      delivery_date: candidate.delivery_date || null,
      delivery_protocol: candidate.delivery_protocol || null,
      placed_at: candidate.placed_at || null,
      received_at: candidate.received_at || null,
      raw: result,
      status: candidate.status || null,
    };
  }

  function ensureApi(deps) {
    if (!deps.API_OK()) {
      throw new Error('Sem conexao com banco de dados.');
    }
  }

  function normalizeOrderRecord(order, deps) {
    var requester = order.requester || null;
    var currentUser = typeof deps?.getCurrentUser === 'function' ? deps.getCurrentUser() : null;
    var requesterName = order.requester_name || '';
    var requesterEmail = requester?.email || order.requester_email || '';

    if (!requesterName && requester && typeof global.AppUtils?.formatHistoricalActorName === 'function') {
      requesterName = global.AppUtils.formatHistoricalActorName(requester);
    }

    if (!requesterName && currentUser && String(order.requester_id || '') === String(currentUser.id || '')) {
      requesterName = currentUser.nome || currentUser.email || '';
      requesterEmail = currentUser.email || '';
    }

    var items = Array.isArray(order.order_items) ? order.order_items : [];
    var valTotal = items.reduce(function(s, it) { return s + Number(it.placed_total_value || 0); }, 0);

    return {
      approved_at: order.approved_at || null,
      brand: order.brand || '',
      created_at: order.created_at || null,
      delivery_date: order.delivery_date || null,
      delivery_protocol: order.delivery_protocol || null,
      id: order.id,
      internal_number: order.internal_number || '',
      priority: order.priority || '',
      order_items: items,
      placed_at: order.placed_at || null,
      placed_by_id: order.placed_by_id || null,
      rejected_at: order.rejected_at || null,
      requester_email: requesterEmail,
      requester_id: order.requester_id || '',
      requester_name: requesterName,
      received_at: order.received_at || null,
      received_by_id: order.received_by_id || null,
      status: order.status || '',
      store: order.store || '',
      store_id: order.store_id || null,
      submitted_at: order.submitted_at || null,
      updated_at: order.updated_at || null,
      valor_total: valTotal > 0 ? valTotal : null,
    };
  }

  function normalizeOrderImage(image) {
    return {
      bucket_name: image.bucket_name || 'order-images',
      created_at: image.created_at || null,
      file_hash: image.file_hash || '',
      file_size: image.file_size || null,
      id: image.id,
      loadError: image.loadError || null,
      mime_type: image.mime_type || '',
      order_id: image.order_id || null,
      order_item_id: image.order_item_id || null,
      original_filename: image.original_filename || '',
      signedUrl: image.signedUrl || null,
      storage_path: image.storage_path || '',
      uploaded_by_id: image.uploaded_by_id || null,
    };
  }

  async function loadOrderImagesWithSignedUrls(sb, order) {
    var images = Array.isArray(order?.order_images) ? order.order_images : [];
    if (!images.length) return order;

    var hydratedImages = await Promise.all(images.map(async function hydrateImage(image) {
      var normalized = normalizeOrderImage(image);
      if (!normalized.storage_path) {
        return { ...normalized, loadError: 'missing-path' };
      }

      try {
        var bucket = sb.storage.from(normalized.bucket_name || 'order-images');
        var result = await bucket.createSignedUrl(normalized.storage_path, 3600);
        if (result.error || !result.data || !result.data.signedUrl) {
          return { ...normalized, loadError: result.error?.message || 'signed-url-failed' };
        }

        return { ...normalized, signedUrl: result.data.signedUrl };
      } catch (error) {
        return { ...normalized, loadError: error && error.message ? error.message : 'signed-url-failed' };
      }
    }));

    return {
      ...order,
      order_images: hydratedImages,
    };
  }

  async function listOrdersForCurrentProfile(params, deps) {
    ensureApi(deps);
    var sb = getSb(deps);
    var currentUser = typeof deps.getCurrentUser === 'function' ? deps.getCurrentUser() : null;
    var pageSize = Number(params?.pageSize) > 0 ? Number(params.pageSize) : 20;
    var page = Number(params?.page) > 0 ? Number(params.page) : 1;
    var start = (page - 1) * pageSize;
    var end = start + pageSize - 1;

    var result = await sb
      .from('orders')
      .select(`
      id,
      internal_number,
      store_id,
      store,
      brand,
      requester_id,
      status,
      priority,
      created_at,
      delivery_date,
      delivery_protocol,
      placed_at,
      placed_by_id,
      updated_at,
      submitted_at,
      approved_at,
      rejected_at,
      received_at,
      received_by_id,
      order_items ( id, product_code, description, category, quantity, unit, notes, placed_unit_value, placed_total_value )
    `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(start, end);

    if (result.error) throw new Error(result.error.message);

    var rows = Array.isArray(result.data) ? result.data : [];
    var requesterIds = Array.from(new Set(rows.map(function mapRequester(row) {
      return row.requester_id;
    }).filter(Boolean)));
    var requesterMap = new Map();

    if (requesterIds.length) {
      try {
        var requesterResult = await sb
          .from('profiles')
          .select('id,name,email,removed_at')
          .in('id', requesterIds);

        if (!requesterResult.error) {
          requesterMap = new Map((requesterResult.data || []).map(function mapProfile(profile) {
            return [profile.id, profile];
          }));
        }
      } catch (error) {
        console.warn('[orders-data] requester lookup failed:', error);
      }
    }

    var items = rows.map(function mapRow(row) {
      return normalizeOrderRecord({
        ...row,
        requester: requesterMap.get(row.requester_id) || null,
      }, {
        getCurrentUser: function getCurrentUser() {
          return currentUser;
        },
      });
    });

    return {
      items: items,
      page: page,
      pageSize: pageSize,
      total: result.count || rows.length,
    };
  }

  async function carregarPedidos(filtros, deps) {
    ensureApi(deps);
    var sb = getSb(deps);

    var query = sb
      .from('orders')
      .select(`
      id,
      internal_number,
      brand,
      store,
      purpose,
      justification,
      priority,
      notes,
      status,
      rejection_reason,
      created_at,
      delivery_date,
      delivery_protocol,
      placed_at,
      placed_by_id,
      updated_at,
      submitted_at,
      approved_at,
      rejected_at,
      received_at,
      received_by_id,
      order_items ( id, product_code, description, category, quantity, unit, notes ),
      status_history ( id, previous_status, new_status, comment, created_at )
    `)
      .order('created_at', { ascending: false });

    if (filtros?.status) query = query.eq('status', filtros.status);
    if (filtros?.loja_id) {
      var lojas = await deps.carregarLojas();
      var loja = lojas.find(function findStore(item) {
        return String(item.id) === String(filtros.loja_id);
      });
      if (!loja) return [];
      query = query.eq('store', loja.nome);
    }
    if (filtros?.limit) query = query.limit(filtros.limit);

    var result = await query;
    if (result.error) throw new Error(result.error.message);
    return (result.data || []).map(deps.mapOrderRecord);
  }

  async function carregarPedido(id, deps) {
    ensureApi(deps);
    var sb = getSb(deps);

    var result = await sb
      .from('orders')
      .select(`
      id,
      internal_number,
      brand,
      store,
      store_id,
      requester_id,
      purpose,
      justification,
      priority,
      notes,
      cost_center,
      status,
      rejection_reason,
      created_at,
      delivery_date,
      delivery_protocol,
      placed_at,
      placed_by_id,
      updated_at,
      submitted_at,
      approved_at,
      rejected_at,
      received_at,
      received_by_id,
      order_items ( id, product_code, description, category, quantity, unit, notes, placed_unit_value, placed_total_value ),
      status_history ( id, previous_status, new_status, comment, created_at ),
      order_images ( id, order_id, order_item_id, uploaded_by_id, original_filename, storage_path, bucket_name, mime_type, file_size, file_hash, created_at )
    `)
      .eq('id', id)
      .single();

    if (result.error) throw new Error(result.error.message);
    return deps.mapOrderRecord(await loadOrderImagesWithSignedUrls(sb, result.data), {
      getCurrentUser: deps.getCurrentUser,
    });
  }

  async function carregarStats(deps) {
    ensureApi(deps);
    var sb = getSb(deps);
    var inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    var results = await Promise.all([
      sb.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', inicioMes.toISOString()),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED').gte('created_at', inicioMes.toISOString()),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'REJECTED').gte('created_at', inicioMes.toISOString()),
    ]);

    return {
      total_mes: results[0].count || 0,
      em_aberto: results[1].count || 0,
      entregues_mes: results[2].count || 0,
      alertas_duplicata: results[3].count || 0,
    };
  }

  async function calcularHashArquivo(file) {
    var buffer = await file.arrayBuffer();
    var digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(function mapByte(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function isAdminUser(currentUser) {
    return String(currentUser?.papel || currentUser?.role || '').toLowerCase() === 'admin';
  }

  function buildOrderItemsPayload(items, notes, orderId) {
    return (items || [])
      .map(function mapItem(item) {
        var productCode = (item.productCode || item.sku_digitado || item.product_code || '').toUpperCase().trim();
        return {
          order_id: orderId,
          category: item.category || null,
          description: item.description || productCode || 'Item sem descricao',
          product_code: productCode,
          quantity: Number(item.quantity ?? item.quantidade ?? 1) || 1,
          unit: item.unit || 'un',
          notes: item.notes || notes || null,
        };
      })
      .filter(function hasProductCode(item) {
        return item.product_code;
      });
  }

  function buildImagePayload(currentUser, orderId, fotoFile, fileHash) {
    var ext = (fotoFile.name.split('.').pop() || 'jpg').toLowerCase();
    var storagePath = 'orders/' + currentUser.id + '/' + orderId + '/' + crypto.randomUUID() + '.' + ext;

    return {
      bucket_name: 'order-images',
      file_hash: fileHash,
      file_size: fotoFile.size,
      mime_type: fotoFile.type || 'image/jpeg',
      original_filename: fotoFile.name,
      order_id: orderId,
      order_item_id: null,
      storage_path: storagePath,
      uploaded_by_id: currentUser.id,
    };
  }

  async function markOrderPlacedAPI(payload, deps) {
    var sb = getSb(deps);
    var orderId = String(payload && payload.order_id || payload && payload.id || '').trim();
    var protocol = String(payload && payload.delivery_protocol || payload && payload.protocol || '').trim();
    var deliveryDate = String(payload && payload.delivery_date || '').trim();
    var itemValues = payload && Array.isArray(payload.itemValues) ? payload.itemValues : [];

    if (!orderId) {
      throw createStageError('mark-order-placed', 'ORDER_PLACED_FAILED', 'Pedido invalido.');
    }

    if (!protocol) {
      throw createStageError('mark-order-placed', 'ORDER_PLACED_FAILED', 'Protocolo obrigatorio.');
    }

    if (!deliveryDate) {
      throw createStageError('mark-order-placed', 'ORDER_PLACED_FAILED', 'Data de entrega obrigatoria.');
    }

    if (!itemValues.length) {
      throw createStageError('mark-order-placed', 'ORDER_PLACED_FAILED', 'Valores dos itens obrigatorios.');
    }

    var result = await sb.rpc('mark_order_placed', {
      p_delivery_date: deliveryDate,
      p_delivery_protocol: protocol,
      p_order_id: orderId,
      p_item_values: itemValues,
    });

    if (result.error) {
      throw createStageError('mark-order-placed', 'ORDER_PLACED_FAILED', result.error.message, result.error);
    }

    var normalized = normalizeOrderResult(result, 'mark-order-placed');
    return {
      delivery_date: normalized.delivery_date,
      delivery_protocol: normalized.delivery_protocol,
      id: normalized.id,
      placed_at: normalized.placed_at,
      protocolo: normalized.internal_number,
      received_at: normalized.received_at,
      status: normalized.status,
    };
  }

  async function confirmReceiptAPI(orderId, deps, options) {
    var sb = getSb(deps);
    var id = String(orderId || '').trim();
    var invoiceNumber = options && options.invoiceNumber ? String(options.invoiceNumber).trim() : '';

    if (!id) {
      throw createStageError('confirm-receipt', 'ORDER_RECEIPT_FAILED', 'Pedido invalido.');
    }

    if (!invoiceNumber) {
      throw createStageError('confirm-receipt', 'ORDER_RECEIPT_FAILED', 'Numero da nota fiscal obrigatorio.');
    }

    var result = await sb.rpc('confirm_order_received', {
      p_order_id: id,
      p_invoice_number: invoiceNumber,
      p_item_values: null,
    });

    if (result.error) {
      throw createStageError('confirm-receipt', 'ORDER_RECEIPT_FAILED', result.error.message, result.error);
    }

    var normalized = normalizeOrderResult(result, 'confirm-receipt');
    return {
      delivery_date: normalized.delivery_date,
      delivery_protocol: normalized.delivery_protocol,
      id: normalized.id,
      invoice_number: invoiceNumber,
      placed_at: normalized.placed_at,
      protocolo: normalized.internal_number,
      received_at: normalized.received_at,
      status: normalized.status,
    };
  }

  async function enviarPedidoAPI(formData, deps) {
    var sb = getSb(deps);
    var currentUser = deps.getCurrentUser ? deps.getCurrentUser() : null;
    var draftOrderId = formData.get('draft_order_id');
    var lojaId = formData.get('loja_id');
    var brand = formData.get('brand') || '';
    var costCenter = formData.get('cost_center') || '';
    var purpose = formData.get('purpose') || '';
    var justification = formData.get('justification') || '';
    var priority = formData.get('priority') || 'NORMAL';
    var notes = formData.get('notes') || '';
    var itens = JSON.parse(formData.get('itens') || '[]');
    var lojaSelect = document.getElementById('f-loja');
    var lojaOption = lojaSelect?.selectedOptions?.[0] || null;

    if (draftOrderId) {
      logSubmitStage('submit-order', 'start', {
        orderId: draftOrderId,
        retry: true,
      });
      var retryResult = await sb.rpc('submit_order', { p_order_id: draftOrderId });
      if (retryResult.error) {
        throw createStageError('submit-order', 'ORDER_SUBMIT_FAILED', retryResult.error.message, retryResult.error);
      }
      var normalizedRetry = normalizeOrderResult(retryResult, 'submit-order');
      logSubmitStage('submit-order', 'complete', {
        orderId: normalizedRetry.id,
        retry: true,
      });
      return {
        id: normalizedRetry.id,
        protocolo: normalizedRetry.internal_number,
        status: normalizedRetry.status,
      };
    }

    if (!lojaOption || !lojaId) throw new Error('Loja obrigatoria.');

    var pedidoResult;
    try {
      logSubmitStage('create-order', 'start', {
        hasStoreId: Number.isFinite(Number(lojaId)),
        storeIdType: typeof lojaId,
      });
      pedidoResult = await sb.rpc('create_order', {
        p_brand: brand || lojaOption.dataset.brand || '',
        p_store: lojaOption.textContent || '',
        p_cost_center: costCenter || lojaOption.dataset.codigo || '',
        p_purpose: purpose || 'Pedido VM',
        p_justification: justification || notes || '',
        p_priority: priority || 'NORMAL',
        p_notes: notes || justification || '',
        p_store_id: Number(lojaId) || null,
      });
      if (pedidoResult.error) {
        throw createStageError('create-order', 'ORDER_CREATE_FAILED', pedidoResult.error.message, pedidoResult.error);
      }
      pedidoResult = normalizeOrderResult(pedidoResult, 'create-order');
      logSubmitStage('create-order', 'complete', {
        id: pedidoResult.id,
      });
    } catch (error) {
      throw error.stage ? error : createStageError('create-order', 'ORDER_CREATE_FAILED', error.message, error);
    }

    var pedidoId = pedidoResult.id;
    var itensPayload = buildOrderItemsPayload(itens, notes, pedidoId);

    if (itensPayload.length) {
      logSubmitStage('items', 'start', {
        count: itensPayload.length,
      });
      var itemResult = await sb.from('order_items').insert(itensPayload);
      if (itemResult.error) {
        throw createStageError('items', 'ORDER_ITEMS_FAILED', itemResult.error.message, itemResult.error);
      }
      logSubmitStage('items', 'complete', {
        count: itensPayload.length,
      });
    }

    var fotoFiles = formData.getAll('fotos');
    var uploadedPaths = [];
    if (fotoFiles && fotoFiles.length) {
      for (var fi = 0; fi < fotoFiles.length; fi++) {
        var fotoFile = fotoFiles[fi];
        if (!fotoFile || !fotoFile.size) continue;
        var fileHash = await calcularHashArquivo(fotoFile);
        var imagePayload = buildImagePayload(currentUser, pedidoId, fotoFile, fileHash);
        logSubmitStage('image-upload', 'start', {
          file: fotoFile.name,
          size: fotoFile.size,
          index: fi,
          total: fotoFiles.length,
        });
        var uploadResult = await sb.storage.from('order-images').upload(imagePayload.storage_path, fotoFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: fotoFile.type,
        });
        if (uploadResult.error) {
          throw createStageError('image-upload', 'ORDER_IMAGE_UPLOAD_FAILED', uploadResult.error.message + ' (' + fotoFile.name + ')', uploadResult.error);
        }
        logSubmitStage('image-upload', 'complete', {
          path: imagePayload.storage_path,
        });

        logSubmitStage('image-link', 'start', {
          path: imagePayload.storage_path,
        });
        var imageResult = await sb.from('order_images').insert({
          ...imagePayload,
        });
        if (imageResult.error) {
          throw createStageError('image-link', 'ORDER_IMAGE_LINK_FAILED', imageResult.error.message + ' (' + fotoFile.name + ')', imageResult.error);
        }
        logSubmitStage('image-link', 'complete', {
          path: imagePayload.storage_path,
        });
        uploadedPaths.push(imagePayload.storage_path);
      }
    }

    logSubmitStage('submit-order', 'start', {
      orderId: pedidoId,
    });
    var submitResult = await sb.rpc('submit_order', { p_order_id: pedidoId });
      if (submitResult.error) {
        var submitError = createStageError('submit-order', 'ORDER_SUBMIT_FAILED', submitResult.error.message, submitResult.error);
        submitError.orderId = pedidoId;
        submitError.internalNumber = pedidoResult.internal_number || null;
        submitError.completedStages = {
          image: Boolean(uploadedPaths.length),
          items: Boolean(itensPayload.length),
        };
        throw submitError;
      }
    var normalizedSubmit = normalizeOrderResult(submitResult, 'submit-order');
    logSubmitStage('submit-order', 'complete', {
      orderId: normalizedSubmit.id,
    });

    return {
      id: normalizedSubmit.id,
      protocolo: normalizedSubmit.internal_number,
      status: normalizedSubmit.status,
    };
  }

  async function resubmitChangedOrderAPI(payload, deps) {
    var sb = getSb(deps);
    var currentUser = deps.getCurrentUser ? deps.getCurrentUser() : null;
    var orderId = String(payload && payload.order_id || '').trim();
    var items = Array.isArray(payload && payload.items) ? payload.items : [];
    var newImages = Array.isArray(payload && payload.newImages) ? payload.newImages : [];
    var removedImageIds = Array.isArray(payload && payload.removedImageIds) ? payload.removedImageIds : [];
    var purpose = String(payload && payload.purpose || '').trim();
    var justification = String(payload && payload.justification || '').trim();
    var priority = String(payload && payload.priority || 'NORMAL').trim();
    var notes = String(payload && payload.notes || '').trim();

    if (!orderId) {
      throw createStageError('resubmit-order', 'ORDER_RESUBMIT_FAILED', 'Pedido invalido.');
    }

    var itensPayload = buildOrderItemsPayload(items, notes, orderId);
    if (!itensPayload.length) {
      throw createStageError('items', 'ORDER_ITEMS_FAILED', 'Adicione ao menos um item valido.');
    }

    var uploadedMetadata = [];
    var uploadedPaths = [];

    // Upload new images to Storage
    if (newImages.length) {
      for (var ni = 0; ni < newImages.length; ni++) {
        var imgEntry = newImages[ni];
        var file = imgEntry.file;
        if (!file || !file.size) continue;
        var fileHash = await calcularHashArquivo(file);
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        var storagePath = 'orders/' + currentUser.id + '/' + orderId + '/' + crypto.randomUUID() + '.' + ext;

        logSubmitStage('image-upload', 'start', {
          file: file.name,
          index: ni,
          total: newImages.length,
        });

        var uploadResult = await sb.storage.from('order-images').upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });
        if (uploadResult.error) {
          throw createStageError('image-upload', 'ORDER_IMAGE_UPLOAD_FAILED', uploadResult.error.message + ' (' + file.name + ')', uploadResult.error);
        }

        logSubmitStage('image-upload', 'complete', {
          path: storagePath,
        });

        uploadedMetadata.push({
          bucket_name: 'order-images',
          file_hash: fileHash,
          file_size: file.size,
          mime_type: file.type || 'image/jpeg',
          original_filename: file.name,
          storage_path: storagePath,
        });
        uploadedPaths.push(storagePath);
      }
    }

    // Delete old Storage files for removed images (RLS allows user to delete own files)
    if (removedImageIds.length) {
      // Load storage paths from DB first (trust DB, not browser)
      try {
        var existingImages = await sb.from('order_images')
          .select('id, storage_path')
          .in('id', removedImageIds)
          .eq('order_id', orderId);
        if (!existingImages.error && existingImages.data && existingImages.data.length) {
          var pathsToDelete = existingImages.data.map(function mapPath(r) { return r.storage_path; }).filter(Boolean);
          for (var di = 0; di < pathsToDelete.length; di++) {
            try {
              await sb.storage.from('order-images').remove([pathsToDelete[di]]);
            } catch (storageErr) {
              console.warn('[orders] failed to delete removed image from storage:', storageErr && storageErr.message ? storageErr.message : storageErr);
            }
          }
        }
      } catch (loadErr) {
        console.warn('[orders] failed to load image paths for removal:', loadErr && loadErr.message ? loadErr.message : loadErr);
      }
    }

    try {
      logSubmitStage('resubmit-order', 'start', {
        orderId: orderId,
        newImageCount: uploadedMetadata.length,
        removedCount: removedImageIds.length,
      });

      var result = await sb.rpc('resubmit_changed_order_multi_image', {
        p_images_metadata: uploadedMetadata,
        p_remove_image_ids: removedImageIds,
        p_justification: justification || notes || '',
        p_notes: notes || justification || '',
        p_order_id: orderId,
        p_priority: priority || 'NORMAL',
        p_purpose: purpose || 'Pedido VM',
        p_items: itensPayload,
      });

      if (result.error) {
        throw createStageError('resubmit-order', 'ORDER_RESUBMIT_FAILED', result.error.message, result.error);
      }

      var normalized = normalizeOrderResult(result, 'resubmit-order');
      logSubmitStage('resubmit-order', 'complete', {
        orderId: normalized.id,
      });

      return {
        id: normalized.id,
        protocolo: normalized.internal_number,
        status: normalized.status,
      };
    } catch (error) {
      // Cleanup newly uploaded Storage files on failure
      if (uploadedPaths.length) {
        try {
          await sb.storage.from('order-images').remove(uploadedPaths);
        } catch (cleanupError) {
          console.warn('[orders] cleanup failed for new images:', cleanupError && cleanupError.message ? cleanupError.message : cleanupError);
        }
      }

      throw error.stage ? error : createStageError('resubmit-order', 'ORDER_RESUBMIT_FAILED', error.message, error);
    }
  }

  async function deletarPedidoAPI(id, deps, password) {
    var token = await getAccessToken(deps);
    var response = await fetch('/api/admin/orders/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: password || '' }),
    });
    var responseText = await response.text();
    var body;
    try {
      body = JSON.parse(responseText || '{}');
    } catch (_) {
      body = { _rawText: responseText };
    }
    if (!response.ok || body.error) {
      throw new Error(body.error || body.message || 'Erro ao excluir pedido.');
    }
    if (body.partialFailure) {
      // ponytail: partialFailure logged client-side, notify user
      console.warn('Pedido excluido com falha parcial:', body);
    }
    return body;
  }

  function getAccessToken(deps) {
    var sb = typeof deps.getSb === 'function' ? deps.getSb() : deps.supabase;
    if (!sb || !sb.auth || typeof sb.auth.getSession !== 'function') {
      throw new Error('Supabase nao inicializado.');
    }
    return sb.auth.getSession().then(function (sessionResult) {
      var accessToken = sessionResult && sessionResult.data && sessionResult.data.session
        ? sessionResult.data.session.access_token
        : '';
      if (!accessToken) throw new Error('Sessao autenticada nao encontrada.');
      return accessToken;
    });
  }

  async function decidirPedidoAPI(id, status, justificativa, deps) {
    var sb = getSb(deps);

    if (status === 'processando' || status === 'APPROVED') {
      var approveResult = await sb.rpc('approve_order', { p_order_id: id });
      if (approveResult.error) throw new Error(approveResult.error.message);
      return;
    }

    if (status === 'validacao_reprovada' || status === 'REJECTED') {
      var rejectResult = await sb.rpc('reject_order', { p_order_id: id, p_reason: justificativa || '' });
      if (rejectResult.error) throw new Error(rejectResult.error.message);
      return;
    }

    if (status === 'CHANGES_REQUESTED') {
      var changeRequestResult = await sb.rpc('request_order_changes', { p_order_id: id, p_comment: justificativa || '' });
      if (changeRequestResult.error) throw new Error(changeRequestResult.error.message);
      return;
    }

    throw new Error('Acao nao suportada no fluxo atual.');
  }

  async function fillPlacedValuesAPI(payload, deps) {
    var sb = getSb(deps);
    var orderId = String(payload && payload.order_id || payload && payload.id || '').trim();
    var itemValues = payload && Array.isArray(payload.itemValues) ? payload.itemValues : [];

    if (!orderId) {
      throw createStageError('fill-placed-values', 'FILL_VALUES_FAILED', 'Pedido invalido.');
    }

    if (!itemValues.length) {
      throw createStageError('fill-placed-values', 'FILL_VALUES_FAILED', 'Valores dos itens obrigatorios.');
    }

    var result = await sb.rpc('fill_placed_order_values', {
      p_order_id: orderId,
      p_item_values: itemValues,
    });

    if (result.error) {
      throw createStageError('fill-placed-values', 'FILL_VALUES_FAILED', result.error.message, result.error);
    }

    var normalized = normalizeOrderResult(result, 'fill-placed-values');
    return {
      id: normalized.id,
      status: normalized.status,
      protocolo: normalized.internal_number,
    };
  }

  global.OrdersDataModule = {
    confirmReceiptAPI: confirmReceiptAPI,
    fillPlacedValuesAPI: fillPlacedValuesAPI,
    listOrdersForCurrentProfile: listOrdersForCurrentProfile,
    carregarPedido: carregarPedido,
    carregarPedidos: carregarPedidos,
    carregarStats: carregarStats,
    decidirPedidoAPI: decidirPedidoAPI,
    deletarPedidoAPI: deletarPedidoAPI,
    enviarPedidoAPI: enviarPedidoAPI,
    markOrderPlacedAPI: markOrderPlacedAPI,
    normalizeOrderRecord: normalizeOrderRecord,
    resubmitChangedOrderAPI: resubmitChangedOrderAPI,
  };
})(window);
