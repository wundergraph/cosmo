import { and, desc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { federatedGraphClients, federatedGraphPersistedOperations } from '../../db/schema.js';
import { ClientDTO, PersistedOperationDTO, UpdatedPersistedOperation } from 'src/types/index.js';

export class OperationsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private federatedGraphId: string,
  ) {}

  public async updatePersistedOperations(clientId: string, userId: string, operations: UpdatedPersistedOperation[]) {
    const now = new Date();
    for (const operation of operations) {
      await this.db
        .insert(federatedGraphPersistedOperations)
        .values({
          federatedGraphId: this.federatedGraphId,
          clientId,
          hash: operation.hash,
          filePath: operation.filePath,
          createdAt: now,
          updatedAt: now,
          createdById: userId,
        })
        .onConflictDoUpdate({
          target: [federatedGraphPersistedOperations.federatedGraphId, federatedGraphPersistedOperations.hash],
          set: { updatedAt: now, updatedById: userId },
        });
    }
  }

  public async getPersistedOperations(pagination?: {
    limit: number;
    offset: number;
  }): Promise<PersistedOperationDTO[]> {
    const operationsResult = await this.db.query.federatedGraphPersistedOperations.findMany({
      where: eq(federatedGraphPersistedOperations.federatedGraphId, this.federatedGraphId),
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
