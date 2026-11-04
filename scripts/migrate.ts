import { migrate } from '../server/db/migrate';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Set MIGRATION_DATABASE_URL (owner role) or DATABASE_URL'); process.exit(1); }
migrate(url).then((applied) => {
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}).catch((e) => { console.error(e.message); process.exit(1); });
