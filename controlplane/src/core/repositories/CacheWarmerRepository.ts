import {
  CacheWarmerOperations,
  ClientInfo,
  Extension,
  Operation,
  OperationRequest,
  PersistedQuery,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { and, count, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { cacheWarmerOpeartions, users } from '../../db/schema.js';
import { DateRange } from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { S3RouterConfigMetadata } from '../composition/composer.js';
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
    const quantile = 0.9;

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
        func_rank(${quantile}, BucketCounts) as rank,
        func_rank_bucket_lower_index(rank, BucketCounts) as b,
        round(func_histogram_v2(
            rank,
            b,
            BucketCounts,
            anyLast(ExplicitBounds)
        ), 2) as planningTime,
      sumForEachMerge(BucketCounts) as BucketCounts
      FROM ${this.client.database}.operation_planning_metrics_5_30
      WHERE Timestamp >= startDate AND Timestamp <= endDate
      AND FederatedGraphID = '${federatedGraphId}'
      AND OrganizationID = '${organizationId}'
      AND OperationName != 'IntrospectionQuery'
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
    operationHashes,
    federatedGraphID,
    organizationID,
  }: {
    operationHashes: string[];
    federatedGraphID: string;
    organizationID: string;
  }) {
    const query = `
      SELECT 
        OperationContent as operationContent, 
        OperationHash as operationHash
      FROM ${this.client.database}.gql_metrics_operations
      WHERE OperationHash IN (${operationHashes.map((hash) => `'${hash}'`).join(',')})
      GROUP BY
        OperationContent,
        OperationHash
    `;

    const res = await this.client.queryPromise(query);

    const operationContentMap = new Map<string, string>();

    if (Array.isArray(res)) {
      for (const row of res) {
        operationContentMap.set(row.operationHash, row.operationContent);
      }
      return operationContentMap;
    }

    return operationContentMap;
  }

  public async computeCacheWarmerOperations(props: ComputeCacheWarmerOperationsProps): Promise<CacheWarmerOperations> {
    const topOperationsByPlanningTime = await this.getTopOperationsByPlanningTime(props);

    const computedOperations: Operation[] = [];
    const dbCacheWarmerOperations: DBCacheWarmerOperation[] = [];

    const manuallyAddedOperations = await this.getCacheWarmerOperations({
      organizationId: props.organizationId,
      federatedGraphId: props.federatedGraphId,
      isManuallyAdded: true,
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

    const operationHashes = topOperationsByPlanningTime.map((op) => op.operationHash);
    const operationContentMap = await this.getOperationContent({
      operationHashes,
      federatedGraphID: props.federatedGraphId,
      organizationID: props.organizationId,
    });

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

      const operationContent = operationContentMap.get(operation.operationHash);

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

  public getCacheWarmerOperations({
    organizationId,
    federatedGraphId,
    isManuallyAdded,
    limit,
    offset,
  }: {
    organizationId: string;
    federatedGraphId: string;
    isManuallyAdded?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const query = this.db
      .select({
        id: cacheWarmerOpeartions.id,
        operationName: cacheWarmerOpeartions.operationName,
        operationContent: cacheWarmerOpeartions.operationContent,
        operationPersistedID: cacheWarmerOpeartions.operationPersistedID,
        operationHash: cacheWarmerOpeartions.operationHash,
        clientName: cacheWarmerOpeartions.clientName,
        clientVersion: cacheWarmerOpeartions.clientVersion,
        planningTime: cacheWarmerOpeartions.planningTime,
        isManuallyAdded: cacheWarmerOpeartions.isManuallyAdded,
        createdAt: cacheWarmerOpeartions.createdAt,
        createdBy: users.email,
      })
      .from(cacheWarmerOpeartions)
      .leftJoin(users, eq(users.id, cacheWarmerOpeartions.createdById))
      .where(
        and(
          eq(cacheWarmerOpeartions.organizationId, organizationId),
          eq(cacheWarmerOpeartions.federatedGraphId, federatedGraphId),
          isManuallyAdded === undefined ? undefined : eq(cacheWarmerOpeartions.isManuallyAdded, isManuallyAdded),
        ),
      )
      .orderBy(desc(cacheWarmerOpeartions.planningTime));

    if (limit) {
      query.limit(limit);
    }
    if (offset) {
      query.offset(offset);
    }

    return query.execute();
  }

  public async getCacheWarmerOperationsCount({
    organizationId,
    federatedGraphId,
  }: {
    organizationId: string;
    federatedGraphId: string;
  }) {
    const operationsCount = await this.db
      .select({
        count: count(),
      })
      .from(cacheWarmerOpeartions)
      .where(
        and(
          eq(cacheWarmerOpeartions.organizationId, organizationId),
          eq(cacheWarmerOpeartions.federatedGraphId, federatedGraphId),
        ),
      )
      .execute();

    if (operationsCount.length === 0) {
      return 0;
    }

    return operationsCount[0].count;
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

  public async fetchAndUploadCacheWarmerOperations({
    blobStorage,
    federatedGraphId,
    organizationId,
    logger,
  }: {
    blobStorage: BlobStorage;
    federatedGraphId: string;
    organizationId: string;
    logger: FastifyBaseLogger;
  }) {
    const cacheWarmerRepo = new CacheWarmerRepository(this.client, this.db);
    const cacheWarmerOperations = await cacheWarmerRepo.computeCacheWarmerOperations({
      federatedGraphId,
      organizationId,
      rangeInHours: 24 * 7,
    });

    const cacheWarmerOperationsBytes = Buffer.from(cacheWarmerOperations.toJsonString(), 'utf8');
    const path = `${organizationId}/${federatedGraphId}/cache_warmup/operations.json`;
    try {
      await blobStorage.putObject<S3RouterConfigMetadata>({
        key: path,
        body: cacheWarmerOperationsBytes,
        contentType: 'application/json; charset=utf-8',
      });
    } catch (err: any) {
      logger.error(err, `Failed to upload the cache warmer operations for ${federatedGraphId} to the blob storage`);
    }
  }
}
