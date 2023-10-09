import { PlainMessage } from '@bufbuild/protobuf';
import { OperationRequestCount, RequestSeriesItem } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { padMissingDates } from './util.js';

export class AnalyticsDashboardViewRepository {
  constructor(private client: ClickHouseClient) {}

  private async getWeeklyRequestSeries(
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

  private async getAllWeeklyRequestSeries(
    organizationId: string,
  ): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    const query = `
        SELECT
          toDate(toStartOfDay(Timestamp)) as timestamp,
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
        const padded = padMissingDates(transformed[key]);
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

  private async getWeeklyMostRequested(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<OperationRequestCount>[]> {
    const query = `
        SELECT
          COALESCE(NULLIF(OperationName, ''), 'unknown')  as operationName,
          sum(TotalRequests) as totalRequests
        FROM ${this.client.database}.operation_request_metrics_5_30_mv
        WHERE toDate(Timestamp) >= toDate(now()) - interval 6 day
          AND OrganizationID = '${organizationId}'
          AND FederatedGraphID = '${federatedGraphId}'
        GROUP BY OperationName ORDER BY totalRequests DESC LIMIT 5
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

  public async getView(federatedGraphId: string, organizationId: string) {
    const [requestSeries, mostRequestedOperations] = await Promise.all([
      this.getWeeklyRequestSeries(federatedGraphId, organizationId),
      this.getWeeklyMostRequested(federatedGraphId, organizationId),
    ]);

    return {
      requestSeries,
      mostRequestedOperations,
    };
  }
}
