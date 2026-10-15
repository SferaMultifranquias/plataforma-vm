'use strict';

const express = require('express');
const { AdminError, createSupabaseAdminService } = require('../services/supabase-admin-service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const ALLOWED_DELETE_FIELDS = ['password'];

function sanitizeObject(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
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

function requireJsonContentType(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new AdminError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de mídia não suportado.');
  }
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function sendAdminError(res, error) {
  const status = error instanceof AdminError && Number.isInteger(error.status) ? error.status : 500;
  const rawCode = error instanceof AdminError ? error.code : 'internal_error';
  const rawMessage = error instanceof AdminError ? error.message : 'Erro interno.';
  const code = rawCode;
  const message = rawMessage;

  res.status(status).json({ code, error: message, status });
}

function resolveService(serviceOrFactory) {
  if (typeof serviceOrFactory === 'function') return serviceOrFactory;
  return function getService() { return serviceOrFactory; };
}

function createOrdersAdminHandler(serviceOrFactory) {
  const getService = resolveService(serviceOrFactory);

  return async function handleOrdersAdminRequest(req, res) {
    try {
      const service = getService();
      if (!service) {
        throw new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED', 'O serviço administrativo não está configurado.');
      }
      if (typeof service.assertConfigured === 'function') service.assertConfigured();

      if (req.method === 'DELETE') {
        const accessToken = readBearerToken(req);
        const caller = await service.assertActiveAdmin(accessToken);

        requireJsonContentType(req);
        const orderId = String(req.params.id || '').trim();
        if (!isValidUUID(orderId)) {
          throw new AdminError(400, 'INVALID_ORDER', 'Order ID inválido.');
        }
        const body = sanitizeObject(req.body || {}, ALLOWED_DELETE_FIELDS);
        const password = String(body.password || '').trim();
        await service.verifyCallerPassword(caller, password);
        const result = await service.deleteOrder(orderId, caller, accessToken);
        res.status(result.ok ? 200 : 207).json(result);
        return;
      }

      throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    } catch (error) {
      sendAdminError(res, error);
    }
  };
}

function createOrdersAdminRouter(options) {
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
  const handler = createOrdersAdminHandler(getService);

  router.delete('/:id', handler);

  return router;
}

module.exports = {
  createOrdersAdminHandler,
  createOrdersAdminRouter,
  readBearerToken,
  resolveService,
};
