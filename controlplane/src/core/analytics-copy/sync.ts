import { pipeline } from 'node:stream/promises';
import type postgres from 'postgres';
import { copiedColumns, resolvePolicy, type AnalyticsCopyPolicy } from './policy.js';

/** The schema in the analytics database that readers query. */
export const ANALYTICS_SCHEMA = 'analytics';
/** The role that may read the analytics schema. The read-only login user is a member of it. */
export const ANALYTICS_READER_ROLE = 'analytics_reader';

const SOURCE_SCHEMA = 'public';
const STAGING_SCHEMA = 'analytics_staging';
// Any fixed number works. It stops two sync runs from writing the analytics database at the same time.
const SYNC_LOCK_ID = 7_364_190_201;

export interface AnalyticsCopyLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface SyncAnalyticsCopyOptions {
  /** The controlplane database. It is only read, in one read-only transaction. */
  source: postgres.Sql;
  /** The analytics database. The `analytics` schema in it is replaced on every run. */
  target: postgres.Sql;
  /** The policy keyed by database names. Defaults to the resolved `analyticsCopyPolicy`. */
  policy?: AnalyticsCopyPolicy;
  /**
   * The shared login that may only read the analytics schema. It is created with this password when it does not
   * exist yet. An existing user keeps its password; to rotate it, change it with `ALTER ROLE ... PASSWORD` or drop
   * the user and let the next run create it again.
   */
  readonlyUser?: { name: string; password: string };
  logger?: AnalyticsCopyLogger;
}

export interface SyncAnalyticsCopyResult {
  snapshotAt: Date;
  tables: { name: string; rows: number }[];
  /** Source columns that the policy does not mention. They are not copied. */
  unclassifiedColumns: string[];
  /** Whether this run created the read-only user. */
  readonlyUserCreated: boolean;
}

interface SourceColumn {
  tableName: string;
  columnName: string;
  columnType: string;
  notNull: boolean;
}

