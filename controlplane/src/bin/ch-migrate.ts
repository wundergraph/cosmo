import 'dotenv/config';
import { execa } from 'execa';

const CLICKHOUSE_DSN = process.env.CLICKHOUSE_MIGRATION_DSN || process.env.CLICKHOUSE_DSN;

if (!CLICKHOUSE_DSN) {
  throw new Error('CLICKHOUSE_DSN environment variable is not set or empty');
}

console.log(`Migrating ClickHouse database`);

try {
  const { stdout } = await execa('dbmate', [
    '--wait',
    '--wait-timeout',
    '30s',
    '-u',
    CLICKHOUSE_DSN,
    '--no-dump-schema',
    '-d',
    'clickhouse/migrations',
    'up',
  ]);
  console.log(stdout);
  console.log(`ClickHouse database migrated`);
} catch (error: any) {
  console.error(`ClickHouse database migration failed\n`);
  console.error(error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
