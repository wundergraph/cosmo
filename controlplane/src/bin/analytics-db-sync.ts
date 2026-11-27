import 'dotenv/config';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { syncAnalyticsCopy } from '../core/analytics-copy/sync.js';
import { getConfig } from './get-config.js';

// Copies the controlplane database, without PII, secrets and customer content, into the analytics database.
// See src/core/analytics-copy/policy.ts for what is copied.

const { databaseConnectionUrl, databaseTlsCa, databaseTlsCert, databaseTlsKey } = getConfig();

const analyticsDatabaseUrl = process.env.ANALYTICS_DB_URL;
if (!analyticsDatabaseUrl) {
  throw new Error('ANALYTICS_DB_URL environment variable is not set or empty');
}

const tls = (ca?: string, cert?: string, key?: string) => (ca || cert || key ? { ca, cert, key } : undefined);

const source = postgres(databaseConnectionUrl, {
  ...(await buildDatabaseConnectionConfig({ tls: tls(databaseTlsCa, databaseTlsCert, databaseTlsKey) })),
  max: 1,
});
const target = postgres(analyticsDatabaseUrl, {
  ...(await buildDatabaseConnectionConfig({
    tls: tls(process.env.ANALYTICS_DB_TLS_CA, process.env.ANALYTICS_DB_TLS_CERT, process.env.ANALYTICS_DB_TLS_KEY),
  })),
  onnotice: () => {},
  max: 1,
});

const readonlyUserName = process.env.ANALYTICS_DB_READONLY_USER;
const readonlyUserPassword = process.env.ANALYTICS_DB_READONLY_PASSWORD;
if (readonlyUserName && !readonlyUserPassword) {
  throw new Error('ANALYTICS_DB_READONLY_PASSWORD must be set together with ANALYTICS_DB_READONLY_USER');
}
const readonlyUser = readonlyUserName ? { name: readonlyUserName, password: readonlyUserPassword! } : undefined;

try {
  const start = performance.now();
  const result = await syncAnalyticsCopy({ source, target, readonlyUser });
  if (result.ok) {
    const rows = result.tables.reduce((sum, table) => sum + table.rows, 0);
    console.log(
      `Analytics copy of ${result.snapshotAt.toISOString()} finished: ${result.tables.length} tables, ${rows} rows ` +
        `in ${((performance.now() - start) / 1000).toFixed(1)} seconds`,
    );
  } else {
    console.error(`Analytics copy not replaced: ${result.error.message}`);
    process.exitCode = 1;
  }
} finally {
  await source.end({ timeout: 5 });
  await target.end({ timeout: 5 });
}
