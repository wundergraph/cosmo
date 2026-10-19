import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { validate as isValidUuid } from 'uuid';
import * as schema from '../../db/schema.js';
import { graphCollectionOperations, graphCollections, users } from '../../db/schema.js';
import { traced } from '../tracing.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export interface CollectionRow {
  id: string;
  name: string;
  federatedGraphId: string;
  /** NULL means team-scoped. Set means private to that user. */
  privateToUserId: string | null;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface OperationMetaRow {
  id: string;
  name: string;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}

export interface OperationRow extends OperationMetaRow {
  collectionId: string;
  query: string;
  variables: string | null;
  contentHash: string;
}

export type CollectionWithOperations = CollectionRow & { operations: OperationMetaRow[] };

/**
 * Exactly what an RBAC check needs about a graph, and nothing else.
 * `FederatedGraphRepository.byId` would run six further queries for a
 * permission decision that cannot use any of them.
 */
export interface GraphTarget {
  targetId: string;
  namespaceId: string;
  creatorUserId?: string;
  name: string;
  namespaceName: string;
}

/** How the collections list is ordered. */
export type CollectionSortBy = 'name' | 'createdAt';

const computeContentHash = (query: string, variables?: string | null): string =>
  createHash('sha256')
    .update(`${query}\n${variables ?? ''}`)
    .digest('hex');

