import 'dotenv/config';
import { closeDb, getDb, getDbMode } from './db.ts';

async function main() {
  console.log('[Migrate] Menjalankan Drizzle PostgreSQL migrations...');
  await getDb();
  console.log(`[Migrate] Selesai. Mode database: ${getDbMode()}`);
  await closeDb();
}

main().catch((err) => {
  console.error('[Migrate] Gagal:', err);
  process.exit(1);
});
