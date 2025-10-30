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
        operations.OperationHash as id,
        operations.OperationName as operationName,
        max(operations.Timestamp) as timestamp,
        operations.OperationType as operationType,
        anyLast(operations.OperationContent) as operationContent,
        rm.ClientName as clientName,
        rm.ClientVersion as clientVersion,
        min(lm.MinDuration) as minDurationMs,
        max(lm.MaxDuration) as maxDurationMs,
        round(sum(lm.Sum) / sum(lm.Count), 2) as avgDurationMs,
        max(rm.TotalRequests) as totalRequests,
        max(rm.TotalErrors) as totalErrors
      FROM cosmo.gql_metrics_operations operations
      INNER JOIN cosmo.operation_latency_metrics_5_30 lm
      ON operations.OperationHash = lm.OperationHash
      INNER JOIN cosmo.operation_request_metrics_5_30 rm
      ON operations.OperationHash = rm.OperationHash
      AND operations.OrganizationID = lm.OrganizationID
      AND operations.FederatedGraphID = lm.FederatedGraphID
      AND operations.OrganizationID = rm.OrganizationID
      AND operations.FederatedGraphID = rm.FederatedGraphID
      WHERE operations.OrganizationID = '${organizationId}'
      AND operations.FederatedGraphID = '${graphId}'
      AND operations.OperationHash = '${operationId}'
      GROUP BY
        operations.OperationHash,
        operations.OperationName,
        operations.OperationType,
        rm.ClientName,
        rm.ClientVersion`;

    const result = await this.client.queryPromise<{
      id: string;
      operationName: string;
      timestamp: string;
      operationType: string;
      operationContent: string;
      clientName: string;
      clientVersion: string;
      minDurationMs: number;
      maxDurationMs: number;
      avgDurationMs: number;
      totalRequests: string;
      totalErrors: string;
    }>(query, { organizationId, graphId, operationId });

    const firstResult = result[0];

    return {
      detail: firstResult
        ? {
            ...firstResult,
            totalRequests: BigInt(firstResult.totalRequests),
            totalErrors: BigInt(firstResult.totalErrors),
          }
        : undefined,
    };
  }
}
