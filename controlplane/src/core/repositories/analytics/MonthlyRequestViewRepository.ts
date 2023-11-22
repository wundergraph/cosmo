import { PlainMessage } from '@bufbuild/protobuf';
import { RequestSeriesItem } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { formatISO } from 'date-fns';
import { ClickHouseClient } from '../../../core/clickhouse/index.js';
import { getDateRange, isoDateRangeToTimestamps } from './util.js';

export class MonthlyRequestViewRepository {
  constructor(private client: ClickHouseClient) {}

  public async getMonthlyRequestCount(organizationId: string): Promise<number> {
    const date = new Date();
    // first day of the month
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    // last day of the month
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const parsedDateRange = isoDateRangeToTimestamps({ start: formatISO(startDate), end: formatISO(endDate) });
    const [start, end] = getDateRange(parsedDateRange);

    const query = `
        WITH
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
          sum(TotalRequests) as totalRequests
        FROM ${this.client.database}.operation_request_metrics_5_30_mv
        WHERE OrganizationID = '${organizationId}'
          AND Timestamp >= startDate AND Timestamp <= endDate
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res[0].totalRequests;
    }

    return Number(res);
  }

  public async getMonthlyRequestSeries(organizationId: string): Promise<PlainMessage<RequestSeriesItem>[]> {
    const date = new Date();
    // first day of the month
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    // last day of the month
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const parsedDateRange = isoDateRangeToTimestamps({ start: formatISO(startDate), end: formatISO(endDate) });
    const [start, end] = getDateRange(parsedDateRange);

    const query = `
     WITH
      toDateTime('${start}') AS startDate,
      toDateTime('${end}') AS endDate
    SELECT toDate(timestamp) as timestamp, totalRequests, erroredRequests
      FROM (
      SELECT
        toStartOfDay(Timestamp) as timestamp,
        sum(TotalRequests) as totalRequests,
        sum(TotalErrors) as erroredRequests
      FROM ${this.client.database}.operation_request_metrics_5_30_mv
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = '${organizationId}'
      GROUP BY timestamp
      ORDER BY
        timestamp WITH FILL
      FROM
        toStartOfInterval(NOW() - interval 30 day, INTERVAL 1 DAY, 'UTC') TO NOW() STEP toIntervalDay(1)
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
}
