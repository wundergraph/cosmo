import {
  CacheWarmerOperations,
  ClientInfo,
  Extension,
  Operation,
  OperationRequest,
  PersistedQuery,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { cacheWarmerOpeartions } from '../../db/schema.js';
import { DateRange } from '../../types/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { getDateRange, isoDateRangeToTimestamps } from './analytics/util.js';

interface ComputeCacheWarmerOperationsProps {
  rangeInHours?: number;
  dateRange?: DateRange;
  organizationId: string;
  federatedGraphId: string;
}

interface DBCacheWarmerOperation {
  content?: string;
  hash?: string;
  name?: string;
  persistedID?: string;
  clientName?: string;
  clientVersion?: string;
  planningTime?: number;
}

export class CacheWarmerRepository {
  constructor(
    private client: ClickHouseClient,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async getTopOperationsByPlanningTime({
    rangeInHours,
    dateRange,
    organizationId,
    federatedGraphId,
  }: ComputeCacheWarmerOperationsProps) {
    const parsedDateRange = isoDateRangeToTimestamps(dateRange, rangeInHours);
    const [start, end] = getDateRange(parsedDateRange);

    const query = `
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        OperationHash as operationHash,
        OperationName as operationName,
        OperationPersistedID as operationPersistedID,
        ClientName as clientName,
        ClientVersion as clientVersion,
        MAX(MaxDuration) AS planningTime
      FROM ${this.client.database}.operation_planning_metrics_5_30
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = '${organizationId}'
        AND FederatedGraphID = '${federatedGraphId}'
      GROUP BY OperationHash, OperationName, OperationPersistedID, ClientName, ClientVersion
      ORDER BY planningTime DESC LIMIT 100
    `;

    const res: {
      operationHash: string;
      operationName: string;
      operationPersistedID: string;
      clientName: string;
      clientVersion: string;
      planningTime: number;
    }[] = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((p) => ({
        operationHash: p.operationHash,
        operationName: p.operationName,
        operationPersistedID: p.operationPersistedID,
        clientName: p.clientName,
        clientVersion: p.clientVersion,
        planningTime: p.planningTime,
      }));
    }

    return [];
  }

  public async getOperationContent({
    operationHash,
    federatedGraphID,
    organizationID,
  }: {
    operationHash: string;
    federatedGraphID: string;
    organizationID: string;
  }) {
    const query = `
      SELECT OperationContent as operationContent
      FROM ${this.client.database}.gql_metrics_operations
      WHERE OperationHash = '${operationHash}'
        AND FederatedGraphID = '${federatedGraphID}'
        AND OrganizationID = '${organizationID}'
      LIMIT 1 SETTINGS use_query_cache = true, query_cache_ttl = 2629800
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res) && res.length > 0) {
      return res[0].operationContent;
    }

    return '';
  }

  public async computeCacheWarmerOperations(props: ComputeCacheWarmerOperationsProps): Promise<CacheWarmerOperations> {
    const topOperationsByPlanningTime = await this.getTopOperationsByPlanningTime(props);

    const computedOperations: Operation[] = [];
    const dbCacheWarmerOperations: DBCacheWarmerOperation[] = [];

    const manuallyAddedOperations = await this.getManuallyAddedCacheWarmerOperations({
      organizationId: props.organizationId,
      federatedGraphId: props.federatedGraphId,
    });

    for (const operation of manuallyAddedOperations) {
      let operationRequest: OperationRequest;
      if (operation.operationPersistedID) {
        operationRequest = new OperationRequest({
          operationName: operation.operationName || undefined,
          extensions: new Extension({
            persistedQuery: new PersistedQuery({
              version: 1,
              sha256Hash: operation.operationPersistedID,
            }),
          }),
        });

        computedOperations.push(
          new Operation({
            request: operationRequest,
            client: operation.clientName
              ? new ClientInfo({
                  name: operation.clientName,
                  version: operation.clientVersion || undefined,
                })
              : undefined,
          }),
        );
      } else if (operation.operationContent) {
        computedOperations.push(
          new Operation({
            request: new OperationRequest({
              operationName: operation.operationName || undefined,
              query: operation.operationContent,
            }),
            client: operation.clientName
              ? new ClientInfo({
                  name: operation.clientName,
                  version: operation.clientVersion || undefined,
                })
              : undefined,
          }),
        );
      }
    }

    for (const operation of topOperationsByPlanningTime) {
      let operationRequest: OperationRequest;

      if (operation.operationPersistedID) {
        operationRequest = new OperationRequest({
          operationName: operation.operationName,
          extensions: new Extension({
            persistedQuery: new PersistedQuery({
              version: 1,
              sha256Hash: operation.operationPersistedID,
            }),
          }),
        });

        computedOperations.push(
          new Operation({
            request: operationRequest,
            client: operation.clientName
              ? new ClientInfo({
                  name: operation.clientName,
                  version: operation.clientVersion,
                })
              : undefined,
          }),
        );

        dbCacheWarmerOperations.push({
          name: operation.operationName,
          hash: operation.operationHash,
          persistedID: operation.operationPersistedID,
          clientName: operation.clientName,
          clientVersion: operation.clientVersion,
          planningTime: operation.planningTime,
        });
        continue;
      }

      const operationContent = await this.getOperationContent({
        operationHash: operation.operationHash,
        federatedGraphID: props.federatedGraphId,
        organizationID: props.organizationId,
      });

      if (!operationContent) {
        continue;
      }

      dbCacheWarmerOperations.push({
        content: operationContent,
        name: operation.operationName,
        hash: operation.operationHash,
        persistedID: operation.operationPersistedID,
        clientName: operation.clientName,
        clientVersion: operation.clientVersion,
        planningTime: operation.planningTime,
      });

      computedOperations.push(
        new Operation({
          request: new OperationRequest({
            operationName: operation.operationName,
            query: operationContent,
          }),
          client: operation.clientName
            ? new ClientInfo({
                name: operation.clientName,
                version: operation.clientVersion,
              })
            : undefined,
        }),
      );
    }

    await this.db.transaction(async (tx) => {
      const cacheWarmerRepo = new CacheWarmerRepository(this.client, tx);
      await cacheWarmerRepo.deleteComputedCacheWarmerOperations({
        organizationId: props.organizationId,
        federatedGraphId: props.federatedGraphId,
      });

      await cacheWarmerRepo.addCacheWarmerOperations({
        organizationId: props.organizationId,
        federatedGraphId: props.federatedGraphId,
        isManuallyAdded: false,
        operations: dbCacheWarmerOperations,
      });
    });

    return new CacheWarmerOperations({
      operations: computedOperations,
    });
  }

  public async addCacheWarmerOperations({
    organizationId,
    federatedGraphId,
    isManuallyAdded,
    operations,
    createdById,
  }: {
    organizationId: string;
    federatedGraphId: string;
    isManuallyAdded: boolean;
    operations: {
      content?: string;
      hash?: string;
      name?: string;
      persistedID?: string;
      clientName?: string;
      clientVersion?: string;
      planningTime?: number;
    }[];
    createdById?: string;
  }) {
    if (!operations || operations.length === 0) {
      return;
    }
    await this.db.insert(cacheWarmerOpeartions).values(
      operations.map((operation) => ({
        federatedGraphId,
        organizationId,
        isManuallyAdded,
        operationContent: operation.content || null,
        operationHash: operation.hash || null,
        operationName: operation.name || null,
        operationPersistedID: operation.persistedID || null,
        clientName: operation.clientName || null,
        clientVersion: operation.clientVersion || null,
        planningTime: operation.planningTime,
        createdById,
      })),
    );
  }

  public getManuallyAddedCacheWarmerOperations({
    organizationId,
    federatedGraphId,
  }: {
    organizationId: string;
    federatedGraphId: string;
  }) {
    return this.db
      .select({
        operationName: cacheWarmerOpeartions.operationName,
        operationContent: cacheWarmerOpeartions.operationContent,
        operationPersistedID: cacheWarmerOpeartions.operationPersistedID,
        clientName: cacheWarmerOpeartions.clientName,
        clientVersion: cacheWarmerOpeartions.clientVersion,
      })
      .from(cacheWarmerOpeartions)
      .where(
        and(
          eq(cacheWarmerOpeartions.organizationId, organizationId),
          eq(cacheWarmerOpeartions.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOpeartions.isManuallyAdded, true),
        ),
      );
  }

  // deleted all the computed cache warmer operations of a federated graph.
  // The manually added ones will not be deleted.
  public async deleteComputedCacheWarmerOperations({
    organizationId,
    federatedGraphId,
  }: {
    organizationId: string;
    federatedGraphId: string;
  }) {
    await this.db
      .delete(cacheWarmerOpeartions)
      .where(
        and(
          eq(cacheWarmerOpeartions.organizationId, organizationId),
          eq(cacheWarmerOpeartions.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOpeartions.isManuallyAdded, false),
        ),
      );
  }
}
