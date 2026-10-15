import { jsonResponse, errorResponse, methodNotAllowed, extractBearerToken } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env: context.env });
    const accessToken = extractBearerToken(context.request);
    const caller = await service.assertActiveAdmin(accessToken);
    const url = new URL(context.request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const users = await service.exportUsers(query, { ...caller, accessToken });
    return jsonResponse(users);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      return errorResponse(error.message || 'Erro interno.', error.status || 500, error.code || 'internal_error');
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
