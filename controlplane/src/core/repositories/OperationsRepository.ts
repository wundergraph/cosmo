import { PlainMessage } from '@bufbuild/protobuf';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, desc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { federatedGraphClients, federatedGraphPersistedOperations } from '../../db/schema.js';
import { ClientDTO, PersistedOperationDTO, UpdatedPersistedOperation } from '../../types/index.js';

export class OperationsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphId: string,
  ) {}

  public async updatePersistedOperations(clientId: string, userId: string, operations: UpdatedPersistedOperation[]) {
    const now = new Date();
    const inserts: (typeof federatedGraphPersistedOperations.$inferInsert)[] = operations.map((operation) => {
      return {
        federatedGraphId: this.federatedGraphId,
        clientId,
        operationId: operation.operationId,
        hash: operation.hash,
        filePath: operation.filePath,
        createdAt: now,
        updatedAt: now,
        createdById: userId,
        operationContent: operation.contents,
        operationNames: operation.operationNames,
      };
    });

    if (inserts.length === 0) {
      return;
    }

    await this.db
      .insert(federatedGraphPersistedOperations)
      .values(inserts)
      .onConflictDoUpdate({
        target: [
          federatedGraphPersistedOperations.federatedGraphId,
          federatedGraphPersistedOperations.clientId,
          federatedGraphPersistedOperations.operationId,
        ],
        set: { updatedAt: now, updatedById: userId },
      });
  }

  public async getPersistedOperations(
    clientId: string,
    pagination?: {
      limit: number;
      offset: number;
    },
  ): Promise<PersistedOperationDTO[]> {
    const operationsResult = await this.db.query.federatedGraphPersistedOperations.findMany({
      where: and(
        eq(federatedGraphPersistedOperations.federatedGraphId, this.federatedGraphId),
        eq(federatedGraphPersistedOperations.clientId, clientId),
      ),
      with: {
        createdBy: true,
        updatedBy: true,
      },
      orderBy: desc(
        sql`coalesce(${federatedGraphPersistedOperations.updatedAt}, ${federatedGraphPersistedOperations.createdAt})`,
      ),
      offset: pagination?.offset,
      limit: pagination?.limit,
    });

    const operations: PersistedOperationDTO[] = [];

    for (const row of operationsResult) {
      operations.push({
        id: row.id,
        operationId: row.operationId,
        hash: row.hash,
        filePath: row.filePath,
        createdAt: row.createdAt.toISOString(),
        lastUpdatedAt: row?.updatedAt?.toISOString() || '',
        createdBy: row.createdBy.email,
        lastUpdatedBy: row.updatedBy?.email ?? '',
        contents: row.operationContent ?? '',
        operationNames: row.operationNames ?? [],
      });
    }
    return operations;
  }

  public async registerClient(clientName: string, userId: string): Promise<string> {
    if (!clientName) {
      throw new Error('client name is empty');
    }
    const updatedAt = new Date();
    await this.db
      .insert(federatedGraphClients)
      .values({
        federatedGraphId: this.federatedGraphId,
        name: clientName,
        updatedAt,
        createdById: userId,
      })
      .onConflictDoUpdate({
        target: [federatedGraphClients.federatedGraphId, federatedGraphClients.name],
        set: { updatedAt, updatedById: userId },
      });

    // To avoid depending on postgres, we do a second query to get the inserted client
    const result = await this.db.query.federatedGraphClients.findFirst({
      columns: { id: true },
      where: and(
        eq(federatedGraphClients.name, clientName),
        eq(federatedGraphClients.federatedGraphId, this.federatedGraphId),
      ),
    });
    return result!.id;
  }

  public async getRegisteredClients(): Promise<ClientDTO[]> {
    const fedGraphClients = await this.db.query.federatedGraphClients.findMany({
      where: eq(federatedGraphClients.federatedGraphId, this.federatedGraphId),
      with: {
        createdBy: true,
        updatedBy: true,
      },
      orderBy: desc(sql`coalesce(${federatedGraphClients.updatedAt}, ${federatedGraphClients.createdAt})`),
    });
    const clients: ClientDTO[] = [];

    for (const c of fedGraphClients) {
      clients.push({
        id: c.id,
        name: c.name,
        createdAt: c.createdAt.toISOString(),
        lastUpdatedAt: c.updatedAt?.toISOString() || '',
        createdBy: c.createdBy?.email ?? '',
        lastUpdatedBy: c.updatedBy?.email ?? '',
      });
    }

    return clients;
  }

  public createOperationOverride(data: {
    checkId: string;
    namespaceId: string;
    operationHash: string;
    actorId: string;
  }) {
    return this.db
      .insert(schema.operationOverrides)
      .values({
        schemaCheckId: data.checkId,
        namespaceId: data.namespaceId,
        hash: data.operationHash,
        createdBy: data.actorId,
      })
      .returning();
  }

  public removeOperationOverride(data: { checkId: string; operationHash: string }) {
    return this.db
      .delete(schema.operationOverrides)
      .where(
        and(
          eq(schema.operationOverrides.hash, data.operationHash),
          eq(schema.operationOverrides.schemaCheckId, data.checkId),
        ),
      )
      .returning();
  }

  public createIgnoreAllOverride(data: { namespaceId: string; operationHash: string; actorId: string }) {
    return this.db
      .insert(schema.operationIgnoreAllOverrides)
      .values({
        namespaceId: data.namespaceId,
        hash: data.operationHash,
        createdBy: data.actorId,
      })
      .returning();
  }

  public removeIgnoreAllOverride(data: { operationHash: string; namespaceId: string }) {
    return this.db
      .delete(schema.operationIgnoreAllOverrides)
      .where(
        and(
          eq(schema.operationIgnoreAllOverrides.namespaceId, data.namespaceId),
          eq(schema.operationIgnoreAllOverrides.hash, data.operationHash),
        ),
      )
      .returning();
  }

  public async hasIgnoreAllOverride(data: { operationHash: string; namespaceId: string }) {
    const res = await this.db.query.operationIgnoreAllOverrides.findFirst({
      columns: {
        id: true,
      },
      where: and(
        eq(schema.operationIgnoreAllOverrides.namespaceId, data.namespaceId),
        eq(schema.operationIgnoreAllOverrides.hash, data.operationHash),
      ),
    });

    return !!res;
  }

  public async getOperationOverrides(data: { operationHash: string }) {
    const res = await this.db
      .select({
        checkId: schema.schemaCheckChangeAction.schemaCheckId,
        createdAt: schema.operationOverrides.createdAt,
        changes: sql
          .raw(
            `json_agg(distinct jsonb_build_object(
              'changeType', ${schema.schemaCheckChangeAction.changeType.name}, 
              'path', ${schema.schemaCheckChangeAction.path.name}, 
              'message', ${schema.schemaCheckChangeAction.changeMessage.name}, 
              'isBreaking', ${schema.schemaCheckChangeAction.isBreaking.name}
            ))`,
          )
          .mapWith({
            mapFromDriverValue(value) {
              return value as PlainMessage<SchemaChange>[];
            },
          }),
      })
      .from(schema.operationOverrides)
      .innerJoin(
        schema.schemaCheckChangeAction,
        eq(schema.schemaCheckChangeAction.schemaCheckId, schema.operationOverrides.schemaCheckId),
      )
      .innerJoin(
        schema.schemaCheckChangeActionOperationUsage,
        eq(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, schema.schemaCheckChangeAction.id),
      )
      .innerJoin(
        schema.schemaCheckFederatedGraphs,
        eq(schema.schemaCheckFederatedGraphs.checkId, schema.operationOverrides.schemaCheckId),
      )
      .where(
        and(
          eq(schema.operationOverrides.hash, data.operationHash),
          eq(schema.schemaCheckChangeActionOperationUsage.hash, data.operationHash),
          eq(schema.schemaCheckFederatedGraphs.federatedGraphId, this.federatedGraphId),
          eq(schema.schemaCheckChangeAction.isBreaking, true),
        ),
      )
      .groupBy(({ checkId, createdAt }) => [checkId, createdAt])
      .orderBy(desc(schema.operationOverrides.createdAt));

    return res.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
