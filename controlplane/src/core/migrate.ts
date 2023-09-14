import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export async function RunMigration(databaseConnectionUrl: string) {
  const migrationConnection = postgres(databaseConnectionUrl, {
    max: 1,
    onnotice(notice) {},
  });

  await migrate(drizzle(migrationConnection), {
    migrationsFolder: 'migrations',
    migrationsTable: 'migrations',
  });

  await migrationConnection.end({
    timeout: 5,
  });
}
