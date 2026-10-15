import { jsonResponse, errorResponse, methodNotAllowed, readJsonPayload, extractBearerToken, badRequest, unsupportedMediaType, requestEntityTooLarge, requireJsonContentType, checkBodySize } from '../../../_shared/http.js';
import { createPagesAdminService } from '../../../_shared/admin-service.js';
import { sanitizeObject } from '../../../_shared/admin-core.js';

const ALLOWED_CREATE_FIELDS = ['name', 'email', 'role', 'isActive', 'storeIds'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed();

  try {
    const service = createPagesAdminService({ env });
    const accessToken = extractBearerToken(request);
    const caller = await service.assertActiveAdmin(accessToken);

    if (request.method === 'POST') {
      if (!requireJsonContentType(request)) return unsupportedMediaType();
      const size = checkBodySize(request);
      if (size.tooLarge) return requestEntityTooLarge();

      const parsed = await readJsonPayload(request);
      if (!parsed.ok) return badRequest(parsed.errorMessage, parsed.errorCode);

      const body = sanitizeObject(parsed.data, ALLOWED_CREATE_FIELDS);
      const payload = await service.createUser(body, caller);
      return jsonResponse(payload, 201);
    }

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const payload = await service.listUsers(query);
    return jsonResponse(payload);
  } catch (error) {
    if (error.constructor?.name === 'AdminError') {
      const status = error.status || 500;
      const code = error.code || 'internal_error';
      const message = error.message || 'Erro interno.';
      const isRateLimited = status === 429 && /rate limit/i.test(String(message));
      return errorResponse(
        isRateLimited ? 'Ação temporariamente limitada. Aguarde alguns minutos e tente novamente.' : message,
        status,
        isRateLimited ? 'RATE_LIMITED' : code
      );
    }
    return errorResponse('Erro interno.', 500, 'internal_error');
  }
}
