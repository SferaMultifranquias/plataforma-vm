import { jsonResponse, methodNotAllowed } from '../_shared/http.js';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') return methodNotAllowed();

  return jsonResponse({ ok: true, hora: new Date().toISOString() });
}
