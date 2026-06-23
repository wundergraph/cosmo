import { PlainMessage } from '@bufbuild/protobuf';
import {
  FederatedGraphMetrics,
  OperationRequestCount,
  RequestSeriesItem,
  SubgraphMetrics,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import {
  DateRange,
  FederatedGraphRequestRateResult,
  SubgraphDTO,
  SubgraphLatencyResult,
  SubgraphRequestRateResult,
  TimeFilters,
} from '../../../types/index.js';
import { traced } from '../../tracing.js';
import { ClickHouseUnavailableError } from 'src/core/errors/errors.js';

@traced
export class AnalyticsDashboardViewRepository {
  constructor(private client: ClickHouseClient) {}

  public async getWeeklyRequestSeries(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const query = `
    SELECT toDate(timestamp) as timestamp, totalRequests, erroredRequests
      FROM (
      SELECT
        toStartOfDay(Timestamp) as timestamp,
        sum(TotalRequests) as totalRequests,
        sum(TotalErrors) as erroredRequests
      FROM ${this.client.database}.operation_request_metrics_5_30
      WHERE Timestamp >= toDate(now()) - interval 6 day
        AND FederatedGraphID = {federatedGraphId:String}
        AND OrganizationID = {organizationId:String}
      GROUP BY timestamp
      ORDER BY
        timestamp WITH FILL
      FROM
        toStartOfInterval(NOW() - interval 6 day, INTERVAL 1 DAY, 'UTC') TO NOW() STEP toIntervalDay(1)
    )
    `;

    const params = {
      federatedGraphId,
      organizationId,
    };

    const seriesRes = await this.client.queryPromise(query, params);

    if (Array.isArray(seriesRes)) {
      return seriesRes.map((p) => ({
        timestamp: p.timestamp,
        totalRequests: Number(p.totalRequests),
        erroredRequests: Number(p.erroredRequests),
      }));
    }

    return [];
  }

  public async getRequestSeries(
    federatedGraphId: string,
    organizationId: string,
    filter: TimeFilters,
  ): Promise<{ series: PlainMessage<RequestSeriesItem>[]; ok: boolean }> {
    if (filter?.dateRange && filter.dateRange.start > filter.dateRange.end) {
      const tmp = filter.dateRange.start;
      filter.dateRange.start = filter.dateRange.end;
      filter.dateRange.end = tmp;
    }

    const query = `
     WITH
        toStartOfInterval(toDateTime({start:UInt32}), INTERVAL {granule:UInt32} MINUTE) AS startDate,
        toDateTime({end:UInt32}) AS endDate
    SELECT toString(toUnixTimestamp(timestamp, 'UTC') * 1000) as timestamp, totalRequests, erroredRequests
      FROM (
      SELECT
          toStartOfInterval(Timestamp, INTERVAL {granule:UInt32} MINUTE) AS timestamp,
        sum(TotalRequests) as totalRequests,
        sum(TotalErrors) as erroredRequests
      FROM ${this.client.database}.operation_request_metrics_5_30
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND FederatedGraphID = {federatedGraphId:String}
        AND OrganizationID = {organizationId:String}
      GROUP BY timestamp
      ORDER BY
        timestamp WITH FILL
      FROM
        toStartOfInterval(toDateTime({start:UInt32}), INTERVAL {granule:UInt32} MINUTE)
        TO
          toDateTime({end:UInt32})
        STEP INTERVAL {granule:UInt32} MINUTE
      )
    `;

    const params = {
      start: filter.dateRange.start,
      end: filter.dateRange.end,
      granule: filter.granule,
      federatedGraphId,
      organizationId,
    };

    const { data: seriesRes, ok } = await this.client.queryPromiseWithDefault<{
      timestamp: string;
      totalRequests: number;
      erroredRequests: number;
    }>(query, {
      params,
    });

    if (Array.isArray(seriesRes)) {
      return {
        ok,
        series: seriesRes.map((p) => ({
          timestamp: p.timestamp,
          totalRequests: Number(p.totalRequests),
          erroredRequests: Number(p.erroredRequests),
        })),
      };
    }

    return { ok, series: [] };
  }

  private async getMostRequestedOperations(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
  ): Promise<{
    operations: PlainMessage<OperationRequestCount>[];
    ok: boolean;
  }> {
    const query = `
    SELECT
      OperationHash as operationHash,
      OperationName as operationName,
      sum(TotalRequests) as totalRequests
    FROM ${this.client.database}.operation_request_metrics_5_30
    WHERE Timestamp >= toDateTime({start:UInt32}) 
      AND Timestamp <= toDateTime({end:UInt32})
      AND OrganizationID = {organizationId:String}
      AND FederatedGraphID = {federatedGraphId:String}
    GROUP BY OperationName, OperationHash ORDER BY totalRequests DESC LIMIT 10
    `;

    const params = {
      start: dateRange.start,
      end: dateRange.end,
      organizationId,
      federatedGraphId,
    };

    const { data: res, ok } = await this.client.queryPromiseWithDefault<{
      operationHash: string;
      operationName: string;
      totalRequests: string;
    }>(query, { params, defaultValue: [] });

    if (Array.isArray(res)) {
      return {
        ok,
        operations: res.map((r) => ({
          ...r,
          totalRequests: Number(r.totalRequests),
        })),
      };
    }

    return {
      ok,
      operations: [],
    };
  }

  private async getFederatedGraphRates(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    rangeInHours: number,
  ): Promise<{ rates: FederatedGraphRequestRateResult[]; ok: boolean }> {
    // to minutes
    const multiplier = rangeInHours * 60;

    const query = `
      SELECT
        FederatedGraphID as federatedGraphID,
        round(sum(TotalRequests) / {multiplier:Float64}, 3) AS requestRate,
        round(sum(TotalErrors) / {multiplier:Float64}, 3) AS errorRate
      FROM ${this.client.database}.operation_request_metrics_5_30
      WHERE Timestamp >= toDateTime({start:UInt32})
      AND Timestamp <= toDateTime({end:UInt32})
      AND FederatedGraphID = {federatedGraphId:String}
      AND OrganizationID = {organizationId:String}
      GROUP BY FederatedGraphID
      LIMIT 1
    `;

    const params = {
      start: dateRange.start,
      end: dateRange.end,
      multiplier,
      federatedGraphId,
      organizationId,
    };

    const { data: res, ok } = await this.client.queryPromiseWithDefault<{
      federatedGraphID: string;
      requestRate: number;
      errorRate: number;
    }>(query, { params, defaultValue: [] });
    if (Array.isArray(res)) {
      return {
        rates: res.map((r) => ({
          federatedGraphID: r.federatedGraphID,
          requestRate: r.requestRate,
          errorRate: r.errorRate,
        })),
        ok,
      };
    }

    return {
      rates: [],
      ok,
    };
  }

  private async getFederatedGraphMetricsView(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    rangeInHours: number,
  ): Promise<{ view: PlainMessage<FederatedGraphMetrics>; ok: boolean }> {
    const [requestRates] = await Promise.all([
      this.getFederatedGraphRates(federatedGraphId, organizationId, dateRange, rangeInHours),
    ]);

    return {
      view: {
        federatedGraphID: federatedGraphId,
        requestRate: requestRates.rates[0]?.requestRate || 0,
        errorRate: requestRates.rates[0]?.errorRate || 0,
        latency: 0,
      },
      ok: requestRates.ok,
    };
  }

  private async getSubgraphRates(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
    rangeInHours: number,
  ): Promise<{ rates: SubgraphRequestRateResult[]; ok: boolean }> {
    // to minutes
    const multiplier = rangeInHours * 60;

    // Properly escape subgraph IDs for SQL
    const escapedSubgraphIds = subgraphs.map((s) => `'${s.id.replace(/'/g, "''")}'`).join(',');

    const query = `
      SELECT
        SubgraphID as subgraphID,
        round(sum(TotalRequests) / {multiplier:Float64}, 3) AS requestRate,
        round(sum(TotalErrors) / {multiplier:Float64}, 3) AS errorRate
      FROM ${this.client.database}.subgraph_request_metrics_5_30
      WHERE Timestamp >= toDateTime({start:UInt32})
        AND Timestamp <= toDateTime({end:UInt32})
        AND FederatedGraphID = {federatedGraphId:String}
        AND OrganizationID = {organizationId:String}
      AND SubgraphID IN (${escapedSubgraphIds})
      GROUP BY SubgraphID
    `;

    const params = {
      start: dateRange.start,
      end: dateRange.end,
      multiplier,
      federatedGraphId,
      organizationId,
    };

    const { data: res, ok } = await this.client.queryPromiseWithDefault<{
      subgraphID: string;
      requestRate: number;
      errorRate: number;
    }>(query, { params, defaultValue: [] });
    if (Array.isArray(res)) {
      return {
        ok,
        rates: res.map((r) => ({
          subgraphID: r.subgraphID,
          requestRate: r.requestRate,
          errorRate: r.errorRate,
        })),
      };
    }

    return {
      ok,
      rates: [],
    };
  }

  private async getSubgraphLatency(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
  ): Promise<{ latencies: SubgraphLatencyResult[]; ok: boolean }> {
    // Properly escape subgraph IDs for SQL
    const escapedSubgraphIds = subgraphs.map((s) => `'${s.id.replace(/'/g, "''")}'`).join(',');

    const query = `
    SELECT SubgraphID as subgraphID, Latency as latency from (
      SELECT SubgraphID,
          value                                            as Latency,
          func_rank(0.95, BucketCounts)                    as rank,
          func_rank_bucket_lower_index(rank, BucketCounts) as b,
          func_histogram_v2(
                  rank,
                  b,
                  BucketCounts,
                  anyLast(ExplicitBounds)
          )                                                as value,
  
          -- Histogram aggregations
          sumForEachMerge(BucketCounts)                    as BucketCounts
          from ${this.client.database}.subgraph_latency_metrics_5_30
        WHERE Timestamp >= toDateTime({start:UInt32})
          AND Timestamp <= toDateTime({end:UInt32})
          AND FederatedGraphID = {federatedGraphId:String}
          AND OrganizationID = {organizationId:String}
          AND SubgraphID IN (${escapedSubgraphIds})
        group by SubgraphID
        order by SubgraphID
    )
    `;

    const params = {
      start: dateRange.start,
      end: dateRange.end,
      federatedGraphId,
      organizationId,
    };

    const { data: res, ok } = await this.client.queryPromiseWithDefault<{
      subgraphID: string;
      latency: number;
    }>(query, { params, defaultValue: [] });

    if (Array.isArray(res)) {
      return {
        ok,
        latencies: res.map((r) => ({
          subgraphID: r.subgraphID,
          latency: r.latency,
        })),
      };
    }

    return {
      ok,
      latencies: [],
    };
  }

  private async getSubgraphMetricsView(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
    rangeInHours: number,
  ): Promise<{ metrics: PlainMessage<SubgraphMetrics>[]; ok: boolean }> {
    const metrics: PlainMessage<SubgraphMetrics>[] = [];

    if (subgraphs.length === 0) {
      return {
        metrics: [],
        ok: true,
      };
    }

    const [requestRates, latency] = await Promise.all([
      this.getSubgraphRates(federatedGraphId, organizationId, dateRange, subgraphs, rangeInHours),
      this.getSubgraphLatency(federatedGraphId, organizationId, dateRange, subgraphs),
    ]);

    for (const subgraph of subgraphs) {
      const rate = requestRates.rates.find((r) => r.subgraphID === subgraph.id);
      const lat = latency.latencies.find((l) => l.subgraphID === subgraph.id);
      const metric: PlainMessage<SubgraphMetrics> = {
        subgraphID: subgraph.id,
        requestRate: 0,
        errorRate: 0,
        latency: 0,
      };

      if (rate) {
        metric.requestRate = rate.requestRate;
        metric.errorRate = rate.errorRate;
      }

      if (lat) {
        metric.latency = lat.latency;
      }

      metrics.push(metric);
    }

    return {
      metrics,
      ok: requestRates.ok && latency.ok,
    };
  }

  public async getView(
    federatedGraphId: string,
    organizationId: string,
    filter: TimeFilters,
    subgraphs: SubgraphDTO[],
  ) {
    // date range has the time in secs, so dividing it by 60 twice will give us the diff in hours
    const rangeInHours = (filter.dateRange.end - filter.dateRange.start) / 60 / 60;

    const [requestSeries, mostRequestedOperations, subgraphMetrics, graphMetrics] = await Promise.all([
      this.getRequestSeries(federatedGraphId, organizationId, filter),
      this.getMostRequestedOperations(federatedGraphId, organizationId, filter.dateRange),
      this.getSubgraphMetricsView(federatedGraphId, organizationId, filter.dateRange, subgraphs, rangeInHours),
      this.getFederatedGraphMetricsView(federatedGraphId, organizationId, filter.dateRange, rangeInHours),
    ]);

    return {
      requestSeries,
      mostRequestedOperations,
      subgraphMetrics,
      federatedGraphMetrics: graphMetrics,
    };
  }
}
