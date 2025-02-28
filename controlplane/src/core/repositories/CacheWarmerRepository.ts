import {
  CacheWarmerOperations,
  ClientInfo,
  Extension,
  Operation,
  OperationRequest,
  PersistedQuery,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { CacheWarmerOperation as ProtoCacheWarmerOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import * as schema from '../../db/schema.js';
import { cacheWarmerOperations, namespaceCacheWarmerConfig, users } from '../../db/schema.js';
import { DateRange } from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { S3RouterConfigMetadata } from '../composition/composer.js';
import { CacheWarmupOperation } from '../../db/models.js';
import { getDateRange, isoDateRangeToTimestamps } from './analytics/util.js';
import { OperationsRepository } from './OperationsRepository.js';

interface ComputeCacheWarmerOperationsProps {
  rangeInHours?: number;
  dateRange?: DateRange;
  organizationId: string;
  federatedGraphId: string;
  maxOperationsCount: number;
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
    maxOperationsCount,
  }: ComputeCacheWarmerOperationsProps) {
    const parsedDateRange = isoDateRangeToTimestamps(dateRange, rangeInHours);
    const [start, end] = getDateRange(parsedDateRange);
    const quantile = 0.9;
    const minPlanningTimeInMs = 1;

    const query = `
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        max(MaxDuration) as maxDuration,
        OperationHash as operationHash,
        OperationName as operationName,
        OperationPersistedID as operationPersistedID,
        if(ClientName = 'unknown', '', ClientName) as clientName,
        if(ClientVersion = 'missing', '', ClientVersion) as clientVersion,
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
      HAVING maxDuration >= ${minPlanningTimeInMs}
      ORDER BY planningTime DESC LIMIT ${maxOperationsCount}
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
      return res;
    }

    return [];
  }

  public async getOperationContent({
    rangeInHours,
    dateRange,
    operationHashes,
    federatedGraphID, // TODO; Update view to get operations scoped to the federated graph
    organizationID, // TODO; Update view to get operations scoped to the organization
  }: {
    rangeInHours?: number;
    dateRange?: DateRange;
    operationHashes: string[];
    federatedGraphID: string;
    organizationID: string;
  }) {
    const parsedDateRange = isoDateRangeToTimestamps(dateRange, rangeInHours);
    const [start, end] = getDateRange(parsedDateRange);

    const query = `
     WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT 
        OperationContent as operationContent, 
        OperationHash as operationHash
      FROM ${this.client.database}.gql_metrics_operations
      WHERE Timestamp >= startDate AND Timestamp <= endDate AND OperationHash IN (${operationHashes.map((hash) => `'${hash}'`).join(',')})
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
    const operationsRepo = new OperationsRepository(this.db, props.federatedGraphId);

    const computedOperations: Operation[] = [];
    const dbCacheWarmerOperations: CacheWarmupOperation[] = [];

    const manuallyAddedOperations = await this.getCacheWarmerOperations({
      organizationId: props.organizationId,
      federatedGraphId: props.federatedGraphId,
      isManuallyAdded: true,
    });

    for (const operation of manuallyAddedOperations) {
      if (operation.operationPersistedID) {
        const persistedOperation = await operationsRepo.getPersistedOperation({
          operationId: operation.operationPersistedID,
        });

        if (!persistedOperation || !persistedOperation.contents) {
          continue;
        }

        computedOperations.push(
          new Operation({
            request: new OperationRequest({
              operationName: operation.operationName || undefined,
              query: persistedOperation.contents,
              extensions: new Extension({
                persistedQuery: new PersistedQuery({
                  version: 1,
                  sha256Hash: operation.operationPersistedID,
                }),
              }),
            }),
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

    const topOperationsByPlanningTime = await this.getTopOperationsByPlanningTime({
      ...props,
      maxOperationsCount: props.maxOperationsCount - manuallyAddedOperations.length,
    });

    if (topOperationsByPlanningTime.length === 0) {
      return new CacheWarmerOperations({
        operations: computedOperations,
      });
    }

    const operationHashes = topOperationsByPlanningTime.map((op) => op.operationHash);
    const operationContentMap = await this.getOperationContent({
      operationHashes,
      federatedGraphID: props.federatedGraphId,
      organizationID: props.organizationId,
      rangeInHours: 24 * 7,
    });

    for (const operation of topOperationsByPlanningTime) {
      if (operation.operationPersistedID) {
        const persistedOperation = await operationsRepo.getPersistedOperation({
          operationId: operation.operationPersistedID,
        });

        if (!persistedOperation || !persistedOperation.contents) {
          continue;
        }

        computedOperations.push(
          new Operation({
            request: new OperationRequest({
              operationName: operation.operationName,
              query: persistedOperation.contents,
              extensions: new Extension({
                persistedQuery: new PersistedQuery({
                  version: 1,
                  sha256Hash: operation.operationPersistedID,
                }),
              }),
            }),
            client: operation.clientName
              ? new ClientInfo({
                  name: operation.clientName,
                  version: operation.clientVersion,
                })
              : undefined,
          }),
        );

        dbCacheWarmerOperations.push({
          operationName: operation.operationName,
          operationHash: operation.operationHash,
          operationContent: persistedOperation.contents,
          operationPersistedID: operation.operationPersistedID,
          clientName: operation.clientName,
          clientVersion: operation.clientVersion,
          planningTime: operation.planningTime,
          federatedGraphId: props.federatedGraphId,
          organizationId: props.organizationId,
          isManuallyAdded: false,
        });
        continue;
      }

      const operationContent = operationContentMap.get(operation.operationHash);

      if (!operationContent) {
        continue;
      }

      dbCacheWarmerOperations.push({
        operationName: operation.operationName,
        operationHash: operation.operationHash,
        operationPersistedID: operation.operationPersistedID,
        clientName: operation.clientName,
        clientVersion: operation.clientVersion,
        planningTime: operation.planningTime,
        federatedGraphId: props.federatedGraphId,
        organizationId: props.organizationId,
        operationContent,
        isManuallyAdded: false,
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
        operations: dbCacheWarmerOperations,
      });
    });

    return new CacheWarmerOperations({
      operations: computedOperations,
    });
  }

  public operationExists({
    organizationId,
    federatedGraphId,
    persistedId,
    operationContent,
    clientName,
  }: {
    organizationId: string;
    federatedGraphId: string;
    clientName?: string;
    persistedId?: string;
    operationContent?: string;
  }) {
    return this.db
      .select({
        id: cacheWarmerOperations.id,
      })
      .from(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          operationContent ? eq(cacheWarmerOperations.operationContent, operationContent) : undefined,
          persistedId ? eq(cacheWarmerOperations.operationPersistedID, persistedId) : undefined,
          clientName ? eq(cacheWarmerOperations.clientName, clientName) : undefined,
        ),
      )
      .execute()
      .then((res) => res.length > 0);
  }

  public async addCacheWarmerOperations({ operations }: { operations: CacheWarmupOperation[] }) {
    if (!operations || operations.length === 0) {
      return;
    }

    await this.db.insert(cacheWarmerOperations).values(operations);
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
        id: cacheWarmerOperations.id,
        operationName: cacheWarmerOperations.operationName,
        operationContent: cacheWarmerOperations.operationContent,
        operationPersistedID: cacheWarmerOperations.operationPersistedID,
        operationHash: cacheWarmerOperations.operationHash,
        clientName: cacheWarmerOperations.clientName,
        clientVersion: cacheWarmerOperations.clientVersion,
        planningTime: cacheWarmerOperations.planningTime,
        isManuallyAdded: cacheWarmerOperations.isManuallyAdded,
        createdAt: cacheWarmerOperations.createdAt,
        createdBy: users.email,
      })
      .from(cacheWarmerOperations)
      .leftJoin(users, eq(users.id, cacheWarmerOperations.createdById))
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          isManuallyAdded === undefined ? undefined : eq(cacheWarmerOperations.isManuallyAdded, isManuallyAdded),
        ),
      )
      .orderBy(desc(cacheWarmerOperations.planningTime));

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
    isManuallyAdded,
  }: {
    organizationId: string;
    federatedGraphId: string;
    isManuallyAdded?: boolean;
  }) {
    const operationsCount = await this.db
      .select({
        count: count(),
      })
      .from(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          isManuallyAdded === undefined ? undefined : eq(cacheWarmerOperations.isManuallyAdded, isManuallyAdded),
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
      .delete(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOperations.isManuallyAdded, false),
        ),
      );
  }

  public async fetchAndUploadCacheWarmerOperations({
    blobStorage,
    federatedGraphId,
    organizationId,
    namespaceId,
    logger,
  }: {
    blobStorage: BlobStorage;
    federatedGraphId: string;
    organizationId: string;
    namespaceId: string;
    logger: FastifyBaseLogger;
  }) {
    const cacheWarmerConfig = await this.getCacheWarmerConfig({ namespaceId });
    const cacheWarmerOperations = await this.computeCacheWarmerOperations({
      federatedGraphId,
      organizationId,
      rangeInHours: 24 * 7,
      maxOperationsCount: cacheWarmerConfig?.maxOperationsCount || 100,
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

  public async getOperationById({
    id,
    organizationId,
    federatedGraphId,
  }: {
    id: string;
    organizationId: string;
    federatedGraphId: string;
  }): Promise<ProtoCacheWarmerOperation | undefined> {
    const operations = await this.db
      .select({
        id: cacheWarmerOperations.id,
        operationName: cacheWarmerOperations.operationName,
        operationContent: cacheWarmerOperations.operationContent,
        operationPersistedID: cacheWarmerOperations.operationPersistedID,
        operationHash: cacheWarmerOperations.operationHash,
        clientName: cacheWarmerOperations.clientName,
        clientVersion: cacheWarmerOperations.clientVersion,
        planningTime: cacheWarmerOperations.planningTime,
        isManuallyAdded: cacheWarmerOperations.isManuallyAdded,
        createdAt: cacheWarmerOperations.createdAt,
        createdBy: users.email,
      })
      .from(cacheWarmerOperations)
      .leftJoin(users, eq(users.id, cacheWarmerOperations.createdById))
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOperations.id, id),
        ),
      )
      .execute();

    if (operations.length === 0) {
      return undefined;
    }
    return new ProtoCacheWarmerOperation({
      id: operations[0].id,
      operationContent: operations[0].operationContent || '',
      operationName: operations[0].operationName || '',
      operationPersistedId: operations[0].operationPersistedID || '',
      operationHash: operations[0].operationHash || '',
      clientName: operations[0].clientName || '',
      clientVersion: operations[0].clientVersion || '',
      planningTime: operations[0].planningTime || 0,
      isManuallyAdded: operations[0].isManuallyAdded,
      createdAt: operations[0].createdAt.toISOString() || '',
      createdBy: operations[0].createdBy || '',
    });
  }

  public deleteOperationById({
    id,
    organizationId,
    federatedGraphId,
  }: {
    id: string;
    organizationId: string;
    federatedGraphId: string;
  }) {
    return this.db
      .delete(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOperations.id, id),
        ),
      );
  }

  public async deleteExcessManuallyAddedOperations({
    organizationId,
    federatedGraphId,
    noOfExcessOperations,
  }: {
    organizationId: string;
    federatedGraphId: string;
    noOfExcessOperations: number;
  }) {
    const operationsIdsToDelete = await this.db
      .select({
        id: cacheWarmerOperations.id,
      })
      .from(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          eq(cacheWarmerOperations.isManuallyAdded, true),
        ),
      )
      .orderBy(asc(cacheWarmerOperations.createdAt))
      .limit(noOfExcessOperations)
      .execute();

    if (operationsIdsToDelete.length === 0) {
      return;
    }

    const ids = operationsIdsToDelete.map((op) => op.id);

    await this.db
      .delete(cacheWarmerOperations)
      .where(
        and(
          eq(cacheWarmerOperations.organizationId, organizationId),
          eq(cacheWarmerOperations.federatedGraphId, federatedGraphId),
          inArray(cacheWarmerOperations.id, ids),
        ),
      )
      .execute();
  }

  public configureCacheWarmerConfig({
    namespaceId,
    maxOperationsCount,
  }: {
    namespaceId: string;
    maxOperationsCount: number;
  }) {
    return this.db
      .insert(namespaceCacheWarmerConfig)
      .values([
        {
          namespaceId,
          maxOperationsCount,
        },
      ])
      .onConflictDoUpdate({
        target: namespaceCacheWarmerConfig.namespaceId,
        set: {
          maxOperationsCount,
        },
      })
      .execute();
  }

  public async getCacheWarmerConfig({ namespaceId }: { namespaceId: string }) {
    const config = await this.db
      .select({ maxOperationsCount: namespaceCacheWarmerConfig.maxOperationsCount })
      .from(namespaceCacheWarmerConfig)
      .where(eq(namespaceCacheWarmerConfig.namespaceId, namespaceId))
      .execute();

    if (config.length === 0) {
      return undefined;
    }
    return {
      maxOperationsCount: config[0].maxOperationsCount,
    };
  }

  public deleteCacheWarmerConfig({ namespaceId }: { namespaceId: string }) {
    return this.db
      .delete(namespaceCacheWarmerConfig)
      .where(eq(namespaceCacheWarmerConfig.namespaceId, namespaceId))
      .execute();
  }
}
