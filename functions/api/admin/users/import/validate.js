import { jsonResponse, errorResponse, methodNotAllowed, extractBearerToken, readJsonPayload, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../../_shared/http.js';
import { createPagesAdminService } from '../../../../_shared/admin-service.js';
import { sanitizeObject } from '../../../../_shared/admin-core.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env: context.env });
    const accessToken = extractBearerToken(context.request);
    const caller = await service.assertActiveAdmin(accessToken);

    if (!requireJsonContentType(context.request)) return unsupportedMediaType();
    const size = checkBodySize(context.request);
    if (size.tooLarge) return requestEntityTooLarge();

    const parsed = await readJsonPayload(context.request);
    if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

    const body = sanitizeObject(parsed.data, ['rows']);
    const result = await service.validateImport(body.rows, caller);
    return jsonResponse(result, 200);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
