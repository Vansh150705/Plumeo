import { createPlatformAdmin } from '../server/auth/platform';
import { closePool } from '../server/db/pool';

const [email, name, password] = [process.argv[2], process.argv[3], process.env.PLATFORM_ADMIN_PASSWORD];
if (!email || !name || !password) {
  console.error('Usage: PLATFORM_ADMIN_PASSWORD=... npm run platform:admin -- admin@example.com "Full Name"');
  process.exit(1);
}
createPlatformAdmin(email, name, password).then(async () => { console.log(`Platform admin ${email} saved.`); await closePool(); }).catch((e) => { console.error(e.message); process.exit(1); });
