import { ClickHouseClient } from '../../../core/clickhouse/index.js';

export class MonthlyRequestViewRepository {
  constructor(private client: ClickHouseClient) {}

  public async getMonthlyRequestCount(organizationId: string): Promise<number> {
    const query = `
        WITH
         toStartOfMonth(now()) AS startDate,
         toLastDayOfMonth(now()) AS endDate
        SELECT
          sum(TotalRequests) as totalRequests
        FROM ${this.client.database}.operation_request_metrics_5_30_mv
        WHERE OrganizationID = '${organizationId}'
          AND toDate(Timestamp) >= startDate AND toDate(Timestamp) <= endDate
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res[0].totalRequests;
    }

    return Number(res);
  }
}
