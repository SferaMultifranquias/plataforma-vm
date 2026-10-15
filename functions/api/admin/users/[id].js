import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';
import { sanitizeObject, isValidUUID } from '../../../_shared/admin-core.js';

const ALLOWED_UPDATE_FIELDS = ['name', 'email', 'role', 'isActive', 'storeIds', 'password'];

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'PATCH' && request.method !== 'DELETE') return methodNotAllowed();

  const userId = String(params?.id || '').trim();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    const caller = await service.assertActiveAdmin(accessToken);

    if (request.method === 'PATCH') {
      if (!isValidUUID(userId)) return badRequest('Usuario invalido.', 'INVALID_USER');

      if (!requireJsonContentType(request)) return unsupportedMediaType();
      const size = checkBodySize(request);
      if (size.tooLarge) return requestEntityTooLarge();

      const parsed = await readJsonPayload(request);
      if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

      const body = sanitizeObject(parsed.data, ALLOWED_UPDATE_FIELDS);
      const payload = await service.updateUser(userId, body, caller);
      return jsonResponse(payload);
    }

    if (!isValidUUID(userId)) return badRequest('Usuario invalido.', 'INVALID_USER');
    const payload = await service.removeUser(userId, caller, accessToken);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      const status = error.status || 500;
      const code = error.code || 'internal_error';
      const message = error.message || 'Erro interno.';
      return errorResponse(message, status, code);
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
