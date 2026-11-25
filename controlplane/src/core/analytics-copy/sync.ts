import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { PassThrough, type Readable, type Writable } from 'node:stream';
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

/** A run that failed for an expected reason. The analytics database still holds the previous copy. */
export class AnalyticsCopyError extends Error {}

/** The policy names tables or columns that the source database lacks. */
export class PolicyDriftError extends AnalyticsCopyError {
  constructor(readonly missing: string[]) {
    super(`The analytics copy policy names tables or columns that the source lacks: ${missing.join(', ')}`);
  }
}

/** Another run holds the lock on the analytics database. */
export class SyncInProgressError extends AnalyticsCopyError {
  constructor() {
    super('Another analytics sync is writing the analytics database');
  }
}

/** The analytics database already holds a snapshot newer than the one this run read. */
export class NewerSnapshotError extends AnalyticsCopyError {
  constructor(
    readonly liveSnapshotAt: Date,
    readonly snapshotAt: Date,
  ) {
    super(
      `The analytics database already holds a newer snapshot (${liveSnapshotAt.toISOString()}) than this run (${snapshotAt.toISOString()})`,
    );
  }
}

/** Objects that the job did not create, such as views or foreign keys, depend on the copy. */
export class DependentObjectsError extends AnalyticsCopyError {
  constructor(readonly detail: string) {
    super(`Other objects depend on the ${ANALYTICS_SCHEMA} copy, so it was not replaced. Drop them first: ${detail}`);
  }
}

export type SyncAnalyticsCopyOutcome =
  | ({ ok: true } & SyncAnalyticsCopyResult)
  | { ok: false; error: AnalyticsCopyError };

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
 * Returns the SCRAM-SHA-256 verifier that PostgreSQL stores for a password. `CREATE ROLE` accepts the verifier in
 * place of the password, so the plaintext password never appears in SQL that the server might log.
 */
