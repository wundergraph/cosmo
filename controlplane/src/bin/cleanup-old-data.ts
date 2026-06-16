import 'dotenv/config';
import * as process from 'node:process';
import postgres from 'postgres';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { startOfDay, subDays } from 'date-fns';
import { asc, inArray, isNotNull, lte, Table, TableConfig, getTableName } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { getConfig } from './get-config.js';

const CUTOFF_DATE = startOfDay(subDays(new Date(), 90));
const ITEMS_PER_CHUNK = 500;
const NUMBER_OF_PARALLEL_TRANSACTIONS = 10;

const { databaseConnectionUrl, databaseTlsCa, databaseTlsCert, databaseTlsKey } = getConfig();

// Create the database connection. TLS is optional.
const connectionConfig = await buildDatabaseConnectionConfig({
  tls:
    databaseTlsCa || databaseTlsCert || databaseTlsKey
      ? {
          ca: databaseTlsCa,
          cert: databaseTlsCert,
          key: databaseTlsKey,
        }
      : undefined,
});

const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig });

try {
  const start = performance.now();

  // Retrieve the existing users from the database
  const db = drizzle(queryConnection, {
    schema: { ...schema },
    logger: false,
  });

  // Delete schema checks
  let deleteStart = performance.now();
  console.log(`Deleting schema checks created before ${CUTOFF_DATE.toDateString()}...`);
  const schemaChecksDeleted = await deleteOldDataInChunks(db, schema.schemaChecks);

  let deleteDurationInSeconds = (performance.now() - deleteStart) / 1000;
  console.log(`  ${schemaChecksDeleted} schema checks deleted in ${deleteDurationInSeconds.toFixed(3)} seconds`);

  // Delete schema versions
  deleteStart = performance.now();
  console.log(`Deleting schema versions created before ${CUTOFF_DATE.toDateString()}...`);
  const [schemaVersionsDeleted, idsOfSchemaVersionsToKeep] = await deleteOldSchemaVersions(db);

  deleteDurationInSeconds = (performance.now() - deleteStart) / 1000;
  console.log(`  ${schemaVersionsDeleted} schema versions deleted in ${deleteDurationInSeconds.toFixed(3)} seconds`);

  // Delete audit logs
  deleteStart = performance.now();
  console.log(`Deleting audit logs created before ${CUTOFF_DATE.toDateString()}...`);
  const auditLogsDeleted = await deleteOldDataInChunks(db, schema.auditLogs);

  deleteDurationInSeconds = (performance.now() - deleteStart) / 1000;
  console.log(`  ${auditLogsDeleted} audit logs deleted in ${deleteDurationInSeconds.toFixed(3)} seconds`);

  // Delete webhook deliveries
  deleteStart = performance.now();
  console.log(`Deleting webhook deliveries created before ${CUTOFF_DATE.toDateString()}...`);
  const webhookDeliveriesDeleted = await deleteOldDataInChunks(db, schema.webhookDeliveries);

  deleteDurationInSeconds = (performance.now() - deleteStart) / 1000;
  console.log(
    `  ${webhookDeliveriesDeleted} webhook deliveries deleted in ${deleteDurationInSeconds.toFixed(3)} seconds`,
  );

  // Display final duration
  const duration = (performance.now() - start) / 1000;

  console.log('');
  console.log(`Cleanup process completed successfully in ${duration.toFixed(3)} seconds`);
} catch (err) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
} finally {
  await queryConnection.end({ timeout: 1 });
}

function chunkArray<T>(data: T[], itemsPerChunk: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < data.length; i += itemsPerChunk) {
    chunks.push(data.slice(i, i + itemsPerChunk));
  }

  return chunks;
}

async function deleteOldDataInChunks(
  db: PostgresJsDatabase<typeof schema>,
  table:
    | typeof schema.schemaChecks
    | typeof schema.graphCompositions
    | typeof schema.auditLogs
    | typeof schema.webhookDeliveries,
) {
  let deleteCount = 0;
  while (true) {
    const start = performance.now();
    const currentSetOfItems = await db
      .select({ id: table.id, createdAt: table.createdAt })
      .from(table)
      .where(lte(table.createdAt, CUTOFF_DATE))
      .orderBy(asc(table.createdAt))
      .limit(ITEMS_PER_CHUNK * NUMBER_OF_PARALLEL_TRANSACTIONS)
      .execute();

    if (currentSetOfItems.length === 0) {
      break;
    }

    await Promise.all(
      chunkArray(
        currentSetOfItems.map((item) => item.id),
        ITEMS_PER_CHUNK,
      ).map((idsToDelete) => db.transaction((tx) => tx.delete(table).where(inArray(table.id, idsToDelete)).execute())),
    );

    const duration = (performance.now() - start) / 1000;
    console.log(`  ${currentSetOfItems.length} items deleted in ${duration.toFixed(3)} seconds`);

    deleteCount += currentSetOfItems.length;
    if (currentSetOfItems.length < ITEMS_PER_CHUNK * NUMBER_OF_PARALLEL_TRANSACTIONS) {
      break;
    }
  }

  return deleteCount;
}

