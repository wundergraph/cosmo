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

  /**
   * Get operation detail by ID
   */
  public async getOperationDetail({
    organizationId,
    graphId,
    operationId,
  }: {
    organizationId: string;
    graphId: string;
    operationId: string;
  }) {
    const query = `
      SELECT
        OperationHash as id,
        OperationName as operationName,
        max(Timestamp) as timestamp,
        OperationType as operationType,
        anyLast(OperationContent) as operationContent
      FROM ${this.client.database}.gql_metrics_operations
      WHERE OrganizationID = '${organizationId}'
        AND FederatedGraphID = '${graphId}'
        AND OperationHash = '${operationId}'
      GROUP BY OperationHash, OperationName, OperationType
    `;

    const result = await this.client.queryPromise<{
      id: string;
      operationName: string;
      timestamp: string;
      operationType: string;
      operationContent: string;
    }>(query, { organizationId, graphId, operationId });

    const firstResult = result[0];

    return {
      detail: firstResult,
    };
  }
}
