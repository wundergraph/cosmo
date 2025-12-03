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
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
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

  private async getMostRequestedOperations(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
  ): Promise<PlainMessage<OperationRequestCount>[]> {
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

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res.map((r) => ({
        ...r,
        totalRequests: Number(r.totalRequests),
      }));
    }

    return [];
  }

  private async getFederatedGraphRates(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    rangeInHours: number,
  ): Promise<FederatedGraphRequestRateResult[]> {
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

    const res = await this.client.queryPromise(query, params);
    if (Array.isArray(res)) {
      return res.map((r) => ({
        federatedGraphID: r.federatedGraphID,
        requestRate: r.requestRate,
        errorRate: r.errorRate,
      }));
    }

    return [];
  }

  private async getFederatedGraphMetricsView(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    rangeInHours: number,
  ): Promise<PlainMessage<FederatedGraphMetrics>> {
    const [requestRates] = await Promise.all([
      this.getFederatedGraphRates(federatedGraphId, organizationId, dateRange, rangeInHours),
    ]);

    return {
      federatedGraphID: federatedGraphId,
      requestRate: requestRates[0]?.requestRate || 0,
      errorRate: requestRates[0]?.errorRate || 0,
      latency: 0,
    };
  }

  private async getSubgraphRates(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
    rangeInHours: number,
  ): Promise<SubgraphRequestRateResult[]> {
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

    const res = await this.client.queryPromise(query, params);
    if (Array.isArray(res)) {
      return res.map((r) => ({
        subgraphID: r.subgraphID,
        requestRate: r.requestRate,
        errorRate: r.errorRate,
      }));
    }

    return [];
  }

  private async getSubgraphLatency(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
  ): Promise<SubgraphLatencyResult[]> {
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

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res.map((r) => ({
        subgraphID: r.subgraphID,
        latency: r.latency,
      }));
    }

    return [];
  }

  private async getSubgraphMetricsView(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
    subgraphs: SubgraphDTO[],
    rangeInHours: number,
  ): Promise<PlainMessage<SubgraphMetrics>[]> {
    const metrics: PlainMessage<SubgraphMetrics>[] = [];

    if (subgraphs.length === 0) {
      return metrics;
    }

    const [requestRates, latency] = await Promise.all([
      this.getSubgraphRates(federatedGraphId, organizationId, dateRange, subgraphs, rangeInHours),
      this.getSubgraphLatency(federatedGraphId, organizationId, dateRange, subgraphs),
    ]);

    for (const subgraph of subgraphs) {
      const rate = requestRates.find((r) => r.subgraphID === subgraph.id);
      const lat = latency.find((l) => l.subgraphID === subgraph.id);
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

    return metrics;
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
