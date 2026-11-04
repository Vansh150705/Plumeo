import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  APP_URL: z.string().url().default('http://localhost:3000'),
  // 32 bytes, base64 or 64 hex chars. Encrypts stored secrets (SSO client secret, webhook URLs).
  APP_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  ALLOW_SELF_SERVICE_SIGNUP: z.enum(['true', 'false']).optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('Plumeo <no-reply@localhost>'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  PASSWORD_SCRYPT_N: z.coerce.number().int().default(32768),
  // comma-separated hosts additionally allowed for chat webhooks (tests / private deployments)
  WEBHOOK_EXTRA_HOSTS: z.string().optional(),
  // allow http:// OIDC issuers (local development / tests ONLY)
  OIDC_ALLOW_INSECURE_HTTP: z.enum(['true', 'false']).optional(),
});

export type Config = ReturnType<typeof loadConfig>;

function loadConfig() {
  const env = schema.parse(process.env);
  const prod = env.NODE_ENV === 'production';
  const readKey = (): Buffer => {
    if (env.APP_ENCRYPTION_KEY) {
      const k = env.APP_ENCRYPTION_KEY;
      const key = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64');
      if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes (use: openssl rand -base64 32)');
      return key;
    }
    if (prod) throw new Error('APP_ENCRYPTION_KEY is required in production (use: openssl rand -base64 32)');
    return Buffer.alloc(32, 'plumeo-dev-key'); // development convenience only
  };
  return {
    ...env,
    isProd: prod,
    get encKey() { return readKey(); },
    allowSignup: env.ALLOW_SELF_SERVICE_SIGNUP ? env.ALLOW_SELF_SERVICE_SIGNUP === 'true' : !prod,
    oidcAllowHttp: env.OIDC_ALLOW_INSECURE_HTTP === 'true' && !prod,
    secureCookies: env.APP_URL.startsWith('https://'),
    webhookExtraHosts: (env.WEBHOOK_EXTRA_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

let cached: Config | null = null;
export function config(): Config {
  return (cached ??= loadConfig());
}
export function resetConfigForTests() { cached = null; }
