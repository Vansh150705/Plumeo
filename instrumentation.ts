/** Fail fast at boot: refuse to start a misconfigured production server instead of failing on the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { config } = await import('./server/core/config');
  const c = config();
  void c.encKey;
  if (c.isProd && !c.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
}
