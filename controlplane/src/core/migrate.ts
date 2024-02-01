import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig, DatabaseConnectionConfig } from './plugins/database.js';

export async function RunMigration(databaseConnectionUrl: string, opts?: DatabaseConnectionConfig) {
  const connectionConfig = await buildDatabaseConnectionConfig(opts);
  const migrationConnection = postgres(databaseConnectionUrl, {
    ...connectionConfig,
    onnotice: (_) => {},
    max: 1,
  });

  await migrate(drizzle(migrationConnection), {
    migrationsFolder: 'migrations',
    migrationsTable: 'migrations',
  });

  await migrationConnection.end({
    timeout: 5,
  });
}
