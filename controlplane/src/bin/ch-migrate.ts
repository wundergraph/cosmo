import 'dotenv/config';

import { execSync } from 'node:child_process';

const CLICKHOUSE_DSN = process.env.CLICKHOUSE_MIGRATION_DSN || process.env.CLICKHOUSE_DSN;

if (!CLICKHOUSE_DSN) {
  throw new Error('CLICKHOUSE_DSN environment variable is not set or empty');
}

console.log(`Migrating ClickHouse database`);

const child = execSync(
  `dbmate --wait --wait-timeout 30s -u '${CLICKHOUSE_DSN}' --no-dump-schema -d clickhouse/migrations up`,
);
console.log(child.toString());

console.log(`ClickHouse database migrated`);
