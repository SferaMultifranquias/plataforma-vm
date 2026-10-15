import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';
import { sanitizeObject, isValidUUID } from '../../../_shared/admin-core.js';

const ALLOWED_DELETE_FIELDS = ['password'];

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'DELETE') return methodNotAllowed();

  const orderId = String(params?.id || '').trim();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    const caller = await service.assertActiveAdmin(accessToken);

    if (!isValidUUID(orderId)) return badRequest('Order ID inválido.', 'INVALID_ORDER');

    if (!requireJsonContentType(request)) return unsupportedMediaType();
    const size = checkBodySize(request);
    if (size.tooLarge) return requestEntityTooLarge();

    const parsed = await readJsonPayload(request);
    if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

    const body = sanitizeObject(parsed.data, ALLOWED_DELETE_FIELDS);
    const password = String(body?.password || '').trim();
    await service.verifyCallerPassword(caller, password);
    const result = await service.deleteOrder(orderId, caller, accessToken);
    return jsonResponse(result, result.ok ? 200 : 207);
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
