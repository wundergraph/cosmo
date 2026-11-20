import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Each `_v2` table is filled alongside its original until it holds a full TTL window, then replaces it.
// Until then both must hold the same rows: same view query, same columns, engine and TTL, and a sort key
// that reorders the original's columns (in Summing/AggregatingMergeTree the key decides which rows merge).

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../clickhouse/migrations');
const files = readdirSync(migrationsDir);

const upSql = (name: string) => {
  const matches = files.filter((file) => file.endsWith(`_${name}.sql`));
  expect(matches).toHaveLength(1);
  const sql = readFileSync(join(migrationsDir, matches[0]), 'utf8');
  return sql.split('-- migrate:up')[1].split('-- migrate:down')[0];
};

const viewQuery = (name: string) =>
  upSql(`${name}_mv`)
    .split(/ TO \S+ AS\s/)[1]
    .trim();

const tableParts = (name: string) => {
  const sql = upSql(name);
  const definition = sql.slice(sql.indexOf('(', sql.indexOf('CREATE TABLE')));
  const [, sortKey] = definition.match(/ORDER BY \(\s*([\S\s]*?)\s*\)\nTTL/)!;
  return {
    columnsAndEngine: definition.slice(0, definition.indexOf('ORDER BY')).replace(/\n--[^\n]*/g, ''),
    sortKey: sortKey.split(',').map((column) => column.trim()),
    ttl: definition.slice(definition.indexOf('TTL')).trim(),
  };
};

// The operation tables also key on the persisted ID, so rows with different persisted IDs stop merging together.
describe.each([
  ['operation_request_metrics_5_30', ['OperationPersistedID']],
  ['operation_latency_metrics_5_30', ['OperationPersistedID']],
  ['traces_by_operation_quarter_hourly', []],
  ['traces_by_client_quarter_hourly', []],
])('%s_v2', (table, addedKeyColumns) => {
  test('is filled by the same query as the original', () => {
    expect(viewQuery(`${table}_v2`)).toBe(viewQuery(table));
  });

  test('has the same columns, engine and TTL as the original', () => {
    const original = tableParts(table);
    const v2 = tableParts(`${table}_v2`);

    expect(v2.columnsAndEngine).toBe(original.columnsAndEngine);
    expect(v2.ttl).toBe(original.ttl);
  });

  test('sorts the original key columns graph-first', () => {
    const original = tableParts(table);
    const v2 = tableParts(`${table}_v2`);

    expect(v2.sortKey.slice(0, 3)).toEqual(['FederatedGraphID', 'OrganizationID', 'toUnixTimestamp(Timestamp)']);
    expect([...v2.sortKey].sort()).toEqual([...original.sortKey, ...addedKeyColumns].sort());
  });
});