async function getSchemaVersionIds<T extends Table<TableConfig>, C extends PgColumn>(
  db: PostgresJsDatabase<typeof schema>,
  table: T,
  columnName: keyof T,
): Promise<string[]> {
  const tableName = getTableName(table);
  console.log(`  Retrieving active schema version from the "${tableName}" table...`);

  const column = table[columnName] as C & { table: T };
  const rows = await db.selectDistinct({ schemaVersionId: column }).from(table).where(isNotNull(column)).execute();

  return rows.map((row) => row.schemaVersionId!);
}

async function getFederatedGraphsFlags(db: PostgresJsDatabase<typeof schema>) {
  const tableName = getTableName(schema.federatedGraphsToFeatureFlagSchemaVersions);
  console.log(`  Retrieving active schema version from the "${tableName}" table...`);
  const rows = await db
    .select({
      baseCompositionSchemaVersionId: schema.federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId,
      composedSchemaVersionId: schema.federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
    })
    .from(schema.federatedGraphsToFeatureFlagSchemaVersions)
    .execute();

  return [
    ...rows.map((row) => row.baseCompositionSchemaVersionId!),
    ...rows.map((row) => row.composedSchemaVersionId!),
  ];
}

async function deleteOldSchemaVersions(db: PostgresJsDatabase<typeof schema>): Promise<[number, Set<string>]> {
  // Retrieve all the existing schema versions
  console.log('  Retrieving list of existing schema versions...');
  const schemaVersions = await db
    .select({ id: schema.schemaVersion.id })
    .from(schema.schemaVersion)
    .where(lte(schema.schemaVersion.createdAt, CUTOFF_DATE))
    .execute();

  if (schemaVersions.length === 0) {
    return [0, new Set<string>()];
  }

  // Retrieve the schema versions that are still in use
  let idsOfSchemaVersionsToKeep: Set<string>;
  {
    const all: string[] = [];
    all.push(...(await getSchemaVersionIds(db, schema.proposalSubgraphs, 'currentSchemaVersionId')));
    all.push(...(await getSchemaVersionIds(db, schema.federatedGraphs, 'composedSchemaVersionId')));
    all.push(...(await getFederatedGraphsFlags(db)));
    all.push(...(await getSchemaVersionIds(db, schema.pluginImageVersions, 'schemaVersionId')));
    all.push(...(await getSchemaVersionIds(db, schema.protobufSchemaVersions, 'schemaVersionId')));
    all.push(...(await getSchemaVersionIds(db, schema.graphCompositions, 'schemaVersionId')));
    all.push(...(await getSchemaVersionIds(db, schema.graphCompositionSubgraphs, 'schemaVersionId')));
    all.push(...(await getSchemaVersionIds(db, schema.subgraphs, 'schemaVersionId')));

    idsOfSchemaVersionsToKeep = new Set(all);
  }

  // Delete the schema versions that are not in the list of active schema versions, in chunks
  let deleteCount = 0;
  while (schemaVersions.length > 0) {
    const start = performance.now();
    const setOfItemsToBeDeleted = schemaVersions
      .splice(0, ITEMS_PER_CHUNK * NUMBER_OF_PARALLEL_TRANSACTIONS)
      .map((version) => version.id)
      .filter((id) => !idsOfSchemaVersionsToKeep.has(id));

    if (setOfItemsToBeDeleted.length === 0) {
      continue;
    }

    await Promise.all(
      chunkArray(setOfItemsToBeDeleted, ITEMS_PER_CHUNK).map((idsToDelete) =>
        db.transaction((tx) =>
          tx.delete(schema.schemaVersion).where(inArray(schema.schemaVersion.id, idsToDelete)).execute(),
        ),
      ),
    );

    deleteCount += setOfItemsToBeDeleted.length;
    const duration = (performance.now() - start) / 1000;
    console.log(`  ${setOfItemsToBeDeleted.length} schema versions deleted in ${duration.toFixed(3)} seconds`);
  }

  return [deleteCount, idsOfSchemaVersionsToKeep];
}
