#!/usr/bin/env node

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { BillingRepository } from '../core/repositories/BillingRepository.js';
import billingConfig from './billing.json' with { type: 'json' };
import { getConfig } from './get-config.js';

const { databaseConnectionUrl, databaseTls } = getConfig();

const config = process.argv[2]
  ? JSON.parse(readFileSync(path.resolve(process.cwd(), process.argv[2]), 'utf8'))
  : billingConfig;

const connectionConfig = await buildDatabaseConnectionConfig({
  tls: databaseTls,
});
const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig, max: 1 });

try {
  await new BillingRepository(drizzle(queryConnection, { schema })).upsertPlans(config);
  console.log('Seed completed');
} finally {
  await queryConnection.end();
}
