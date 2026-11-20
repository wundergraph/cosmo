import type { ClickHouseClient } from '../../clickhouse/index.js';
import type { ClickHouseParamValue } from '../../clickhouse/params.js';
import { traced } from '../../tracing.js';
import { formatRows, rowsOverBudget } from './query/budget.js';
import { tenantPredicate, windowPredicates } from './query/compiler.js';
import type { Window } from './query/window.js';

/**
 * The observed sampling ratio for graphs and a window: sampled operation executions ÷ operations the complete metrics
 * counted. Read from root spans alone: a batched request's operations share its trace, so they are sampled together and
 * its root counts each of them. Subscriptions are left out on both sides.
 */
@traced
export class SamplingRatioRepository {
  constructor(private client: ClickHouseClient) {}

  /** Left out, with a warning, when the root-span read would exceed the row budget; undefined without metric traffic. */
  public async observe(
    scope: { organizationId: string; graphIds: string[]; window: Window },
    rowBudget: number,
  ): Promise<{ ratio?: number; warning?: string }> {
    const database = this.client.database;
    const params: Record<string, ClickHouseParamValue> = {
      organizationId: scope.organizationId,
      graphIds: scope.graphIds,
      start: scope.window.start,
      end: scope.window.end,
    };
    const sampledSql = `SELECT sum(greatest(toUInt64OrZero(SpanAttributes['wg.operation.batching.operations_count']), 1)) FROM ${database}.span_search WHERE ${[
      tenantPredicate(),
      ...windowPredicates('Timestamp', 'TimeBucket'),
      'IsRoot',
      "OperationType != 'subscription'",
    ].join(' AND ')}`;
    const rows = await rowsOverBudget(this.client, { sql: sampledSql, params }, rowBudget);
    if (rows !== undefined) {
      return {
        warning: `observedSamplingRatio is left out: computing it would read about ${formatRows(rows)} sampled spans (limit ${formatRows(rowBudget)}). Narrow the window to get it.`,
      };
    }
    const sql = `SELECT (${sampledSql}) AS sampled, (SELECT sum(TotalRequests) FROM ${database}.operation_request_metrics_5_30 WHERE ${tenantPredicate()} AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND OperationType != 'subscription') AS total`;
    const result = await this.client.queryPromise<{ sampled: string | number; total: string | number }>(sql, params);
    const row = Array.isArray(result) ? result[0] : undefined;
    const total = Number(row?.total ?? 0);
    if (!row || total === 0) {
      return {};
    }
    return { ratio: Math.min(1, Math.round((Number(row.sampled) / total) * 10_000) / 10_000) };
  }
}
