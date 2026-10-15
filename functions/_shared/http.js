const BODY_SIZE_LIMIT = 10 * 1024;

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: API_HEADERS,
  });
}

export function errorResponse(message, status = 500, code = 'internal_error', extra) {
  const body = { code, error: message };
  if (extra) Object.assign(body, extra);
  return jsonResponse(body, status);
}

export function methodNotAllowed() {
  return errorResponse('Method not allowed.', 405, 'METHOD_NOT_ALLOWED');
}

export function notFound(message = 'Not found.') {
  return errorResponse(message, 404, 'NOT_FOUND');
}

export function badRequest(message = 'Requisição inválida.', code = 'BAD_REQUEST') {
  return errorResponse(message, 400, code);
}

export function unsupportedMediaType(message = 'Tipo de mídia não suportado.', code = 'UNSUPPORTED_MEDIA_TYPE') {
  return errorResponse(message, 415, code);
}

export function requestEntityTooLarge(message = 'Corpo da requisição excede o limite permitido.', code = 'PAYLOAD_TOO_LARGE') {
  return errorResponse(message, 413, code);
}

export async function readBodyJson(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function readJsonPayload(request, maxBytes = BODY_SIZE_LIMIT) {
  if (!request.body) return { ok: true, data: {}, isEmpty: true };
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, data: null, isEmpty: false, errorCode: 'MALFORMED_JSON', errorMessage: 'Corpo da requisição inválido.' };
  }
  if (text.length === 0) return { ok: true, data: {}, isEmpty: true };
  const actualBytes = new TextEncoder().encode(text).length;
  if (actualBytes > maxBytes) {
    return { ok: false, data: null, isEmpty: false, errorCode: 'PAYLOAD_TOO_LARGE', errorMessage: 'Corpo da requisição excede o limite permitido.' };
  }
  try {
    const data = JSON.parse(text);
    return { ok: true, data, isEmpty: false };
  } catch {
    return { ok: false, data: null, isEmpty: false, errorCode: 'MALFORMED_JSON', errorMessage: 'Corpo da requisição inválido.' };
  }
}

export function requireJsonContentType(request) {
  const contentType = request.headers.get('Content-Type') || '';
  const baseType = contentType.split(';')[0].trim().toLowerCase();
  return baseType === 'application/json';
}

export function checkBodySize(request) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > BODY_SIZE_LIMIT) {
    return { tooLarge: true };
  }
  return { tooLarge: false };
}

export function extractBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export { BODY_SIZE_LIMIT };
