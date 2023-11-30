import { and, desc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ClientDTO, PersistedOperationDTO, UpdatedPersistedOperation } from 'src/types/index.js';
import * as schema from '../../db/schema.js';
import { federatedGraphClients, federatedGraphPersistedOperations } from '../../db/schema.js';

export class OperationsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphId: string,
  ) {}

  public async updatePersistedOperations(clientId: string, userId: string, operations: UpdatedPersistedOperation[]) {
    const now = new Date();
    const inserts = operations.map((operation) => {
      return {
        federatedGraphId: this.federatedGraphId,
        clientId,
        operationId: operation.operationId,
        hash: operation.hash,
        filePath: operation.filePath,
        createdAt: now,
        updatedAt: now,
        createdById: userId,
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
}
