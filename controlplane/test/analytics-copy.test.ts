import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { copiedColumns, resolvePolicy } from '../src/core/analytics-copy/policy.js';
import {
  ANALYTICS_READER_ROLE,
  ANALYTICS_SCHEMA,
  syncAnalyticsCopy,
  type SyncAnalyticsCopyResult,
} from '../src/core/analytics-copy/sync.js';
import { RunMigration } from '../src/core/migrate.js';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';

const serverUrl = 'postgresql://postgres:changeme@localhost:5432';
const silent = { info: () => {}, warn: () => {} };

describe('Analytics copy sync', () => {
  let sourceDb = '';
  let targetDb = '';
  let source: postgres.Sql;
  let target: postgres.Sql;
  const readonlyUser = {
    name: `analytics_ro_${genID().toLowerCase().replaceAll('-', '_')}`,
    password: `pw-${randomUUID()}`,
  };
  // Every value that must not reach the analytics database contains this marker.
  const marker = `do-not-copy-${randomUUID()}`;

  let firstRun: SyncAnalyticsCopyResult;

  const userId = randomUUID();
  const organizationId = randomUUID();
  const namespaceId = randomUUID();

  beforeAll(async () => {
    sourceDb = await beforeAllSetup();
    targetDb = await beforeAllSetup();
    await RunMigration(`${serverUrl}/${sourceDb}`);

    source = postgres(`${serverUrl}/${sourceDb}`, { max: 1, onnotice: () => {} });
    target = postgres(`${serverUrl}/${targetDb}`, { max: 1, onnotice: () => {} });

    await source`INSERT INTO users (id, email) VALUES (${userId}, ${`${marker}@example.com`})`;
    await source`
      INSERT INTO organizations (id, name, slug, invite_code, user_id, queued_for_deletion_by, deactivation_reason)
      VALUES (${organizationId}, ${marker}, ${marker}, ${marker}, ${userId}, ${marker}, ${marker})`;
    await source`
      INSERT INTO organization_billing (organization_id, plan, stripe_customer_id)
      VALUES (${organizationId}, 'developer', 'cus_123')`;
    await source`
      INSERT INTO api_keys (user_id, organization_id, name, key, key_hash)
      VALUES (${userId}, ${organizationId}, ${marker}, ${marker}, ${`${marker}-hash`})`;
    await source`
      INSERT INTO sessions (user_id, access_token, refresh_token, id_token, idp_alias, expires_at)
      VALUES (${userId}, ${marker}, ${marker}, ${marker}, ${marker}, now())`;
    await source`
      INSERT INTO audit_logs (organization_id, organization_slug, action, audit_action, auditable_display_name,
                              target_display_name, actor_id, actor_display_name, actor_type)
      VALUES (${organizationId}, ${marker}, 'created', 'organization.created', ${marker}, ${marker}, ${userId},
              ${marker}, 'user')`;
    await source`INSERT INTO namespaces (id, name, organization_id, created_by) VALUES (${namespaceId}, ${marker}, ${organizationId}, ${userId})`;
    await source`
      INSERT INTO targets (name, type, labels, organization_id, created_by, readme, namespace_id)
      VALUES (${marker}, 'subgraph', ${[marker]}, ${organizationId}, ${userId}, ${marker}, ${namespaceId})`;

    firstRun = await syncAnalyticsCopy({ source, target, readonlyUser, logger: silent });
  });

  const copiedUserCount = async () => {
    const [{ count }] = await target`SELECT count(*)::int AS count FROM analytics.users`;
    return count as number;
  };

  afterAll(async () => {
    await source?.end({ timeout: 5 });
    await target?.end({ timeout: 5 });
    await afterAllSetup(sourceDb);
    await afterAllSetup(targetDb);
    const admin = postgres(`${serverUrl}/postgres`, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP OWNED BY "${readonlyUser.name}"`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS "${readonlyUser.name}"`);
    await admin.end({ timeout: 5 });
  });

  test('The first run copies only the columns labelled copy, with enum values as text and the primary keys of the source', async () => {
    expect(firstRun.unclassifiedColumns).toEqual([]);
    expect(firstRun.readonlyUserCreated).toBe(true);
    expect(firstRun.tables.find((t) => t.name === 'users')?.rows).toBe(1);

    const plan = copiedColumns();
    const targetColumns = await target<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = ${ANALYTICS_SCHEMA} AND table_name <> 'sync_info'`;
    for (const { table_name, column_name } of targetColumns) {
      expect(plan.get(table_name), `${table_name}.${column_name}`).toContain(column_name);
    }
    expect(new Set(targetColumns.map((c) => c.table_name))).toEqual(new Set(plan.keys()));

    // No copied row anywhere holds a value that was planted in a column that must stay behind.
    for (const table of plan.keys()) {
      const [{ leaked }] = await target.unsafe<{ leaked: number }[]>(
        `SELECT count(*)::int AS leaked FROM ${ANALYTICS_SCHEMA}."${table}" t WHERE t::text LIKE '%' || $1 || '%'`,
        [marker],
      );
      expect(leaked, table).toBe(0);
    }

    const [user] = await target`SELECT * FROM analytics.users`;
    expect(user.id).toBe(userId);
    expect(user).not.toHaveProperty('email');

    const [billing] = await target`SELECT stripe_customer_id FROM analytics.organization_billing`;
    expect(billing.stripe_customer_id).toBe('cus_123');

    // Enum values arrive as text.
    const [targetRow] = await target`SELECT type, pg_typeof(type)::text AS type_name FROM analytics.targets`;
    expect(targetRow).toEqual({ type: 'subgraph', type_name: 'text' });

    const [primaryKey] = await target`
      SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${ANALYTICS_SCHEMA} AND c.relname = 'users' AND i.indisprimary`;
    expect(primaryKey).toBeDefined();

    const [membership] =
      await target`SELECT pg_has_role(${readonlyUser.name}, ${ANALYTICS_READER_ROLE}, 'MEMBER') AS member`;
    expect(membership.member).toBe(true);
  });

  test('The read-only user can read the copied tables without a schema prefix, and cannot change or create anything', async () => {
    const reader = postgres(`postgresql://localhost:5432/${targetDb}`, {
      username: readonlyUser.name,
      password: readonlyUser.password,
      max: 1,
      onnotice: () => {},
    });
    try {
      // The search path points at the analytics schema, so no prefix is needed.
      const users = await reader`SELECT id FROM users`;
      expect(users.map((u) => u.id)).toContain(userId);

      await expect(reader`DELETE FROM users`).rejects.toThrow(/read-only transaction/);
      await expect(reader`CREATE TABLE analytics.mine (id int)`).rejects.toThrow();
      await expect(reader.begin('read write', (sql) => sql`DELETE FROM users`)).rejects.toThrow(/permission denied/);
      await expect(reader.begin('read write', (sql) => sql`CREATE TABLE public.mine (id int)`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await reader.end({ timeout: 5 });
    }
  });

  test('A second run replaces the copy, keeps the existing read-only user and removes the staging schema', async () => {
    const newUserId = randomUUID();
    await source`INSERT INTO users (id, email) VALUES (${newUserId}, ${`${marker}-2@example.com`})`;

    const result = await syncAnalyticsCopy({ source, target, readonlyUser, logger: silent });
    expect(result.readonlyUserCreated).toBe(false);

    const users = await target`SELECT id FROM analytics.users`;
    expect(users.map((u) => u.id)).toContain(newUserId);
    const [info] = await target`SELECT count(*)::int AS runs FROM analytics.sync_info`;
    expect(info.runs).toBe(1);
    const [staging] = await target`SELECT 1 FROM pg_namespace WHERE nspname = 'analytics_staging'`;
    expect(staging).toBeUndefined();
  });

  test('A run fails and leaves the copy unchanged when the policy names a column that the source lacks', async () => {
    const policy = resolvePolicy();
    policy.users = { ...policy.users, nickname: 'pii' };
    const before = await copiedUserCount();
    await source`INSERT INTO users (id, email) VALUES (${randomUUID()}, ${`${marker}-3@example.com`})`;

    await expect(syncAnalyticsCopy({ source, target, policy, logger: silent })).rejects.toThrow('users.nickname');
    expect(await copiedUserCount()).toBe(before);
  });

  test.each([
    {
      object: 'a view in another schema reads the copy',
      create: 'CREATE VIEW public.user_ids AS SELECT id FROM analytics.users',
      drop: 'DROP VIEW public.user_ids',
      name: 'public.user_ids',
    },
    {
      object: 'a table in another schema has a foreign key to the copy',
      create: 'CREATE TABLE public.user_refs (user_id uuid REFERENCES analytics.users (id))',
      drop: 'DROP TABLE public.user_refs',
      name: 'public.user_refs',
    },
    {
      object: 'a view inside the analytics schema reads the copy',
      create: 'CREATE VIEW analytics.user_ids AS SELECT id FROM analytics.users',
      drop: 'DROP VIEW analytics.user_ids',
      name: 'analytics.user_ids',
    },
  ])(
    'A run fails and leaves the copy and the dependent object unchanged when $object',
    async ({ create, drop, name }) => {
      await target.unsafe(create);
      try {
        const before = await copiedUserCount();
        await source`INSERT INTO users (id, email) VALUES (${randomUUID()}, ${`${marker}-${randomUUID()}@example.com`})`;

        await expect(syncAnalyticsCopy({ source, target, logger: silent })).rejects.toThrow(name);
        expect(await copiedUserCount()).toBe(before);
        const [{ exists }] = await target`SELECT to_regclass(${name}) IS NOT NULL AS exists`;
        expect(exists).toBe(true);
      } finally {
        await target.unsafe(drop);
      }
    },
  );

  test('A run fails and leaves the copy unchanged when the copy holds a newer snapshot than the run', async () => {
    const [{ snapshotAt }] = await target`SELECT snapshot_at AS "snapshotAt" FROM analytics.sync_info`;
    await target`UPDATE analytics.sync_info SET snapshot_at = now() + interval '1 hour'`;
    try {
      await expect(syncAnalyticsCopy({ source, target, logger: silent })).rejects.toThrow('newer snapshot');
    } finally {
      await target`UPDATE analytics.sync_info SET snapshot_at = ${snapshotAt}`;
    }
  });
});
