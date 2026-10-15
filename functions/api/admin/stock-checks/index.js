import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';
import { sanitizeObject, isValidUUID } from '../../../_shared/admin-core.js';

const STOCK_STATUSES = ['pending_check', 'in_stock', 'partial_stock', 'out_of_stock', 'needs_purchase'];

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'GET' && request.method !== 'PATCH') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    const caller = await service.assertActiveAdmin(accessToken);

    if (request.method === 'PATCH') {
      const orderItemId = String(params?.orderItemId || '').trim();
      if (!isValidUUID(orderItemId)) return badRequest('Item de pedido inválido.', 'INVALID_ITEM');

      if (!requireJsonContentType(request)) return unsupportedMediaType();
      const size = checkBodySize(request);
      if (size.tooLarge) return requestEntityTooLarge();

      const parsed = await readJsonPayload(request);
      if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

      const body = sanitizeObject(parsed.data, ['stockStatus', 'availableQuantity', 'notes']);
      if (!body.stockStatus || !STOCK_STATUSES.includes(body.stockStatus)) {
        return badRequest(`Status inválido. Use: ${STOCK_STATUSES.join(', ')}`, 'INVALID_STATUS');
      }
      if (body.availableQuantity !== undefined && body.availableQuantity !== null) {
        const qty = Number(body.availableQuantity);
        if (!Number.isFinite(qty) || qty < 0) return badRequest('Quantidade disponível inválida.', 'INVALID_QUANTITY');
        body.availableQuantity = qty;
      }
      if (body.notes !== undefined) {
        body.notes = String(body.notes).trim();
        if (body.notes.length > 500) return badRequest('Observações excedem o limite de 500 caracteres.', 'INVALID_NOTES');
      }

      const payload = await service.updateStockCheck(orderItemId, body, caller);
      return jsonResponse(payload);
    }

    // GET
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await service.listStockChecks(query);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
