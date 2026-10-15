export class EnvError extends Error {
  constructor(name) {
    super(`Variavel de ambiente obrigatoria ausente: ${name}`);
    this.name = 'EnvError';
  }
}

export function getEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (value && !/your-project-ref|your-publishable-anon-key|your-service-role-key/i.test(String(value))) {
      return value;
    }
  }
  return '';
}

export function requireEnv(env, keys, name) {
  const value = getEnvValue(env, keys);
  if (!value) throw new EnvError(name);
  return value;
}
