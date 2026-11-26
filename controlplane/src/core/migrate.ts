import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig, DatabaseConnectionConfig } from './plugins/database.js';

// One transaction per migration, so a migration can use an enum value an earlier pending one adds.
export async function RunMigration(databaseConnectionUrl: string, opts?: DatabaseConnectionConfig) {
  const connectionConfig = await buildDatabaseConnectionConfig(opts);
  const migrationConnection = postgres(databaseConnectionUrl, {
    ...connectionConfig,
    onnotice: (_) => {},
    max: 1,
  });

  const migrations = readMigrationFiles({ migrationsFolder: 'migrations' });

  await migrationConnection`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await migrationConnection`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const [lastApplied] = await migrationConnection<{ created_at: string }[]>`
    select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1
  `;
  const lastAppliedAt = lastApplied ? Number(lastApplied.created_at) : undefined;

  for (const migration of migrations) {
    if (lastAppliedAt !== undefined && migration.folderMillis <= lastAppliedAt) {
      continue;
    }

    await migrationConnection.begin(async (tx) => {
      for (const statement of migration.sql) {
        await tx.unsafe(statement);
      }

      await tx`
        insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
        values (${migration.hash}, ${migration.folderMillis})
      `;
    });
  }

  await migrationConnection.end({
    timeout: 5,
  });
}
