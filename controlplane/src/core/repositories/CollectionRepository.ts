import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, desc, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DBCollectionProtocol } from '../../db/models.js';
import { BlobStorage } from '../blobstorage/index.js';

export interface CreateCollectionInput {
  name: string;
  federatedGraphId: string;
  createdById: string;
}

export interface UpdateCollectionInput {
  id: string;
  name?: string;
  updatedById: string;
  protocols: DBCollectionProtocol[];
  filePathPrefix: string;
}

export interface CreateCollectionOperationInput {
  id: string;
  collectionId: string;
  name: string;
  content: string;
  createdById: string;
}

export interface UpdateCollectionOperationInput {
  id: string;
  name: string;
  content: string;
  updatedById: string;
}

export class CollectionRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  // Collection CRUD operations
  async createCollection(input: CreateCollectionInput) {
    const [collection] = await this.db
      .insert(schema.federatedGraphCollections)
      .values({
        name: input.name,
        federatedGraphId: input.federatedGraphId,
        createdById: input.createdById,
      })
      .returning();

    return collection;
  }

  async getCollection({ id, federatedGraphId }: { id: string; federatedGraphId: string }) {
    const [collection] = await this.db
      .select()
      .from(schema.federatedGraphCollections)
      .where(
        and(
          eq(schema.federatedGraphCollections.id, id),
          eq(schema.federatedGraphCollections.federatedGraphId, federatedGraphId),
        ),
      );

    return collection;
  }

  async getCollectionById(id: string) {
    const [collection] = await this.db
      .select()
      .from(schema.federatedGraphCollections)
      .where(eq(schema.federatedGraphCollections.id, id));

    return collection;
  }

  async getCollectionByName(federatedGraphId: string, name: string) {
    const [collection] = await this.db
      .select()
      .from(schema.federatedGraphCollections)
      .where(
        and(
          eq(schema.federatedGraphCollections.federatedGraphId, federatedGraphId),
          eq(schema.federatedGraphCollections.name, name),
        ),
      );

    return collection;
  }

  async getCollectionsByFederatedGraphId(federatedGraphId: string) {
    return await this.db
      .select()
      .from(schema.federatedGraphCollections)
      .where(eq(schema.federatedGraphCollections.federatedGraphId, federatedGraphId))
      .orderBy(desc(schema.federatedGraphCollections.createdAt));
  }

  async updateCollection(input: UpdateCollectionInput) {
    const updateData: Record<string, any> = {
      updatedById: input.updatedById,
      updatedAt: sql`NOW()`,
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }

    const [collection] = await this.db
      .update(schema.federatedGraphCollections)
      .set(updateData)
      .where(eq(schema.federatedGraphCollections.id, input.id))
      .returning();

    await this.setCollectionProtocols({
      collectionId: input.id,
      collectionProtocols: input.protocols,
      filePathPrefix: input.filePathPrefix,
    });

    return collection;
  }

  async deleteCollection({ id, federatedGraphId }: { id: string; federatedGraphId: string }) {
    await this.db
      .delete(schema.federatedGraphCollections)
      .where(
        and(
          eq(schema.federatedGraphCollections.id, id),
          eq(schema.federatedGraphCollections.federatedGraphId, federatedGraphId),
        ),
      );
  }

  // Collection Operations CRUD operations
  async createCollectionOperation(input: CreateCollectionOperationInput) {
    const [operation] = await this.db
      .insert(schema.federatedGraphCollectionOperations)
      .values({
        collectionId: input.collectionId,
        name: input.name,
        content: input.content,
        createdById: input.createdById,
      })
      .returning();

    return operation;
  }

  async getCollectionOperation({ id, collectionId }: { id: string; collectionId: string }) {
    const [operation] = await this.db
      .select()
      .from(schema.federatedGraphCollectionOperations)
      .where(
        and(
          eq(schema.federatedGraphCollectionOperations.id, id),
          eq(schema.federatedGraphCollectionOperations.collectionId, collectionId),
        ),
      );

    return operation;
  }

  async getCollectionOperationByName({ collectionId, name }: { collectionId: string; name: string }) {
    const [operation] = await this.db
      .select()
      .from(schema.federatedGraphCollectionOperations)
      .where(
        and(
          eq(schema.federatedGraphCollectionOperations.collectionId, collectionId),
          eq(schema.federatedGraphCollectionOperations.name, name),
        ),
      );

    return operation;
  }

  async getCollectionOperationsByCollectionId(collectionId: string) {
    return await this.db
      .select()
      .from(schema.federatedGraphCollectionOperations)
      .where(eq(schema.federatedGraphCollectionOperations.collectionId, collectionId))
      .orderBy(desc(schema.federatedGraphCollectionOperations.createdAt));
  }

  async updateCollectionOperation(input: UpdateCollectionOperationInput) {
    const updateData: Record<string, any> = {
      updatedById: input.updatedById,
      updatedAt: sql`NOW()`,
    };

    const [operation] = await this.db
      .update(schema.federatedGraphCollectionOperations)
      .set(updateData)
      .where(eq(schema.federatedGraphCollectionOperations.id, input.id))
      .returning();

    return operation;
  }

  async deleteCollectionOperation({ id, collectionId }: { id: string; collectionId: string }) {
    await this.db
      .delete(schema.federatedGraphCollectionOperations)
      .where(
        and(
          eq(schema.federatedGraphCollectionOperations.id, id),
          eq(schema.federatedGraphCollectionOperations.collectionId, collectionId),
        ),
      );
  }

  // Collection Protocol operations
  async setCollectionProtocols({
    collectionId,
    collectionProtocols,
    filePathPrefix,
  }: {
    collectionId: string;
    collectionProtocols: DBCollectionProtocol[];
    filePathPrefix: string;
  }) {
    await this.db
      .delete(schema.federatedGraphCollectionProtocols)
      .where(eq(schema.federatedGraphCollectionProtocols.collectionId, collectionId));

    await this.db
      .insert(schema.federatedGraphCollectionProtocols)
      .values(
        collectionProtocols.map((protocol) => ({
          collectionId,
          protocol,
          filePath: `${filePathPrefix}${protocol}.json`,
        })),
      )
      .returning();
  }

  async getCollectionProtocols(collectionId: string) {
    return await this.db
      .select()
      .from(schema.federatedGraphCollectionProtocols)
      .where(eq(schema.federatedGraphCollectionProtocols.collectionId, collectionId));
  }

  // Advanced queries
  async getCollectionWithOperations(collectionId: string) {
    const collection = await this.getCollectionById(collectionId);
    if (!collection) {
      return null;
    }

    const operations = await this.getCollectionOperationsByCollectionId(collectionId);
    const protocols = await this.getCollectionProtocols(collectionId);

    return {
      ...collection,
      operations,
      protocols,
    };
  }

  async getCollectionOperationCount(collectionId: string) {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.federatedGraphCollectionOperations)
      .where(eq(schema.federatedGraphCollectionOperations.collectionId, collectionId));

    return result.count;
  }

  async getCollectionsWithOperationCounts(federatedGraphId: string) {
    return await this.db
      .select({
        id: schema.federatedGraphCollections.id,
        name: schema.federatedGraphCollections.name,
        federatedGraphId: schema.federatedGraphCollections.federatedGraphId,
        createdAt: schema.federatedGraphCollections.createdAt,
        updatedAt: schema.federatedGraphCollections.updatedAt,
        createdById: schema.federatedGraphCollections.createdById,
        updatedById: schema.federatedGraphCollections.updatedById,
        operationCount: sql<number>`count(${schema.federatedGraphCollectionOperations.id})`,
      })
      .from(schema.federatedGraphCollections)
      .leftJoin(
        schema.federatedGraphCollectionOperations,
        eq(schema.federatedGraphCollections.id, schema.federatedGraphCollectionOperations.collectionId),
      )
      .where(eq(schema.federatedGraphCollections.federatedGraphId, federatedGraphId))
      .groupBy(schema.federatedGraphCollections.id)
      .orderBy(desc(schema.federatedGraphCollections.createdAt));
  }

  async uploadCollectionManifest({
    protocol,
    manifest,
    filePathPrefix,
    blobStorage,
  }: {
    protocol: DBCollectionProtocol;
    manifest: string;
    filePathPrefix: string;
    blobStorage: BlobStorage;
  }) {
    const filePath = `${filePathPrefix}${protocol}.json`;
    try {
      const manifestJsonStringBytes = Buffer.from(manifest, 'utf8');
      await blobStorage.putObject({
        key: filePath,
        body: manifestJsonStringBytes,
        contentType: 'application/json; charset=utf-8',
      });
    } catch (error) {
      throw new Error(`Failed to upload collection manifest to ${filePath}: ${error}`);
    }
  }
}
