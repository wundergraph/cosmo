import { ClickHouseClient } from '../../clickhouse/index.js';

export class OperationsRepository {
  constructor(private client: ClickHouseClient) {}

  /**
   * Get operations page data
   */

  public async getOperationsPage({ organizationId, graphId }: { organizationId: string; graphId: string }) {
    const query = `
      SELECT
        OperationHash as id,
        OperationName as operationName,
        max(Timestamp) as timestamp
      FROM ${this.client.database}.gql_metrics_operations
      WHERE OrganizationID = '${organizationId}'
        AND FederatedGraphID = '${graphId}'
      GROUP BY OperationHash, OperationName
      ORDER BY timestamp DESC
    `;

    const result = await this.client.queryPromise<{
      id: string;
      operationName: string;
      timestamp: string;
    }>(query, { organizationId, graphId });

    return {
      operations: result,
    };
  }
}
