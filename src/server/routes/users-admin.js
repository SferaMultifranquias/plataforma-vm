'use strict';

const express = require('express');
const { AdminError, createSupabaseAdminService } = require('../services/supabase-admin-service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

const ALLOWED_CREATE_FIELDS = ['name', 'email', 'role', 'isActive', 'storeIds'];
const ALLOWED_UPDATE_FIELDS = ['name', 'email', 'role', 'isActive', 'storeIds', 'password'];

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
  const isRateLimited = status === 429 && /rate limit/i.test(String(rawMessage));
  const code = isRateLimited ? 'RATE_LIMITED' : rawCode;
  const message = isRateLimited
    ? 'Ação temporariamente limitada. Aguarde alguns minutos e tente novamente.'
    : rawMessage;

  res.status(status).json({
    code,
    error: message,
  });
}

function resolveService(serviceOrFactory) {
  if (typeof serviceOrFactory === 'function') {
    return serviceOrFactory;
  }

  return function getService() {
    return serviceOrFactory;
  };
}

function createUsersAdminHandler(serviceOrFactory) {
  const getService = resolveService(serviceOrFactory);

  return async function handleUsersAdminRequest(req, res) {
    try {
      const service = getService();
      if (!service) {
        throw new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED', 'O serviço administrativo não está configurado.');
      }

      if (typeof service.assertConfigured === 'function') {
        service.assertConfigured();
      }

      const accessToken = readBearerToken(req);
      const caller = await service.assertActiveAdmin(accessToken);

      if (req.method === 'POST') {
        requireJsonContentType(req);
        const body = sanitizeObject(req.body || {}, ALLOWED_CREATE_FIELDS);
        const payload = await service.createUser(body, caller);
        res.status(201).json(payload);
        return;
      }

      if (req.method === 'PATCH') {
        requireJsonContentType(req);
        const userId = String(req.params.id || '').trim();
        if (!isValidUUID(userId)) {
          throw new AdminError(400, 'INVALID_USER', 'Usuario invalido.');
        }
        const body = sanitizeObject(req.body || {}, ALLOWED_UPDATE_FIELDS);
        const payload = await service.updateUser(userId, body, caller);
        res.json(payload);
        return;
      }

      if (req.method === 'DELETE') {
        const userId = String(req.params.id || '').trim();
        if (!isValidUUID(userId)) {
          throw new AdminError(400, 'INVALID_USER', 'Usuario invalido.');
        }
        const payload = await service.removeUser(userId, caller, accessToken);
        res.json(payload);
        return;
      }

      const payload = await service.listUsers(req.query || {});
      res.json(payload);
    } catch (error) {
      sendAdminError(res, error);
    }
  };
}

function createUsersAdminRouter(options) {
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
  const handler = createUsersAdminHandler(getService);

  router.get('/', handler);
  router.post('/', handler);
  router.patch('/:id', handler);
  router.delete('/:id', handler);

  function requireService(req, res, next) {
    try {
      const svc = getService();
      if (!svc || typeof svc.assertConfigured !== 'function') {
        throw new AdminError(503, 'ADMIN_SERVICE_NOT_CONFIGURED', 'O serviço administrativo não está configurado.');
      }
      svc.assertConfigured();
      req.adminService = svc;
      req.accessToken = readBearerToken(req);
      next();
    } catch (error) {
      sendAdminError(res, error);
    }
  }

  router.get('/export', requireService, async function handleExport(req, res) {
    try {
      const svc = req.adminService;
      const caller = await svc.assertActiveAdmin(req.accessToken);
      const users = await svc.exportUsers(req.query || {}, { ...caller, accessToken: req.accessToken });
      res.json(users);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post('/import/validate', requireService, async function handleImportValidate(req, res) {
    try {
      requireJsonContentType(req);
      const svc = req.adminService;
      const caller = await svc.assertActiveAdmin(req.accessToken);
      const body = sanitizeObject(req.body || {}, ['rows']);
      const result = await svc.validateImport(body.rows, caller);
      res.json(result);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  router.post('/import', requireService, async function handleImport(req, res) {
    try {
      requireJsonContentType(req);
      const svc = req.adminService;
      const caller = await svc.assertActiveAdmin(req.accessToken);
      const body = sanitizeObject(req.body || {}, ['rows']);
      const result = await svc.importUsers(body.rows, caller);
      res.json(result);
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}

module.exports = {
  createUsersAdminHandler,
  createUsersAdminRouter,
  readBearerToken,
  resolveService,
};
