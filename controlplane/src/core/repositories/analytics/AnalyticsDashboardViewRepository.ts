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
import { padMissingDatesForCurrentWeek } from './util.js';

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
      FROM ${this.client.database}.operation_request_metrics_5_30_mv
      WHERE Timestamp >= toDate(now()) - interval 6 day
        AND FederatedGraphID = '${federatedGraphId}'
        AND OrganizationID = '${organizationId}'
      GROUP BY timestamp
      ORDER BY
        timestamp WITH FILL
      FROM
        toStartOfInterval(NOW() - interval 6 day, INTERVAL 1 DAY, 'UTC') TO NOW() STEP toIntervalDay(1)
    )
    `;

    const seriesRes = await this.client.queryPromise(query);

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
    const query = `
     WITH
        toStartOfInterval(toDateTime('${filter.dateRange.start}'), INTERVAL ${filter.granule} MINUTE) AS startDate,
        toDateTime('${filter.dateRange.end}') AS endDate
    SELECT toString(toUnixTimestamp(timestamp, 'UTC') * 1000) as timestamp, totalRequests, erroredRequests
      FROM (
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${filter.granule} MINUTE) AS timestamp,
        sum(TotalRequests) as totalRequests,
        sum(TotalErrors) as erroredRequests
      FROM ${this.client.database}.operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND FederatedGraphID = '${federatedGraphId}'
        AND OrganizationID = '${organizationId}'
      GROUP BY timestamp
      ORDER BY
        timestamp WITH FILL
      FROM
        toStartOfInterval(toDateTime('${filter.dateRange.start}'), INTERVAL ${filter.granule} MINUTE)
        TO
          toDateTime('${filter.dateRange.end}')
        STEP INTERVAL ${filter.granule} MINUTE
      )
    `;

    const seriesRes = await this.client.queryPromise(query);

    if (Array.isArray(seriesRes)) {
      return seriesRes.map((p) => ({
        timestamp: p.timestamp,
        totalRequests: Number(p.totalRequests),
        erroredRequests: Number(p.erroredRequests),
      }));
    }

    return [];
  }

  private async getAllWeeklyRequestSeries(
    organizationId: string,
  ): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    const query = `
        SELECT
          toString(toUnixTimestamp(toDate(toStartOfDay(Timestamp))) * 1000) as timestamp,
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as erroredRequests,
          FederatedGraphID as graphId
        FROM ${this.client.database}.operation_request_metrics_5_30_mv
        WHERE Timestamp >= toDate(now()) - interval 6 day
          AND OrganizationID = '${organizationId}'
        GROUP BY FederatedGraphID, timestamp
        ORDER BY
          timestamp DESC
    `;

    const seriesResWithGraphId = await this.client.queryPromise(query);

    if (Array.isArray(seriesResWithGraphId)) {
      const transformed: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

      for (const item of seriesResWithGraphId) {
        const { graphId, ...rest } = item;

        if (!transformed[graphId]) {
          transformed[graphId] = [];
        }

        transformed[graphId].push(rest);
      }

      for (const key in transformed) {
        const padded = padMissingDatesForCurrentWeek(transformed[key]);
        transformed[key] = padded;
        for (const item of padded) {
          item.totalRequests = Number(item.totalRequests);
          item.erroredRequests = Number(item.erroredRequests);
        }
      }

      return transformed;
    }

    return {};
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
    FROM ${this.client.database}.operation_request_metrics_5_30_mv
    WHERE Timestamp >= toDateTime('${dateRange.start}') 
      AND Timestamp <= toDateTime('${dateRange.end}')
      AND OrganizationID = '${organizationId}'
      AND FederatedGraphID = '${federatedGraphId}'
    GROUP BY OperationName, OperationHash ORDER BY totalRequests DESC LIMIT 10
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((r) => ({
        ...r,
        totalRequests: Number(r.totalRequests),
      }));
    }

    return [];
  }

  public getListView(organizationId: string): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    return this.getAllWeeklyRequestSeries(organizationId);
  }

  private async getFederatedGraphRates(
    federatedGraphId: string,
    organizationId: string,
    dateRange: DateRange<number>,
  ): Promise<FederatedGraphRequestRateResult[]> {
    const query = `
      SELECT
        FederatedGraphID as federatedGraphID,
        round(sum(TotalRequests) / 60, 3) AS requestRate,
        round(sum(TotalErrors) / 60, 3) AS errorRate
      FROM ${this.client.database}.operation_request_metrics_5_30_mv
      WHERE Timestamp >= toDateTime('${dateRange.start}')
      AND Timestamp <= toDateTime('${dateRange.end}')
      AND FederatedGraphID = '${federatedGraphId}'
      AND OrganizationID = '${organizationId}'
      GROUP BY FederatedGraphID
      LIMIT 1
    `;

    const res = await this.client.queryPromise(query);
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
  ): Promise<PlainMessage<FederatedGraphMetrics>> {
    const [requestRates] = await Promise.all([
      this.getFederatedGraphRates(federatedGraphId, organizationId, dateRange),
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
  ): Promise<SubgraphRequestRateResult[]> {
    const query = `
      SELECT
        SubgraphID as subgraphID,
        round(sum(TotalRequests) / 60, 3) AS requestRate,
        round(sum(TotalErrors) / 60, 3) AS errorRate
      FROM ${this.client.database}.subgraph_request_metrics_5_30_mv
      WHERE Timestamp >= toDateTime('${dateRange.start}')
        AND Timestamp <= toDateTime('${dateRange.end}')
        AND FederatedGraphID = '${federatedGraphId}'
        AND OrganizationID = '${organizationId}'
      AND SubgraphID IN (${subgraphs.map((s) => `'${s.id}'`).join(',')})
      GROUP BY SubgraphID
    `;

    const res = await this.client.queryPromise(query);
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
          from ${this.client.database}.subgraph_latency_metrics_5_30_mv
        WHERE Timestamp >= toDateTime('${dateRange.start}')
          AND Timestamp <= toDateTime('${dateRange.end}')
          AND FederatedGraphID = '${federatedGraphId}'
          AND OrganizationID = '${organizationId}'
          AND SubgraphID IN (${subgraphs.map((s) => `'${s.id}'`).join(',')})
        group by SubgraphID
        order by SubgraphID
    )
    `;

    const res = await this.client.queryPromise(query);

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
  ): Promise<PlainMessage<SubgraphMetrics>[]> {
    const [requestRates, latency] = await Promise.all([
      this.getSubgraphRates(federatedGraphId, organizationId, dateRange, subgraphs),
      this.getSubgraphLatency(federatedGraphId, organizationId, dateRange, subgraphs),
    ]);

    const metrics: PlainMessage<SubgraphMetrics>[] = [];

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
    const [requestSeries, mostRequestedOperations, subgraphMetrics, graphMetrics] = await Promise.all([
      this.getRequestSeries(federatedGraphId, organizationId, filter),
      this.getMostRequestedOperations(federatedGraphId, organizationId, filter.dateRange),
      this.getSubgraphMetricsView(federatedGraphId, organizationId, filter.dateRange, subgraphs),
      this.getFederatedGraphMetricsView(federatedGraphId, organizationId, filter.dateRange),
    ]);

    return {
      requestSeries,
      mostRequestedOperations,
      subgraphMetrics,
      federatedGraphMetrics: graphMetrics,
    };
  }
}
