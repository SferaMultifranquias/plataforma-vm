import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../../_shared/http.js';
import { createPagesAdminService } from '../../../../_shared/admin-service.js';
import { sanitizeObject, isValidUUID } from '../../../../_shared/admin-core.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'POST') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    const caller = await service.assertActiveAdmin(accessToken);

    const receiptId = String(params?.receiptId || '').trim();
    if (!isValidUUID(receiptId)) return badRequest('Recibo inválido.', 'INVALID_RECEIPT');

    if (!requireJsonContentType(request)) return unsupportedMediaType();
    const size = checkBodySize(request);
    if (size.tooLarge) return requestEntityTooLarge();

    const parsed = await readJsonPayload(request);
    if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

    const body = sanitizeObject(parsed.data, ['voidReason']);
    if (!body.voidReason || !String(body.voidReason).trim()) return badRequest('Motivo da anulação obrigatório.', 'VOID_REASON_REQUIRED');

    const payload = await service.voidReceivedStock(receiptId, String(body.voidReason).trim(), caller, accessToken);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