export function scramSha256Verifier(password: string): string {
  // PostgreSQL normalizes passwords with SASLprep, which leaves printable ASCII unchanged. Other characters could
  // normalize differently, so they are refused rather than producing a verifier that never matches.
  if (!/^[\u0020-\u007E]+$/.test(password)) {
    throw new Error('The read-only password must consist of printable ASCII characters');
  }
  const salt = randomBytes(16);
  const iterations = 4096;
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * Streams a source `COPY ... TO STDOUT` into a target `COPY ... FROM STDIN`.
 *
 * When the target fails, the rest of the source rows must still be read: postgres.js does not cancel a COPY whose
 * stream was closed, so the source connection would stall and its transaction could never roll back. `pipeline`
 * closes every stream it was given when one fails, so the source is piped into a relay that `pipeline` may close.
 */
async function streamCopy(readable: Readable, openWritable: () => Promise<Writable>): Promise<void> {
  const relay = new PassThrough();
  readable.on('error', (error) => relay.destroy(error));
  readable.pipe(relay);
  try {
    await pipeline(relay, await openWritable());
  } catch (error) {
    readable.unpipe(relay);
    readable.resume();
    throw error;
  }
}

/**
 * Replaces the `analytics` schema of the target database with a fresh copy of the source database.
 * Only the columns that the policy labels `copy` are read from the source.
 *
 * All source tables are read in one repeatable-read transaction, so the copy is a consistent snapshot.
 * The target is rebuilt in one transaction, so readers see either the old or the new copy, never a mix.
 *
 * Expected failures come back as `{ ok: false, error }` after both transactions have rolled back. Other errors,
 * such as a lost connection, are thrown.
 */
export async function syncAnalyticsCopy(options: SyncAnalyticsCopyOptions): Promise<SyncAnalyticsCopyOutcome> {
  try {
    return { ok: true, ...(await copySnapshot(options)) };
  } catch (error) {
    // Expected failures are thrown inside the transactions so that both roll back, and returned once they have.
    if (error instanceof AnalyticsCopyError) {
      return { ok: false, error };
    }
    throw error;
  }
}

async function copySnapshot(options: SyncAnalyticsCopyOptions): Promise<SyncAnalyticsCopyResult> {
  const { source, target, readonlyUser, logger = console } = options;
  const policy = options.policy ?? resolvePolicy();
  const plan = copiedColumns(policy);
  const tableNames = Object.keys(policy);

  return await source.begin('isolation level repeatable read read only', async (src) => {
    // COPY writes dates in the session's DateStyle. ISO dates read back the same whatever the target's DateStyle is.
    await src`SET LOCAL DateStyle = 'ISO'`;
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
    for (const [table, labels] of Object.entries(policy)) {
      const existing = columnsByTable.get(table);
      if (!existing) {
        missing.push(table);
        continue;
      }
      for (const column of Object.keys(labels)) {
        if (!existing.has(column)) {
          missing.push(`${table}.${column}`);
        }
      }
    }
    if (missing.length > 0) {
      throw new PolicyDriftError(missing);
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
        throw new SyncInProgressError();
      }
      await dst`SET LOCAL DateStyle = 'ISO'`;

      // A run that started earlier but got the lock later must not replace a newer copy with an older one.
      const [{ liveSyncInfo }] = await dst<{ liveSyncInfo: string | null }[]>`
        SELECT to_regclass(${`${quoteIdent(ANALYTICS_SCHEMA)}.sync_info`})::text AS "liveSyncInfo"`;
      if (liveSyncInfo) {
        const [live] = await dst.unsafe<{ snapshotAt: Date }[]>(
          `SELECT snapshot_at AS "snapshotAt" FROM ${liveSyncInfo}`,
        );
        if (live && live.snapshotAt > snapshotAt) {
          throw new NewerSnapshotError(live.snapshotAt, snapshotAt);
        }
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
        await streamCopy(readable, () => dst.unsafe(`COPY ${qualifiedTarget} (${columnList}) FROM STDIN`).writable());

        // Recreate the primary key and plain btree indexes whose columns were all copied, so joins stay fast.
        // The primary key comes first, so an ordinary index on the same columns cannot take its place.
        const indexes = sourceIndexes
          .filter((i) => i.tableName === table)
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
        const indexed = new Set<string>();
        for (const index of indexes) {
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

        // count(*) is a bigint, which postgres.js returns as a string.
        const [count] = await dst.unsafe<{ rows: string }[]>(`SELECT count(*) AS rows FROM ${qualifiedTarget}`);
        const rows = Number(count.rows);
        tables.push({ name: table, rows });
        logger.info(`Copied ${rows} rows of ${table}`);
      }

      await dst.unsafe(
        `CREATE TABLE ${quoteIdent(STAGING_SCHEMA)}.sync_info (snapshot_at timestamptz NOT NULL, finished_at timestamptz NOT NULL)`,
      );
      await dst`INSERT INTO ${dst(STAGING_SCHEMA)}.sync_info (snapshot_at, finished_at) VALUES (${snapshotAt}, clock_timestamp())`;

      // Creating roles needs CREATEROLE, so the reader role is only created when a read-only user is configured.
      // An existing reader role, for example one that an administrator created, always gets access to the new copy.
      const [{ readerRoleExists }] = await dst<{ readerRoleExists: boolean }[]>`
        SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = ${ANALYTICS_READER_ROLE}) AS "readerRoleExists"`;
      if (!readerRoleExists && readonlyUser) {
        await dst.unsafe(`CREATE ROLE ${quoteIdent(ANALYTICS_READER_ROLE)} NOLOGIN`);
      }
      if (readerRoleExists || readonlyUser) {
        await dst.unsafe(`GRANT USAGE ON SCHEMA ${quoteIdent(STAGING_SCHEMA)} TO ${quoteIdent(ANALYTICS_READER_ROLE)}`);
        await dst.unsafe(
          `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(STAGING_SCHEMA)} TO ${quoteIdent(ANALYTICS_READER_ROLE)}`,
        );
      }

      let readonlyUserCreated = false;
      if (readonlyUser) {
        const user = quoteIdent(readonlyUser.name);
        const [exists] = await dst`SELECT 1 FROM pg_roles WHERE rolname = ${readonlyUser.name}`;
        if (!exists) {
          // CREATE ROLE takes no bind parameters, so let the server quote the name and the password verifier.
          const [{ statement }] = await dst<{ statement: string }[]>`
            SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', ${readonlyUser.name}::text, ${scramSha256Verifier(readonlyUser.password)}::text) AS statement`;
          await dst.unsafe(statement);
          readonlyUserCreated = true;
          logger.info(`Created the read-only user ${readonlyUser.name}`);
        }
        await dst.unsafe(`GRANT ${quoteIdent(ANALYTICS_READER_ROLE)} TO ${user}`);
        // Every session of the shared user is read-only and finds the copied tables without a schema prefix.
        await dst.unsafe(`ALTER ROLE ${user} SET default_transaction_read_only = on`);
        await dst.unsafe(`ALTER ROLE ${user} SET search_path = ${quoteIdent(ANALYTICS_SCHEMA)}`);
      }

      // Swap the new copy in. Dropping the old copy waits for running queries, so do not wait forever.
      // Nothing is dropped with CASCADE: PostgreSQL refuses the drop while any other object, such as a view or a
      // foreign key, depends on the old copy. The job therefore never deletes an object that it did not create.
      await dst.unsafe(`SET LOCAL lock_timeout = '60s'`);
      // With an empty search path, PostgreSQL names every dependent object with its schema in the error.
      await dst.unsafe(`SET LOCAL search_path = ''`);
      const liveTables = await dst<{ name: string }[]>`
        SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = ${ANALYTICS_SCHEMA}`;
      try {
        if (liveTables.length > 0) {
          await dst.unsafe(`DROP TABLE ${liveTables.map((t) => t.name).join(', ')} RESTRICT`);
        }
        await dst.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdent(ANALYTICS_SCHEMA)} RESTRICT`);
      } catch (error) {
        const { code, detail } = error as { code?: string; detail?: string };
        // 2BP01 is dependent_objects_still_exist.
        if (code === '2BP01') {
          throw new DependentObjectsError(detail ?? '');
        }
        throw error;
      }
      await dst.unsafe(`ALTER SCHEMA ${quoteIdent(STAGING_SCHEMA)} RENAME TO ${quoteIdent(ANALYTICS_SCHEMA)}`);

      return { snapshotAt, tables, unclassifiedColumns, readonlyUserCreated };
    });
  });
}