interface SourceIndex {
  tableName: string;
  isPrimary: boolean;
  columns: string[];
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Replaces the `analytics` schema of the target database with a fresh copy of the source database.
 * Only the columns that the policy labels `copy` are read from the source.
 *
 * All source tables are read in one repeatable-read transaction, so the copy is a consistent snapshot.
 * The target is rebuilt in one transaction, so readers see either the old or the new copy, never a mix.
 */
export async function syncAnalyticsCopy(options: SyncAnalyticsCopyOptions): Promise<SyncAnalyticsCopyResult> {
  const { source, target, readonlyUser, logger = console } = options;
  const policy = options.policy ?? resolvePolicy();
  const plan = copiedColumns(policy);
  const tableNames = [...plan.keys()];

  return await source.begin('isolation level repeatable read read only', async (src) => {
    const [{ snapshotAt }] = await src<{ snapshotAt: Date }[]>`SELECT now() AS "snapshotAt"`;

    const sourceColumns = await src<SourceColumn[]>`
      SELECT c.relname AS "tableName",
             a.attname AS "columnName",
             a.attnotnull AS "notNull",
             CASE
               -- Enum types are not created in the analytics database. Their values are copied as text.
               WHEN t.typtype = 'e' THEN 'text'
               WHEN t.typcategory = 'A' AND et.typtype = 'e' THEN 'text[]'
               ELSE format_type(a.atttypid, a.atttypmod)
             END AS "columnType"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_type et ON et.oid = t.typelem
      WHERE n.nspname = ${SOURCE_SCHEMA}
        AND c.relkind IN ('r', 'p')
        AND c.relname = ANY(${tableNames})
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`;

    const sourceIndexes = await src<SourceIndex[]>`
      SELECT c.relname AS "tableName",
             i.indisprimary AS "isPrimary",
             array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE n.nspname = ${SOURCE_SCHEMA}
        AND c.relname = ANY(${tableNames})
        AND am.amname = 'btree'
        AND i.indexprs IS NULL
        AND i.indpred IS NULL
      GROUP BY i.indexrelid, c.relname, i.indisprimary`;

    const columnsByTable = new Map<string, Map<string, SourceColumn>>();
    for (const column of sourceColumns) {
      const columns = columnsByTable.get(column.tableName) ?? new Map<string, SourceColumn>();
      columns.set(column.columnName, column);
      columnsByTable.set(column.tableName, columns);
    }

    // The policy must match the source. A missing table or column means the policy and the
    // database schema have drifted apart, so stop instead of copying a partial snapshot.
    const missing: string[] = [];
    for (const [table, columns] of plan) {
      const existing = columnsByTable.get(table);
      if (!existing) {
        missing.push(table);
        continue;
      }
      for (const column of columns) {
        if (!existing.has(column)) {
          missing.push(`${table}.${column}`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`The analytics copy policy names tables or columns that the source lacks: ${missing.join(', ')}`);
    }

    const unclassifiedColumns: string[] = [];
    for (const [table, columns] of columnsByTable) {
      for (const column of columns.keys()) {
        if (!(column in (policy[table] ?? {}))) {
          unclassifiedColumns.push(`${table}.${column}`);
        }
      }
    }
    if (unclassifiedColumns.length > 0) {
      logger.warn(`Not copying columns that the policy does not classify: ${unclassifiedColumns.join(', ')}`);
    }

    return await target.begin(async (dst) => {
      const [{ locked }] = await dst<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_ID}) AS locked`;
      if (!locked) {
        throw new Error('Another analytics sync is writing the analytics database');
      }

      await dst.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(STAGING_SCHEMA)} CASCADE`);
      await dst.unsafe(`CREATE SCHEMA ${quoteIdent(STAGING_SCHEMA)}`);

      const tables: SyncAnalyticsCopyResult['tables'] = [];
      for (const [table, columns] of plan) {
        const sourceTable = columnsByTable.get(table)!;
        const qualifiedTarget = `${quoteIdent(STAGING_SCHEMA)}.${quoteIdent(table)}`;
        const columnList = columns.map((c) => quoteIdent(c)).join(', ');
        const columnDefinitions = columns.map((c) => {
          const { columnType, notNull } = sourceTable.get(c)!;
          return `${quoteIdent(c)} ${columnType}${notNull ? ' NOT NULL' : ''}`;
        });

        await dst.unsafe(`CREATE TABLE ${qualifiedTarget} (${columnDefinitions.join(', ')})`);

        const readable = await src
          .unsafe(`COPY (SELECT ${columnList} FROM ${quoteIdent(SOURCE_SCHEMA)}.${quoteIdent(table)}) TO STDOUT`)
          .readable();
        const writable = await dst.unsafe(`COPY ${qualifiedTarget} (${columnList}) FROM STDIN`).writable();
        await pipeline(readable, writable);

        // Recreate the primary key and plain btree indexes whose columns were all copied, so joins stay fast.
        const indexed = new Set<string>();
        for (const index of sourceIndexes.filter((i) => i.tableName === table)) {
          const key = index.columns.join(',');
          if (indexed.has(key) || !index.columns.every((c) => columns.includes(c))) {
            continue;
          }
          indexed.add(key);
          const indexColumns = index.columns.map((c) => quoteIdent(c)).join(', ');
          await dst.unsafe(
            index.isPrimary
              ? `ALTER TABLE ${qualifiedTarget} ADD PRIMARY KEY (${indexColumns})`
              : `CREATE INDEX ON ${qualifiedTarget} (${indexColumns})`,
          );
        }

        const [{ rows }] = await dst.unsafe<{ rows: number }[]>(`SELECT count(*)::int AS rows FROM ${qualifiedTarget}`);
        tables.push({ name: table, rows });
        logger.info(`Copied ${rows} rows of ${table}`);
      }

      await dst.unsafe(
        `CREATE TABLE ${quoteIdent(STAGING_SCHEMA)}.sync_info (snapshot_at timestamptz NOT NULL, finished_at timestamptz NOT NULL)`,
      );
      await dst`INSERT INTO ${dst(STAGING_SCHEMA)}.sync_info (snapshot_at, finished_at) VALUES (${snapshotAt}, clock_timestamp())`;

      await dst.unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ANALYTICS_READER_ROLE}') THEN
            CREATE ROLE ${quoteIdent(ANALYTICS_READER_ROLE)} NOLOGIN;
          END IF;
        END
        $$`);
      await dst.unsafe(`GRANT USAGE ON SCHEMA ${quoteIdent(STAGING_SCHEMA)} TO ${quoteIdent(ANALYTICS_READER_ROLE)}`);
      await dst.unsafe(
        `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(STAGING_SCHEMA)} TO ${quoteIdent(ANALYTICS_READER_ROLE)}`,
      );

      let readonlyUserCreated = false;
      if (readonlyUser) {
        const user = quoteIdent(readonlyUser.name);
        const [exists] = await dst`SELECT 1 FROM pg_roles WHERE rolname = ${readonlyUser.name}`;
        if (!exists) {
          // CREATE ROLE takes no bind parameters, so let the server quote the name and the password.
          const [{ statement }] = await dst<{ statement: string }[]>`
            SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${readonlyUser.name}::text, ${readonlyUser.password}::text) AS statement`;
          await dst.unsafe(statement);
          readonlyUserCreated = true;
          logger.info(`Created the read-only user ${readonlyUser.name}`);
        }
        await dst.unsafe(`GRANT ${quoteIdent(ANALYTICS_READER_ROLE)} TO ${user}`);
        // Every session of the shared user is read-only and finds the copied tables without a schema prefix.
        await dst.unsafe(`ALTER ROLE ${user} SET default_transaction_read_only = on`);
        await dst.unsafe(`ALTER ROLE ${user} SET search_path = ${quoteIdent(ANALYTICS_SCHEMA)}`);
      }

      // Swap the new copy in. Dropping the old schema waits for running queries, so do not wait forever.
      // CASCADE also drops views that readers created in the analytics schema; they belong in their own schema.
      await dst.unsafe(`SET LOCAL lock_timeout = '60s'`);
      await dst.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(ANALYTICS_SCHEMA)} CASCADE`);
      await dst.unsafe(`ALTER SCHEMA ${quoteIdent(STAGING_SCHEMA)} RENAME TO ${quoteIdent(ANALYTICS_SCHEMA)}`);

      return { snapshotAt, tables, unclassifiedColumns, readonlyUserCreated };
    });
  });
}
