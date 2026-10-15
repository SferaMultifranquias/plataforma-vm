'use strict';

const express = require('express');
const { AdminError, createSupabaseAdminService } = require('../services/supabase-admin-service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const STOCK_STATUSES = ['pending_check', 'in_stock', 'partial_stock', 'out_of_stock', 'needs_purchase'];

function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireJsonContentType(req) {
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    throw new AdminError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de mídia não suportado.');
  }
}

function sanitizeObject(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (Object.getPrototypeOf(obj) !== Object.prototype) {
    throw new AdminError(400, 'INVALID_FIELD', 'Campo inválido detectado.');
  }
  const result = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new AdminError(400, 'INVALID_FIELD', 'Campo inválido detectado.');
    }
    if (allowedKeys.includes(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

function sendAdminError(res, error) {
  const status = error instanceof AdminError && Number.isInteger(error.status) ? error.status : 500;
  const code = error instanceof AdminError ? error.code : 'internal_error';
  const message = error instanceof AdminError ? error.message : 'Erro interno.';
  res.status(status).json({ code, error: message });
}

function resolveService(serviceOrFactory) {
  if (typeof serviceOrFactory === 'function') return serviceOrFactory;
  return () => serviceOrFactory;
}

function createStockCheckHandler(serviceOrFactory) {
  const getService = resolveService(serviceOrFactory);

  return async function handleStockCheckRequest(req, res) {
    try {
      const service = getService();
      if (!service) throw new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED', 'O serviço administrativo não está configurado.');
      if (typeof service.assertConfigured === 'function') service.assertConfigured();

      const accessToken = readBearerToken(req);
      const caller = await service.assertActiveAdmin(accessToken);

      if (req.method === 'PATCH') {
        const itemId = String(req.params.orderItemId || '').trim();
        if (!isValidUUID(itemId)) {
          throw new AdminError(400, 'INVALID_ITEM', 'Item de pedido inválido.');
        }
        requireJsonContentType(req);
        const body = sanitizeObject(req.body || {}, ['stockStatus', 'availableQuantity', 'notes']);
        if (!body.stockStatus || !STOCK_STATUSES.includes(body.stockStatus)) {
          throw new AdminError(400, 'INVALID_STATUS', `Status inválido. Use: ${STOCK_STATUSES.join(', ')}`);
        }
        if (body.availableQuantity !== undefined && body.availableQuantity !== null) {
          const qty = Number(body.availableQuantity);
          if (!Number.isFinite(qty) || qty < 0) {
            throw new AdminError(400, 'INVALID_QUANTITY', 'Quantidade disponível inválida.');
          }
          body.availableQuantity = qty;
        }
        if (body.notes !== undefined) {
          body.notes = String(body.notes).trim();
          if (body.notes.length > 500) {
            throw new AdminError(400, 'INVALID_NOTES', 'Observações excedem o limite de 500 caracteres.');
          }
        }
        const payload = await service.updateStockCheck(itemId, body, caller);
        return res.json(payload);
      }

      if (req.method === 'GET') {
        const storeId = String(req.query.storeId || '').trim();
        const orderId = String(req.query.orderId || '').trim();
        const payload = await service.listStockChecks({ storeId, orderId });
        return res.json(payload);
      }

      throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    } catch (error) {
      sendAdminError(res, error);
    }
  };
}

function createReceivedStockHandler(serviceOrFactory) {
  const getService = resolveService(serviceOrFactory);

  return async function handleReceivedStockRequest(req, res) {
    try {
      const service = getService();
      if (!service) throw new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED', 'O serviço administrativo não está configurado.');
      if (typeof service.assertConfigured === 'function') service.assertConfigured();

      const accessToken = readBearerToken(req);
      const caller = await service.assertActiveAdmin(accessToken);

      if (req.method === 'PATCH') {
        const receiptId = String(req.params.receiptId || '').trim();
        if (!isValidUUID(receiptId)) {
          throw new AdminError(400, 'INVALID_RECEIPT', 'Recibo inválido.');
        }
        requireJsonContentType(req);
        const body = sanitizeObject(req.body || {}, ['productCode', 'description', 'receivedQuantity', 'unit', 'receivedUnitValue']);
        if (!body.productCode || !String(body.productCode).trim()) {
          throw new AdminError(400, 'INVALID_PRODUCT_CODE', 'Código do produto obrigatório.');
        }
        if (!body.description || !String(body.description).trim()) {
          throw new AdminError(400, 'INVALID_DESCRIPTION', 'Descrição obrigatória.');
        }
        if (body.receivedQuantity !== undefined && body.receivedQuantity !== null) {
          const qty = Number(body.receivedQuantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            throw new AdminError(400, 'INVALID_QUANTITY', 'Quantidade deve ser positiva.');
          }
          body.receivedQuantity = qty;
        } else {
          throw new AdminError(400, 'INVALID_QUANTITY', 'Quantidade obrigatória.');
        }
        if (!body.unit || !String(body.unit).trim()) {
          throw new AdminError(400, 'INVALID_UNIT', 'Unidade obrigatória.');
        }
        if (body.receivedUnitValue !== undefined && body.receivedUnitValue !== null) {
          const uv = Number(body.receivedUnitValue);
          if (!Number.isFinite(uv) || uv < 0) {
            throw new AdminError(400, 'INVALID_VALUE', 'Valor unitário inválido.');
          }
          body.receivedUnitValue = uv;
        }
        body.productCode = String(body.productCode).trim();
        body.description = String(body.description).trim();
        body.unit = String(body.unit).trim();

        const payload = await service.updateReceivedStock(receiptId, body, caller, accessToken);
        return res.json(payload);
      }

      if (req.method === 'POST') {
        const receiptId = String(req.params.receiptId || '').trim();
        if (!isValidUUID(receiptId)) {
          throw new AdminError(400, 'INVALID_RECEIPT', 'Recibo inválido.');
        }
        requireJsonContentType(req);
        const body = sanitizeObject(req.body || {}, ['voidReason']);
        if (!body.voidReason || !String(body.voidReason).trim()) {
          throw new AdminError(400, 'VOID_REASON_REQUIRED', 'Motivo da anulação obrigatório.');
        }

        const payload = await service.voidReceivedStock(receiptId, String(body.voidReason).trim(), caller, accessToken);
        return res.json(payload);
      }

      if (req.method !== 'GET') {
        throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      }

      const storeId = String(req.query.storeId || '').trim();
      const showVoided = String(req.query.showVoided || '').trim().toLowerCase();
      const payload = await service.listReceivedStock({ storeId, showVoided: showVoided === 'true' });
      return res.json(payload);
    } catch (error) {
      sendAdminError(res, error);
    }
  };
}

function createStockCheckRouter(options) {
  let service = options?.service || null;
  const getService = () => {
    if (!service) {
      service = createSupabaseAdminService({
        env: options?.env,
        fetch: options?.fetch,
      });
    }
    return service;
  };
  const router = express.Router();
  router.get('/', createStockCheckHandler(getService));
  router.patch('/:orderItemId', createStockCheckHandler(getService));
  return router;
}

function createReceivedStockRouter(options) {
  let service = options?.service || null;
  const getService = () => {
    if (!service) {
      service = createSupabaseAdminService({
        env: options?.env,
        fetch: options?.fetch,
      });
    }
    return service;
  };
  const router = express.Router();
  router.get('/', createReceivedStockHandler(getService));
  router.patch('/:receiptId', createReceivedStockHandler(getService));
  router.post('/:receiptId', createReceivedStockHandler(getService));
  return router;
}

module.exports = {
  createStockCheckRouter,
  createReceivedStockRouter,
  createStockCheckHandler,
  createReceivedStockHandler,
  readBearerToken,
  resolveService,
};
