import { ClickHouseClient } from '../../../core/clickhouse/index.js';
import { traced } from '../../tracing.js';

@traced
export class MonthlyRequestViewRepository {
  constructor(private client: ClickHouseClient) {}

  public async getMonthlyRequestCount(organizationId: string): Promise<number> {
    const query = `
        WITH
         toStartOfMonth(now()) AS startDate,
         toLastDayOfMonth(now()) AS endDate
        SELECT
          sum(RequestCount) as totalRequests
        FROM ${this.client.database}.gql_metrics_router_requests
        WHERE OrganizationID = {organizationId:String}
          AND toDate(Timestamp) >= startDate AND toDate(Timestamp) <= endDate
    `;

    const params = {
      organizationId,
    };

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res[0].totalRequests;
    }

    return Number(res);
  }

  /**
   * Requests per calendar month and graph, for the current month and the `months - 1` before it.
   * Graph IDs are returned as stored, including those of graphs that have since been deleted.
   */
  public async getMonthlyRequestCountsByGraph(
    organizationId: string,
    months: number,
  ): Promise<{ month: string; federatedGraphId: string; count: number }[]> {
    const query = `
      SELECT
        toString(toStartOfMonth(Timestamp)) AS month,
        FederatedGraphID AS federatedGraphId,
        sum(RequestCount) AS count
      FROM ${this.client.database}.gql_metrics_router_requests
      WHERE OrganizationID = {organizationId:String}
        AND toDate(Timestamp) >= addMonths(toStartOfMonth(now()), -({months:UInt8} - 1))
      GROUP BY month, federatedGraphId
      ORDER BY month, federatedGraphId
    `;
    const res = await this.client.queryPromise(query, { organizationId, months });
    if (!Array.isArray(res)) {
      return [];
    }
    return res.map((row) => ({ month: row.month, federatedGraphId: row.federatedGraphId, count: Number(row.count) }));
  }
}
