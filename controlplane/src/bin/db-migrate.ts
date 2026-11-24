import 'dotenv/config';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { RunMigration } from '../core/migrate.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { BillingRepository } from '../core/repositories/BillingRepository.js';
import * as schema from '../db/schema.js';
import billingConfig from './billing.json' with { type: 'json' };
import { getConfig } from './get-config.js';

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
  throw new Error('DB_URL environment variable is not set or empty');
}

const connectionConfig = { tls: getConfig().databaseTls };

console.log(`Migrating database`);

await RunMigration(DB_URL, connectionConfig);

console.log(`Database migrated`);

/**
 * Only WunderGraph Cloud sets this. Self-hosted installs have no billing, and billing.json holds Cloud's plans.
 */
if (process.env.SEED_BILLING_PLANS === 'true') {
  console.log(`Syncing billing plans`);

  const queryConnection = postgres(DB_URL, { ...(await buildDatabaseConnectionConfig(connectionConfig)), max: 1 });

  try {
    await new BillingRepository(drizzle(queryConnection, { schema })).upsertPlans(billingConfig);
  } finally {
    await queryConnection.end({ timeout: 5 });
  }

  console.log(`Billing plans synced`);
}
