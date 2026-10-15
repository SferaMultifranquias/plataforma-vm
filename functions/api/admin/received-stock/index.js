import { jsonResponse, errorResponse, methodNotAllowed, extractBearerToken } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    await service.assertActiveAdmin(accessToken);

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await service.listReceivedStock(query);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
