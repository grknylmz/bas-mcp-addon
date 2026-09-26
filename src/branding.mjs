export const PRODUCT_NAME = 'sap-ai-dev-toolkit';
export const ENV_PREFIX = 'SAP_AI_DEV_TOOLKIT_';

const LEGACY_ENV_PREFIX = 'BAS_VSP_';

export function brandedEnvValue(env, suffix) {
  const name = suffix.startsWith(ENV_PREFIX) ? suffix.slice(ENV_PREFIX.length) : suffix;
  const currentKey = `${ENV_PREFIX}${name}`;
  const legacyKey = `${LEGACY_ENV_PREFIX}${name}`;
  return env?.[currentKey] !== undefined ? env[currentKey] : env?.[legacyKey];
}

export function withBrandedEnvironment(env = process.env) {
  const result = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX)) continue;
    const currentKey = `${ENV_PREFIX}${key.slice(LEGACY_ENV_PREFIX.length)}`;
    if (result[currentKey] === undefined) result[currentKey] = value;
  }
  return result;
}
