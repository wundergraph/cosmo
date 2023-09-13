import 'dotenv/config';

import { RunMigration } from '../core/migrate.js';

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
  throw new Error('DB_URL environment variable is not set or empty');
}

console.log(`Migrating database`);

await RunMigration(DB_URL);

console.log(`Database migrated`);
