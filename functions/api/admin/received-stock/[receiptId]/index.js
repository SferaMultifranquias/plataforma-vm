import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../../_shared/http.js';
import { createPagesAdminService } from '../../../../_shared/admin-service.js';
import { sanitizeObject, isValidUUID } from '../../../../_shared/admin-core.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'PATCH') return methodNotAllowed();

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

    const body = sanitizeObject(parsed.data, ['productCode', 'description', 'receivedQuantity', 'unit', 'receivedUnitValue']);
    if (!body.productCode || !String(body.productCode).trim()) return badRequest('Código do produto obrigatório.', 'INVALID_PRODUCT_CODE');
    if (!body.description || !String(body.description).trim()) return badRequest('Descrição obrigatória.', 'INVALID_DESCRIPTION');
    if (body.receivedQuantity !== undefined && body.receivedQuantity !== null) {
      const qty = Number(body.receivedQuantity);
      if (!Number.isFinite(qty) || qty <= 0) return badRequest('Quantidade deve ser positiva.', 'INVALID_QUANTITY');
      body.receivedQuantity = qty;
    } else {
      return badRequest('Quantidade obrigatória.', 'INVALID_QUANTITY');
    }
    if (!body.unit || !String(body.unit).trim()) return badRequest('Unidade obrigatória.', 'INVALID_UNIT');
    if (body.receivedUnitValue !== undefined && body.receivedUnitValue !== null) {
      const uv = Number(body.receivedUnitValue);
      if (!Number.isFinite(uv) || uv < 0) return badRequest('Valor unitário inválido.', 'INVALID_VALUE');
    }
    body.productCode = String(body.productCode).trim();
    body.description = String(body.description).trim();
    body.unit = String(body.unit).trim();

    const payload = await service.updateReceivedStock(receiptId, body, caller, accessToken);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
