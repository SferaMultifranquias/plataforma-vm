import { jsonResponse, errorResponse, methodNotAllowed } from '../_shared/http.js';
import { getEnvValue } from '../_shared/env.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return methodNotAllowed();

  const supabaseUrl = getEnvValue(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL']);
  const supabaseAnonKey = getEnvValue(env, ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']);
  const viteSupabaseUrl = getEnvValue(env, ['VITE_SUPABASE_URL']);
  const viteSupabaseAnonKey = getEnvValue(env, ['VITE_SUPABASE_ANON_KEY']);

  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse('Configuracao do Supabase incompleta.', 500, 'CONFIG_INCOMPLETE', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      hasViteSupabaseUrl: Boolean(viteSupabaseUrl),
      hasViteSupabaseAnonKey: Boolean(viteSupabaseAnonKey),
    });
  }

  return jsonResponse({ supabaseUrl, supabaseAnonKey });
}
