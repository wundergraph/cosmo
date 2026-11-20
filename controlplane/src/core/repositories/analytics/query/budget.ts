import type { ClickHouseClient } from '../../../clickhouse/index.js';
import type { ClickHouseParamValue } from '../../../clickhouse/params.js';

/**
 * How many rows `EXPLAIN ESTIMATE` expects a query to read, when that is more than `budget`; undefined when the query
 * fits. Queries on sampled data run this first, so one org's broad query can't scan every tenant's spans.
 */
export async function rowsOverBudget(
  client: ClickHouseClient,
  query: { sql: string; params: Record<string, ClickHouseParamValue> },
  budget: number,
): Promise<number | undefined> {
  const rows = await client.estimateRows(query.sql, query.params);
  return rows > budget ? rows : undefined;
}

/** A row count as the budget messages write it: "5,000,000". */
export const formatRows = (rows: number) => rows.toLocaleString('en-US');
