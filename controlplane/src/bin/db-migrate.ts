import 'dotenv/config';

import { RunMigration } from '../core/migrate.js';

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
  throw new Error('DB_URL environment variable is not set or empty');
}

console.log(`Migrating database`);

await RunMigration(DB_URL, {
  tls:
    process.env.DB_TLS_CA || process.env.DB_TLS_CERT || process.env.DB_TLS_KEY
      ? {
          ca: process.env.DB_TLS_CA,
          cert: process.env.DB_TLS_CERT,
          key: process.env.DB_TLS_KEY,
        }
      : undefined,
});

console.log(`Database migrated`);
