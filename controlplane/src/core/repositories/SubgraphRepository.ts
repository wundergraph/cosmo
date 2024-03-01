import { PlainMessage } from '@bufbuild/protobuf';
import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel, normalizeURL, splitLabel } from '@wundergraph/cosmo-shared';
import { SQL, and, asc, count, desc, eq, gt, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import {
  graphCompositionSubgraphs,
  graphCompositions,
  schemaChecks,
  schemaVersion,
  subgraphMembers,
  subgraphs,
  subgraphsToFederatedGraph,
  targets,
  users,
} from '../../db/schema.js';
import {
  FederatedGraphDTO,
  GetChecksResponse,
  Label,
  ListFilterOptions,
  SchemaCheckDetailsDTO,
  SchemaCheckSummaryDTO,
  SubgraphDTO,
  SubgraphMemberDTO,
} from '../../types/index.js';
import { BlobStorage } from '../blobstorage/index.js';
import { Composer } from '../composition/composer.js';
import { hasLabelsChanged, normalizeLabels } from '../util.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { GraphCompositionRepository } from './GraphCompositionRepository.js';
import { TargetRepository } from './TargetRepository.js';

type SubscriptionProtocol = 'ws' | 'sse' | 'sse_post';

/**
 * Repository for managing subgraphs.
 */
export class SubgraphRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async exists(name: string, namespace: string): Promise<boolean> {
    const graphs = await this.db
      .select()
      .from(targets)
      .innerJoin(schema.namespaces, and(eq(schema.namespaces.id, targets.namespaceId)))
      .where(
        and(
          eq(schema.targets.name, name),
          eq(schema.targets.organizationId, this.organizationId),
          eq(schema.targets.type, 'subgraph'),
          eq(schema.namespaces.name, namespace),
        ),
      );

    return graphs.length === 1;
  }

  public create(data: {
    name: string;
    namespace: string;
    routingUrl: string;
    createdBy: string;
    labels: Label[];
    subscriptionUrl?: string;
    subscriptionProtocol?: SubscriptionProtocol;
    readme?: string;
    namespaceId: string;
  }): Promise<SubgraphDTO | undefined> {
    const uniqueLabels = normalizeLabels(data.labels);
    const routingUrl = normalizeURL(data.routingUrl);
    let subscriptionUrl = data.subscriptionUrl ? normalizeURL(data.subscriptionUrl) : undefined;
    if (subscriptionUrl === routingUrl) {
      subscriptionUrl = undefined;
    }

    return this.db.transaction(async (tx) => {
      /**
       * 1. Create a new target of type subgraph.
       * The name is the name of the subgraph.
       */
      const insertedTarget = await tx
        .insert(targets)
        .values({
          name: data.name,
          namespaceId: data.namespaceId,
          createdBy: data.createdBy,
          type: 'subgraph',
          organizationId: this.organizationId,
          labels: uniqueLabels.map((ul) => joinLabel(ul)),
          readme: data.readme,
        })
        .returning()
        .execute();

      /**
       * 2. Create the subgraph with the initial metadata without a schema version.
       */
      const insertedSubgraph = await tx
        .insert(subgraphs)
        .values({
          targetId: insertedTarget[0].id,
          routingUrl,
          subscriptionUrl,
          subscriptionProtocol: data.subscriptionProtocol ?? 'ws',
        })
        .returning()
        .execute();

      /**
       * 3. Insert into federatedSubgraphs by matching labels
       */
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);
      const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: uniqueLabels,
        namespaceId: data.namespaceId,
      });

      if (federatedGraphs.length > 0) {
        await tx
          .insert(subgraphsToFederatedGraph)
          .values(
            federatedGraphs.map((federatedGraph) => ({
              federatedGraphId: federatedGraph.id,
              subgraphId: insertedSubgraph[0].id,
            })),
          )
          .execute();
      }

      /**
       * 4. Add the creator as a subgraph member
       */

      const subgraphRepo = new SubgraphRepository(tx, this.organizationId);
      await subgraphRepo.addSubgraphMember({ subgraphId: insertedSubgraph[0].id, userId: data.createdBy });

      return {
        id: insertedSubgraph[0].id,
        name: data.name,
        targetId: insertedTarget[0].id,
        labels: uniqueLabels,
        routingUrl,
        // Populated when first schema is pushed
        schemaSDL: '',
        schemaVersionId: '',
        lastUpdatedAt: '',
        namespace: data.namespace,
        namespaceId: data.namespaceId,
      } as SubgraphDTO;
    });
  }

  public async update(
    data: {
      targetId: string;
      routingUrl?: string;
      labels: Label[];
      subscriptionUrl?: string;
      schemaSDL?: string;
      subscriptionProtocol?: SubscriptionProtocol;
      updatedBy: string;
      readme?: string;
      namespaceId: string;
      unsetLabels: boolean;
    },
    blobStorage: BlobStorage,
  ): Promise<{ compositionErrors: PlainMessage<CompositionError>[]; updatedFederatedGraphs: FederatedGraphDTO[] }> {
    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const updatedFederatedGraphs: FederatedGraphDTO[] = [];

    await this.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);
      const subgraphRepo = new SubgraphRepository(tx, this.organizationId);
      const targetRepo = new TargetRepository(tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(tx);
      const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);
      let subgraphChanged = false;

      const subgraph = await subgraphRepo.byTargetId(data.targetId);
      if (!subgraph) {
        return { compositionErrors, updatedFederatedGraphs };
      }

      // TODO: avoid downloading the schema use hash instead
      if (data.schemaSDL && data.schemaSDL !== subgraph.schemaSDL) {
        subgraphChanged = true;
        const updatedSubgraph = await subgraphRepo.addSchemaVersion({
          targetId: subgraph.targetId,
          subgraphSchema: data.schemaSDL,
        });
        if (!updatedSubgraph) {
          throw new Error(`Subgraph ${subgraph.name} not found`);
        }
      }

      if (data.routingUrl && data.routingUrl !== subgraph.routingUrl) {
        subgraphChanged = true;
        const url = normalizeURL(data.routingUrl);
        await tx
          .update(subgraphs)
          .set({
            routingUrl: url,
          })
          .where(eq(subgraphs.id, subgraph.id))
          .execute();
      }

      if (data.subscriptionUrl && data.subscriptionUrl !== subgraph.subscriptionUrl) {
        subgraphChanged = true;
        const url = normalizeURL(data.subscriptionUrl);
        await tx
          .update(subgraphs)
          .set({
            subscriptionUrl: url,
          })
          .where(eq(subgraphs.id, subgraph.id))
          .execute();
      }

      if (data.subscriptionProtocol && data.subscriptionProtocol !== subgraph.subscriptionProtocol) {
        subgraphChanged = true;
        await tx
          .update(subgraphs)
          .set({
            subscriptionProtocol: data.subscriptionProtocol,
          })
          .where(eq(subgraphs.id, subgraph.id))
          .execute();
      }

      let labelChanged = false;
      if (data.labels && data.labels.length > 0) {
        labelChanged = hasLabelsChanged(subgraph.labels, data.labels);
      }

      if (labelChanged || data.unsetLabels) {
        const newLabels = data.unsetLabels ? [] : normalizeLabels(data.labels);

        // update labels of the subgraph
        await tx
          .update(targets)
          .set({
            // labels are stored as a string array in the database
            labels: newLabels.map((ul) => joinLabel(ul)),
          })
          .where(eq(targets.id, subgraph.targetId));

        // find all federated graphs that match with the new subgraph labels
        const newFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
          labels: newLabels,
          namespaceId: data.namespaceId,
        });

        // add them to the updatedFederatedGraphs array without duplicates
        for (const federatedGraph of newFederatedGraphs) {
          const exists = updatedFederatedGraphs.find((g) => g.name === federatedGraph.name);
          if (!exists) {
            updatedFederatedGraphs.push(federatedGraph);
          }
        }

        // delete all subgraphsToFederatedGraphs that are not in the newFederatedGraphs array
        let deleteCondition: SQL<unknown> | undefined = eq(subgraphsToFederatedGraph.subgraphId, subgraph.id);

        // we do this conditionally because notInArray cannot take empty value
        if (newFederatedGraphs.length > 0) {
          deleteCondition = and(
            deleteCondition,
            notInArray(
              subgraphsToFederatedGraph.federatedGraphId,
              newFederatedGraphs.map((g) => g.id),
            ),
          );
        }

        await tx.delete(subgraphsToFederatedGraph).where(deleteCondition);

        // we create new connections between the new federated graphs and the subgraph
        if (newFederatedGraphs.length > 0) {
          await tx
            .insert(subgraphsToFederatedGraph)
            .values(
              newFederatedGraphs.map((federatedGraph) => ({
                federatedGraphId: federatedGraph.id,
                subgraphId: subgraph.id,
              })),
            )
            .onConflictDoNothing()
            .execute();
        }
      }

      // We need to compose and build a new router config also on routing/subscription urls and labels changes
      if (subgraphChanged || labelChanged) {
        // find all federated graphs that use this subgraph. We need evaluate them again.
        updatedFederatedGraphs.push(
          ...(await fedGraphRepo.bySubgraphLabels({ labels: subgraph.labels, namespaceId: data.namespaceId })),
        );
      }
      // Validate all federated graphs that use this subgraph.
      for (const federatedGraph of updatedFederatedGraphs) {
        const composition = await composer.composeFederatedGraph(federatedGraph);

        await composer.deployComposition({
          composedGraph: composition,
          composedBy: data.updatedBy,
          blobStorage,
          organizationId: this.organizationId,
        });

        // Collect all composition errors

        compositionErrors.push(
          ...composition.errors.map((e) => ({
            federatedGraphName: composition.name,
            namespace: composition.namespace,
            message: e.message,
          })),
        );
      }

      // update the readme of the subgraph
      if (data.readme) {
        await targetRepo.updateReadmeOfTarget({ id: data.targetId, readme: data.readme });
      }
    });

    return { compositionErrors, updatedFederatedGraphs };
  }

  public async move(
    data: {
      targetId: string;
      subgraphId: string;
      subgraphLabels: Label[];
      newNamespace: string;
      updatedBy: string;
      currentNamespaceId: string;
      newNamespaceId: string;
    },
    blobStorage: BlobStorage,
  ): Promise<{ compositionErrors: PlainMessage<CompositionError>[]; updatedFederatedGraphs: FederatedGraphDTO[] }> {
    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const updatedFederatedGraphs: FederatedGraphDTO[] = [];

    await this.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);
      const subgraphRepo = new SubgraphRepository(tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(tx);

      updatedFederatedGraphs.push(
        ...(await fedGraphRepo.bySubgraphLabels({ labels: data.subgraphLabels, namespaceId: data.currentNamespaceId })),
      );

      await tx.update(targets).set({ namespaceId: data.newNamespaceId }).where(eq(targets.id, data.targetId));

      // Delete all mappings with this subgraph. We will create new mappings with federated graphs in new namespace
      await tx
        .delete(schema.subgraphsToFederatedGraph)
        .where(eq(schema.subgraphsToFederatedGraph.subgraphId, data.subgraphId));

      const newFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: data.subgraphLabels,
        namespaceId: data.newNamespaceId,
      });
      updatedFederatedGraphs.push(...newFederatedGraphs);

      // insert new mappings
      if (newFederatedGraphs.length > 0) {
        await tx
          .insert(schema.subgraphsToFederatedGraph)
          .values(
            newFederatedGraphs.map((fg) => ({
              federatedGraphId: fg.id,
              subgraphId: data.subgraphId,
            })),
          )
          .onConflictDoNothing()
          .execute();
      }

      const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);
      for (const federatedGraph of updatedFederatedGraphs) {
        const composition = await composer.composeFederatedGraph(federatedGraph);

        await composer.deployComposition({
          composedGraph: composition,
          composedBy: data.updatedBy,
          blobStorage,
          organizationId: this.organizationId,
        });

        // Collect all composition errors
        compositionErrors.push(
          ...composition.errors.map((e) => ({
            federatedGraphName: composition.name,
            namespace: composition.namespace,
            message: e.message,
          })),
        );
      }
    });

    return { compositionErrors, updatedFederatedGraphs };
  }

  public addSchemaVersion(data: { targetId: string; subgraphSchema: string }): Promise<SubgraphDTO | undefined> {
    return this.db.transaction(async (db) => {
      const subgraph = await this.byTargetId(data.targetId);
      if (subgraph === undefined) {
        return undefined;
      }

      const insertedVersion = await db
        .insert(schemaVersion)
        .values({
          targetId: subgraph.targetId,
          schemaSDL: data.subgraphSchema,
        })
        .returning({
          insertedId: schemaVersion.id,
          createdAt: schemaVersion.createdAt,
        });

      await db
        .update(subgraphs)
        .set({
          // Update the schema of the subgraph with a valid schema version.
          schemaVersionId: insertedVersion[0].insertedId,
        })
        .where(eq(subgraphs.targetId, subgraph.targetId))
        .returning();

      return {
        id: subgraph.id,
        schemaSDL: data.subgraphSchema,
        schemaVersionId: insertedVersion[0].insertedId,
        targetId: subgraph.targetId,
        routingUrl: subgraph.routingUrl,
        subscriptionUrl: subgraph.subscriptionUrl,
        subscriptionProtocol: subgraph.subscriptionProtocol,
        lastUpdatedAt: insertedVersion[0].createdAt.toISOString() ?? '',
        name: subgraph.name,
        labels: subgraph.labels,
        namespace: subgraph.namespace,
        namespaceId: subgraph.namespaceId,
      };
    });
  }

  public async list(opts: ListFilterOptions): Promise<SubgraphDTO[]> {
    const conditions: SQL<unknown>[] = [
      eq(schema.targets.organizationId, this.organizationId),
      eq(schema.targets.type, 'subgraph'),
    ];

    if (opts.namespaceId) {
      conditions.push(eq(schema.targets.namespaceId, opts.namespaceId));
    }

    const targets = await this.db
      .select({
        id: schema.targets.id,
        name: schema.targets.name,
        lastUpdatedAt: schema.schemaVersion.createdAt,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .leftJoin(schema.schemaVersion, eq(schema.subgraphs.schemaVersionId, schema.schemaVersion.id))
      .orderBy(asc(schema.targets.createdAt), asc(schemaVersion.createdAt))
      .where(and(...conditions))
      .limit(opts.limit)
      .offset(opts.offset);

    const subgraphs: SubgraphDTO[] = [];

    for (const target of targets) {
      const sg = await this.byTargetId(target.id);
      if (sg === undefined) {
        throw new Error(`Subgraph ${target.name} not found`);
      }
      subgraphs.push(sg);
    }

    return subgraphs;
  }

  /**
   * Returns all subgraphs that are part of the federated graph.
   * Even if they have not been published yet. Optionally, you can set the `published` flag to true
   * to only return subgraphs that have been published with a version.
   */
  public async listByFederatedGraph(data: {
    federatedGraphTargetId: string;
    published?: boolean;
  }): Promise<SubgraphDTO[]> {
    const target = await this.db.query.targets.findFirst({
      where: and(
        eq(schema.targets.id, data.federatedGraphTargetId),
        eq(schema.targets.organizationId, this.organizationId),
        eq(schema.targets.type, 'federated'),
      ),
      with: {
        federatedGraph: {
          columns: {
            id: true,
          },
        },
      },
    });

    if (target === undefined) {
      return [];
    }

    const targets = await this.db
      .select({
        id: schema.targets.id,
        name: schema.targets.name,
        lastUpdatedAt: schema.schemaVersion.createdAt,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      [data.published ? 'innerJoin' : 'leftJoin'](
        schema.schemaVersion,
        eq(schema.subgraphs.schemaVersionId, schema.schemaVersion.id),
      )
      .innerJoin(schema.subgraphsToFederatedGraph, eq(schema.subgraphsToFederatedGraph.subgraphId, schema.subgraphs.id))
      .orderBy(asc(schema.schemaVersion.createdAt))
      .where(
        and(
          eq(schema.targets.organizationId, this.organizationId),
          eq(schema.subgraphsToFederatedGraph.federatedGraphId, target.federatedGraph.id),
        ),
      );

    const subgraphs: SubgraphDTO[] = [];

    for (const target of targets) {
      const sg = await this.byTargetId(target.id);
      if (sg === undefined) {
        continue;
      }
      subgraphs.push(sg);
    }

    return subgraphs;
  }

  private async getSubgraph(conditions: SQL<unknown>[]): Promise<SubgraphDTO | undefined> {
    // Ensure all queries are scoped to the organization.
    conditions.push(eq(schema.targets.organizationId, this.organizationId));

    const resp = await this.db
      .select({
        name: schema.targets.name,
        labels: schema.targets.labels,
        createdBy: schema.targets.createdBy,
        readme: schema.targets.readme,
        id: schema.subgraphs.id,
        routingUrl: schema.subgraphs.routingUrl,
        subscriptionUrl: schema.subgraphs.subscriptionUrl,
        subscriptionProtocol: schema.subgraphs.subscriptionProtocol,
        targetId: schema.subgraphs.targetId,
        namespaceId: schema.namespaces.id,
        namespaceName: schema.namespaces.name,
        schemaVersionId: schema.subgraphs.schemaVersionId,
      })
      .from(targets)
      .innerJoin(schema.subgraphs, eq(targets.id, schema.subgraphs.targetId))
      .innerJoin(schema.namespaces, eq(schema.namespaces.id, targets.namespaceId))
      .where(and(...conditions));

    if (resp.length === 0) {
      return;
    }

    let lastUpdatedAt = '';
    let schemaSDL = '';
    let schemaVersionId = '';

    // Subgraphs are created without a schema version.
    if (resp[0].schemaVersionId !== null) {
      const sv = await this.db.query.schemaVersion.findFirst({
        where: eq(schema.schemaVersion.id, resp[0].schemaVersionId),
      });
      lastUpdatedAt = sv?.createdAt?.toISOString() ?? '';
      schemaSDL = sv?.schemaSDL ?? '';
      schemaVersionId = sv?.id ?? '';
    }

    return {
      id: resp[0].id,
      targetId: resp[0].targetId,
      routingUrl: resp[0].routingUrl,
      readme: resp[0].readme || undefined,
      subscriptionUrl: resp[0].subscriptionUrl ?? '',
      subscriptionProtocol: resp[0].subscriptionProtocol ?? 'ws',
      name: resp[0].name,
      schemaSDL,
      schemaVersionId,
      lastUpdatedAt,
      labels: resp[0].labels?.map?.((l) => splitLabel(l)) ?? [],
      creatorUserId: resp[0].createdBy || undefined,
      namespace: resp[0].namespaceName,
      namespaceId: resp[0].namespaceId,
    };
  }

  public byTargetId(targetId: string): Promise<SubgraphDTO | undefined> {
    return this.getSubgraph([eq(schema.targets.id, targetId), eq(schema.targets.type, 'subgraph')]);
  }

  public byName(name: string, namespace: string): Promise<SubgraphDTO | undefined> {
    return this.getSubgraph([
      eq(schema.targets.name, name),
      eq(schema.targets.type, 'subgraph'),
      eq(schema.namespaces.name, namespace),
    ]);
  }

  public byId(id: string): Promise<SubgraphDTO | undefined> {
    return this.getSubgraph([eq(schema.subgraphs.id, id)]);
  }

  public async checks({
    federatedGraphTargetId,
    limit,
    offset,
    startDate,
    endDate,
  }: {
    federatedGraphTargetId: string;
    limit: number;
    offset: number;
    startDate: string;
    endDate: string;
  }): Promise<GetChecksResponse> {
    const subgraphs = await this.listByFederatedGraph({
      federatedGraphTargetId,
      published: true,
    });

    if (subgraphs.length === 0) {
      return {
        checks: [],
        checksCount: 0,
      };
    }

    const checkList = await this.db.query.schemaChecks.findMany({
      columns: {
        id: true,
        targetId: true,
        createdAt: true,
        isComposable: true,
        isDeleted: true,
        hasBreakingChanges: true,
        hasClientTraffic: true,
        forcedSuccess: true,
        ghDetails: true,
      },
      limit,
      offset,
      orderBy: desc(schemaChecks.createdAt),
      where: and(
        inArray(
          schemaChecks.targetId,
          subgraphs.map(({ targetId }) => targetId),
        ),
        gt(schemaChecks.createdAt, new Date(startDate)),
        lt(schemaChecks.createdAt, new Date(endDate)),
      ),
    });

    const checksCount = await this.getChecksCount({ federatedGraphTargetId, startDate, endDate });

    return {
      checks: checkList.map((c) => ({
        id: c.id,
        targetID: c.targetId,
        subgraphName: subgraphs.find((s) => s.targetId === c.targetId)?.name ?? '',
        timestamp: c.createdAt.toISOString(),
        isBreaking: c.hasBreakingChanges ?? false,
        isComposable: c.isComposable ?? false,
        isDeleted: c.isDeleted ?? false,
        hasClientTraffic: c.hasClientTraffic ?? false,
        isForcedSuccess: c.forcedSuccess ?? false,
        ghDetails: c.ghDetails
          ? {
              commitSha: c.ghDetails.commitSha,
              ownerSlug: c.ghDetails.ownerSlug,
              repositorySlug: c.ghDetails.repositorySlug,
              checkRunId: c.ghDetails.checkRunId,
            }
          : undefined,
      })),
      checksCount,
    };
  }

  public async getChecksCount({
    federatedGraphTargetId,
    startDate,
    endDate,
  }: {
    federatedGraphTargetId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<number> {
    const subgraphs = await this.listByFederatedGraph({
      federatedGraphTargetId,
      published: true,
    });

    if (subgraphs.length === 0) {
      return 0;
    }

    let conditions: SQL<unknown> | undefined;

    if (startDate && endDate) {
      conditions = and(
        inArray(
          schemaChecks.targetId,
          subgraphs.map(({ targetId }) => targetId),
        ),
        gt(schemaChecks.createdAt, new Date(startDate)),
        lt(schemaChecks.createdAt, new Date(endDate)),
      );
    } else {
      conditions = and(
        inArray(
          schemaChecks.targetId,
          subgraphs.map(({ targetId }) => targetId),
        ),
      );
    }

    const checksCount = await this.db.select({ count: count() }).from(schemaChecks).where(conditions);

    if (checksCount.length === 0) {
      return 0;
    }
    return checksCount[0].count;
  }

  public async checkById(data: {
    id: string;
    federatedGraphTargetId: string;
  }): Promise<SchemaCheckSummaryDTO | undefined> {
    const check = await this.db.query.schemaChecks.findFirst({
      where: eq(schema.schemaChecks.id, data.id),
      with: {
        affectedGraphs: true,
      },
    });

    if (!check) {
      return;
    }

    const subgraphs = await this.listByFederatedGraph({
      federatedGraphTargetId: data.federatedGraphTargetId,
      published: true,
    });

    const subgraph = subgraphs.find((s) => s.targetId === check.targetId);
    if (!subgraph) {
      return;
    }

    return {
      id: check.id,
      targetID: check.targetId,
      subgraphName: subgraph.name ?? '',
      timestamp: check.createdAt.toISOString(),
      isBreaking: check.hasBreakingChanges ?? false,
      isComposable: check.isComposable ?? false,
      isDeleted: check.isDeleted ?? false,
      hasClientTraffic: check.hasClientTraffic ?? false,
      proposedSubgraphSchemaSDL: check.proposedSubgraphSchemaSDL ?? undefined,
      isForcedSuccess: check.forcedSuccess ?? false,
      affectedGraphs: check.affectedGraphs.map(({ federatedGraphId, trafficCheckDays }) => ({
        id: federatedGraphId,
        trafficCheckDays,
      })),
      ghDetails: check.ghDetails
        ? {
            commitSha: check.ghDetails.commitSha,
            ownerSlug: check.ghDetails.ownerSlug,
            repositorySlug: check.ghDetails.repositorySlug,
            checkRunId: check.ghDetails.checkRunId,
          }
        : undefined,
    };
  }

  public async checkDetails(id: string, federatedTargetID: string): Promise<SchemaCheckDetailsDTO | undefined> {
    const changes = await this.db.query.schemaCheckChangeAction.findMany({
      columns: {
        id: true,
        changeType: true,
        changeMessage: true,
        path: true,
        isBreaking: true,
      },
      where: eq(schema.schemaCheckChangeAction.schemaCheckId, id),
    });

    const errorList = await this.db.query.schemaCheckComposition.findMany({
      columns: {
        compositionErrors: true,
      },
      where: and(
        eq(schema.schemaCheckComposition.schemaCheckId, id),
        eq(schema.schemaCheckComposition.federatedTargetId, federatedTargetID),
      ),
    });

    const compositionErrors = errorList
      .filter((ce) => ce.compositionErrors != null)
      .map((ce) => ce.compositionErrors)
      .join('\n')
      .split('\n')
      .filter((m) => !!m);

    return {
      changes: changes.map((c) => ({
        id: c.id,
        changeType: c.changeType ?? '',
        message: c.changeMessage ?? '',
        path: c.path ?? undefined,
        isBreaking: c.isBreaking ?? false,
      })),
      compositionErrors,
    };
  }

  public async forceCheckSuccess(checkId: string) {
    const result = await this.db
      .update(schema.schemaChecks)
      .set({
        forcedSuccess: true,
      })
      .where(eq(schema.schemaChecks.id, checkId))
      .returning({
        ghDetails: schema.schemaChecks.ghDetails,
      });

    return result[0].ghDetails;
  }

  public async delete(targetID: string) {
    await this.db.delete(targets).where(eq(targets.id, targetID)).execute();
  }

  public async byGraphLabelMatchers(data: { labelMatchers: string[]; namespaceId: string }): Promise<SubgraphDTO[]> {
    const groupedLabels: Label[][] = [];
    for (const lm of data.labelMatchers) {
      const labels = lm.split(',').map((l) => splitLabel(l));
      const normalizedLabels = normalizeLabels(labels);
      groupedLabels.push(normalizedLabels);
    }

    const conditions: SQL<unknown>[] = [];
    for (const labels of groupedLabels) {
      const labelsSQL = labels.map((l) => `"${joinLabel(l)}"`).join(', ');
      // At least one common label
      conditions.push(sql.raw(`labels && '{${labelsSQL}}'`));
    }

    // Only get subgraphs that do not have any labels if the label matchers are empty.
    if (data.labelMatchers.length === 0) {
      conditions.push(eq(targets.labels, []));
    }

    const subgraphs = await this.db
      .select({ id: schema.subgraphs.id, name: schema.targets.name, targetId: schema.targets.id })
      .from(targets)
      .where(
        and(
          eq(targets.organizationId, this.organizationId),
          eq(targets.type, 'subgraph'),
          eq(targets.namespaceId, data.namespaceId),
          ...conditions,
        ),
      )
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, targets.id))
      .execute();

    const subgraphDTOs: SubgraphDTO[] = [];

    for (const target of subgraphs) {
      const subgraph = await this.byTargetId(target.targetId);
      if (subgraph === undefined) {
        throw new Error(`Subgraph ${target.name} not found`);
      }

      subgraphDTOs.push(subgraph);
    }

    return subgraphDTOs;
  }

  /**
   * Returns the latest valid schema version of a subgraph that was composed with a federated graph.
   * @param data
   */
  public async getSDLFromLatestComposition(data: { subgraphTargetId: string; federatedGraphTargetId: string }) {
    const fedRepo = new FederatedGraphRepository(this.db, this.organizationId);
    const fedGraphSchemaVersion = await fedRepo.getLatestValidSchemaVersion({ targetId: data.federatedGraphTargetId });
    if (!fedGraphSchemaVersion) {
      return undefined;
    }

    const latestValidVersion = await this.db
      .select({
        name: targets.name,
        schemaSDL: schemaVersion.schemaSDL,
        schemaVersionId: schemaVersion.id,
      })
      .from(graphCompositionSubgraphs)
      .innerJoin(graphCompositions, eq(graphCompositions.id, graphCompositionSubgraphs.graphCompositionId))
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositionSubgraphs.schemaVersionId))
      .innerJoin(targets, eq(targets.id, schemaVersion.targetId))
      .where(
        and(
          eq(targets.organizationId, this.organizationId),
          eq(targets.id, data.subgraphTargetId),
          eq(targets.type, 'subgraph'),
          eq(graphCompositions.isComposable, true),
          eq(graphCompositions.schemaVersionId, fedGraphSchemaVersion.schemaVersionId),
        ),
      )
      .orderBy(desc(graphCompositions.createdAt))
      .limit(1)
      .execute();

    if (latestValidVersion.length === 0) {
      return undefined;
    }

    return {
      schema: latestValidVersion[0].schemaSDL,
      schemaVersionId: latestValidVersion[0].schemaVersionId,
    };
  }

  public async getAccessibleSubgraphs(userId: string): Promise<SubgraphDTO[]> {
    const graphs = await this.db
      .selectDistinctOn([targets.id], { targetId: targets.id, name: targets.name })
      .from(targets)
      .innerJoin(subgraphs, eq(targets.id, subgraphs.targetId))
      .innerJoin(subgraphMembers, eq(subgraphs.id, subgraphMembers.subgraphId))
      .where(
        and(
          eq(targets.type, 'subgraph'),
          eq(targets.organizationId, this.organizationId),
          or(eq(targets.createdBy, userId), eq(subgraphMembers.userId, userId)),
        ),
      );

    const accessibleSubgraphs: SubgraphDTO[] = [];

    for (const graph of graphs) {
      const sg = await this.byTargetId(graph.targetId);
      if (sg === undefined) {
        throw new Error(`Subgraph ${graph.name} not found`);
      }
      accessibleSubgraphs.push(sg);
    }

    return accessibleSubgraphs;
  }

  public updateReadme({ targetId, readme }: { targetId: string; readme: string }) {
    return this.db
      .update(targets)
      .set({ readme })
      .where(and(eq(targets.id, targetId), eq(schema.targets.organizationId, this.organizationId)));
  }

  public async getSubgraphMembers(subgraphId: string): Promise<SubgraphMemberDTO[]> {
    const members = await this.db
      .select({
        subgraphMemberId: subgraphMembers.id,
        userId: subgraphMembers.userId,
        email: users.email,
      })
      .from(subgraphMembers)
      .innerJoin(users, eq(users.id, subgraphMembers.userId))
      .where(eq(subgraphMembers.subgraphId, subgraphId));

    return members;
  }

  public async getSubgraphMembersbyTargetId(targetId: string): Promise<SubgraphMemberDTO[]> {
    const members = await this.db
      .select({
        subgraphMemberId: subgraphMembers.id,
        userId: subgraphMembers.userId,
        email: users.email,
      })
      .from(subgraphMembers)
      .innerJoin(users, eq(users.id, subgraphMembers.userId))
      .innerJoin(subgraphs, eq(subgraphs.id, subgraphMembers.subgraphId))
      .where(eq(subgraphs.targetId, targetId));

    return members;
  }

  public async addSubgraphMember({ subgraphId, userId }: { subgraphId: string; userId: string }) {
    await this.db.insert(subgraphMembers).values({ subgraphId, userId }).execute();
  }

  public async removeSubgraphMember({
    subgraphId,
    subgraphMemberId,
  }: {
    subgraphId: string;
    subgraphMemberId: string;
  }) {
    await this.db
      .delete(subgraphMembers)
      .where(and(eq(subgraphMembers.subgraphId, subgraphId), eq(subgraphMembers.id, subgraphMemberId)))
      .execute();
  }
}