@traced
export class GraphCollectionsRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  /**
   * "Mine, or team-scoped." Every read goes through this, so a private
   * collection is invisible at the query level rather than by a check a
   * caller could forget.
   */
  private visibleTo(userId: string) {
    return or(isNull(graphCollections.privateToUserId), eq(graphCollections.privateToUserId, userId));
  }

  public async listByFederatedGraphId(
    federatedGraphId: string,
    userId: string,
    sortBy: CollectionSortBy = 'name',
  ): Promise<CollectionWithOperations[]> {
    const collections = await this.db
      .select({
        id: graphCollections.id,
        name: graphCollections.name,
        federatedGraphId: graphCollections.federatedGraphId,
        privateToUserId: graphCollections.privateToUserId,
        createdByEmail: users.email,
        createdAt: graphCollections.createdAt,
        updatedAt: graphCollections.updatedAt,
      })
      .from(graphCollections)
      .leftJoin(users, eq(users.id, graphCollections.createdById))
      .where(
        and(
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
          this.visibleTo(userId),
        ),
      )
      .orderBy(
        ...(sortBy === 'createdAt'
          ? [desc(graphCollections.createdAt), asc(graphCollections.id)]
          : [asc(sql`lower(${graphCollections.name})`), asc(graphCollections.id)]),
      );

    if (collections.length === 0) {
      return [];
    }

    // Metadata only. Operation bodies are unbounded and fetched individually on
    // open, so listing a graph's collections does not ship every saved query.
    const operations = await this.db
      .select({
        id: graphCollectionOperations.id,
        collectionId: graphCollectionOperations.collectionId,
        name: graphCollectionOperations.name,
        updatedAt: graphCollectionOperations.updatedAt,
        updatedByEmail: users.email,
      })
      .from(graphCollectionOperations)
      .leftJoin(users, eq(users.id, graphCollectionOperations.updatedById))
      .where(
        inArray(
          graphCollectionOperations.collectionId,
          collections.map((c) => c.id),
        ),
      )
      .orderBy(asc(sql`lower(${graphCollectionOperations.name})`));

    return collections.map((collection) => ({
      ...collection,
      operations: operations
        .filter((o) => o.collectionId === collection.id)
        .map(({ collectionId, ...operation }) => operation),
    }));
  }

  /**
   * `federatedGraphId` only ever narrows this query, so a forged value can hide
   * a row but never reveal one. The permission decision is still made against
   * the graph the row actually references.
   */
  public async collectionById(
    id: string,
    userId: string,
    federatedGraphId: string,
  ): Promise<CollectionRow | undefined> {
    if (!isValidUuid(id) || !isValidUuid(federatedGraphId)) {
      return undefined;
    }

    const [row] = await this.db
      .select({
        id: graphCollections.id,
        name: graphCollections.name,
        federatedGraphId: graphCollections.federatedGraphId,
        privateToUserId: graphCollections.privateToUserId,
        createdByEmail: users.email,
        createdAt: graphCollections.createdAt,
        updatedAt: graphCollections.updatedAt,
      })
      .from(graphCollections)
      .leftJoin(users, eq(users.id, graphCollections.createdById))
      .where(
        and(
          eq(graphCollections.id, id),
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
          this.visibleTo(userId),
        ),
      );

    return row;
  }

  /**
   * A collection together with the graph it belongs to: the collection for its
   * scope, the graph for the RBAC check. Fetching both here leaves the
   * permission decision itself free of I/O.
   */
  public async collectionWithGraph(
    id: string,
    userId: string,
    federatedGraphId: string,
  ): Promise<{ collection: CollectionRow; federatedGraph: GraphTarget } | undefined> {
    const collection = await this.collectionById(id, userId, federatedGraphId);

    if (!collection) {
      return undefined;
    }

    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const federatedGraph = await fedGraphRepo.rbacTargetById(collection.federatedGraphId);

    return federatedGraph ? { collection, federatedGraph } : undefined;
  }

  /** The same, for an operation: the row, its collection and their graph. */
  public async operationWithGraph(lookup: {
    id: string;
    userId: string;
    federatedGraphId: string;
    collectionId: string;
  }): Promise<{ operation: OperationRow; collection: CollectionRow; federatedGraph: GraphTarget } | undefined> {
    const operation = await this.operationById(lookup);

    if (!operation) {
      return undefined;
    }

    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const federatedGraph = await fedGraphRepo.rbacTargetById(operation.collection.federatedGraphId);

    return federatedGraph ? { operation, collection: operation.collection, federatedGraph } : undefined;
  }

  public async createCollection(data: {
    federatedGraphId: string;
    name: string;
    userId: string;
    teamScoped?: boolean;
  }): Promise<string> {
    const [row] = await this.db
      .insert(graphCollections)
      .values({
        organizationId: this.organizationId,
        federatedGraphId: data.federatedGraphId,
        name: data.name,
        privateToUserId: data.teamScoped ? null : data.userId,
        createdById: data.userId,
      })
      .returning({ id: graphCollections.id });

    return row.id;
  }

  public async renameCollection(id: string, name: string, federatedGraphId: string): Promise<void> {
    await this.db
      .update(graphCollections)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(graphCollections.id, id),
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
        ),
      );
  }

  public async shareCollection(id: string, federatedGraphId: string): Promise<void> {
    await this.db
      .update(graphCollections)
      .set({ privateToUserId: null, updatedAt: new Date() })
      .where(
        and(
          eq(graphCollections.id, id),
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
        ),
      );
  }

  public async deleteCollection(id: string, federatedGraphId: string): Promise<void> {
    // The collection's operations cascade via the collection_id foreign key.
    await this.db
      .delete(graphCollections)
      .where(
        and(
          eq(graphCollections.id, id),
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
        ),
      );
  }

  public async operationById(lookup: {
    id: string;
    userId: string;
    federatedGraphId: string;
    collectionId: string;
  }): Promise<(OperationRow & { collection: CollectionRow }) | undefined> {
    const { id, userId, federatedGraphId, collectionId } = lookup;

    // See collectionById: a malformed id is a miss, not a server error.
    if (!isValidUuid(id) || !isValidUuid(federatedGraphId) || !isValidUuid(collectionId)) {
      return undefined;
    }

    const [row] = await this.db
      .select({
        id: graphCollectionOperations.id,
        collectionId: graphCollectionOperations.collectionId,
        name: graphCollectionOperations.name,
        query: graphCollectionOperations.query,
        variables: graphCollectionOperations.variables,
        contentHash: graphCollectionOperations.contentHash,
        updatedAt: graphCollectionOperations.updatedAt,
        updatedByEmail: users.email,
        collectionName: graphCollections.name,
        federatedGraphId: graphCollections.federatedGraphId,
        privateToUserId: graphCollections.privateToUserId,
        collectionCreatedAt: graphCollections.createdAt,
        collectionUpdatedAt: graphCollections.updatedAt,
      })
      .from(graphCollectionOperations)
      .innerJoin(graphCollections, eq(graphCollections.id, graphCollectionOperations.collectionId))
      .leftJoin(users, eq(users.id, graphCollectionOperations.updatedById))
      .where(
        and(
          eq(graphCollectionOperations.id, id),
          eq(graphCollectionOperations.collectionId, collectionId),
          eq(graphCollections.organizationId, this.organizationId),
          eq(graphCollections.federatedGraphId, federatedGraphId),
          this.visibleTo(userId),
        ),
      );

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      collectionId: row.collectionId,
      name: row.name,
      query: row.query,
      variables: row.variables,
      contentHash: row.contentHash,
      updatedAt: row.updatedAt,
      updatedByEmail: row.updatedByEmail,
      collection: {
        id: row.collectionId,
        name: row.collectionName,
        federatedGraphId: row.federatedGraphId,
        privateToUserId: row.privateToUserId,
        createdByEmail: null,
        createdAt: row.collectionCreatedAt,
        updatedAt: row.collectionUpdatedAt,
      },
    };
  }

  public async createOperation(data: {
    collectionId: string;
    name: string;
    query: string;
    variables?: string;
    userId: string;
  }): Promise<{ id: string; contentHash: string }> {
    const contentHash = computeContentHash(data.query, data.variables);

    const [row] = await this.db
      .insert(graphCollectionOperations)
      .values({
        collectionId: data.collectionId,
        name: data.name,
        query: data.query,
        variables: data.variables ?? null,
        contentHash,
        createdById: data.userId,
        updatedById: data.userId,
      })
      .returning({ id: graphCollectionOperations.id });

    return { id: row.id, contentHash };
  }

  public async updateOperation(data: {
    id: string;
    collectionId: string;
    query: string;
    variables?: string;
    expectedContentHash: string;
    userId: string;
  }): Promise<{ contentHash: string } | undefined> {
    const contentHash = computeContentHash(data.query, data.variables);

    const updated = await this.db
      .update(graphCollectionOperations)
      .set({
        query: data.query,
        variables: data.variables ?? null,
        contentHash,
        updatedAt: new Date(),
        updatedById: data.userId,
      })
      .where(
        and(
          eq(graphCollectionOperations.id, data.id),
          eq(graphCollectionOperations.collectionId, data.collectionId),
          eq(graphCollectionOperations.contentHash, data.expectedContentHash),
        ),
      )
      .returning({ id: graphCollectionOperations.id });

    return updated.length > 0 ? { contentHash } : undefined;
  }

  public async renameOperation(id: string, name: string, collectionId: string, userId: string): Promise<void> {
    await this.db
      .update(graphCollectionOperations)
      .set({ name, updatedAt: new Date(), updatedById: userId })
      .where(and(eq(graphCollectionOperations.id, id), eq(graphCollectionOperations.collectionId, collectionId)));
  }

  public async deleteOperation(id: string, collectionId: string): Promise<void> {
    await this.db
      .delete(graphCollectionOperations)
      .where(and(eq(graphCollectionOperations.id, id), eq(graphCollectionOperations.collectionId, collectionId)));
  }
}
