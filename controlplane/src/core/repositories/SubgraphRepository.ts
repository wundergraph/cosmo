import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel, normalizeURL, splitLabel } from '@wundergraph/cosmo-shared';
import { and, asc, desc, eq, gt, inArray, lt, notInArray, SQL, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { schemaChecks, schemaVersion, subgraphs, subgraphsToFederatedGraph, targets } from '../../db/schema.js';
import {
  FederatedGraphDTO,
  GetChecksResponse,
  Label,
  ListFilterOptions,
  SchemaCheckDetailsDTO,
  SubgraphDTO,
} from '../../types/index.js';
import { normalizeLabels } from '../util.js';
import { Composer } from '../composition/composer.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

type SubscriptionProtocol = 'ws' | 'sse' | 'sse_post';

export interface Subgraph {
  name: string;
  routingUrl: string;
  labels: Label[];
  subscriptionUrl?: string;
  subscriptionProtocol?: SubscriptionProtocol;
}

export interface UpdateSubgraphOptions {
  name: string;
  routingUrl?: string;
  labels?: Label[];
  subscriptionUrl?: string;
  subscriptionProtocol?: SubscriptionProtocol;
}

/**
 * Repository for managing subgraphs.
 */
export class SubgraphRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>, private organizationId: string) {}

  public create(data: Subgraph): Promise<SubgraphDTO | undefined> {
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
          type: 'subgraph',
          organizationId: this.organizationId,
          labels: uniqueLabels.map((ul) => joinLabel(ul)),
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
      const federatedGraphs = await fedGraphRepo.bySubgraphLabels(uniqueLabels);

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

      return {
        id: insertedSubgraph[0].id,
        name: data.name,
        targetId: insertedTarget[0].id,
        labels: uniqueLabels,
        routingUrl,
        // Populated when first schema is pushed
        schemaSDL: '',
        lastUpdatedAt: '',
      } as SubgraphDTO;
    });
  }

  public async update(data: UpdateSubgraphOptions) {
    const subgraph = await this.byName(data.name);
    if (!subgraph) {
      return;
    }

    await this.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(tx, this.organizationId);

      if (data.routingUrl && data.routingUrl !== subgraph.routingUrl) {
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
        await tx
          .update(subgraphs)
          .set({
            subscriptionProtocol: data.subscriptionProtocol,
          })
          .where(eq(subgraphs.id, subgraph.id))
          .execute();
      }

      // update labels
      if (data.labels && data.labels.length > 0) {
        const recomposingGraphs: Map<string, FederatedGraphDTO> = new Map();

        const newLabels = normalizeLabels(data.labels);

        // find all federated graphs that match with the current subgraph labels
        const oldFederatedGraphs = await fedGraphRepo.bySubgraphLabels(subgraph.labels);

        for (const graph of oldFederatedGraphs) {
          recomposingGraphs.set(graph.id, graph);
        }

        // update labels of the subgraph
        await tx
          .update(targets)
          .set({
            // labels are stored as a string array in the database
            labels: newLabels.map((ul) => joinLabel(ul)),
          })
          .where(eq(targets.id, subgraph.targetId));

        // find all federated graphs that match with the new subgraph labels
        const newFederatedGraphs = await fedGraphRepo.bySubgraphLabels(newLabels);

        for (const graph of newFederatedGraphs) {
          recomposingGraphs.set(graph.id, graph);
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

        // we create new connections between the federated graphs and the subgraph
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
    });
  }

  public updateSchema(subgraphName: string, subgraphSchema: string): Promise<SubgraphDTO | undefined> {
    return this.db.transaction(async (db) => {
      const subgraph = await this.byName(subgraphName);
      if (subgraph === undefined) {
        return undefined;
      }

      const insertedVersion = await db
        .insert(schemaVersion)
        .values({
          targetId: subgraph.targetId,
          schemaSDL: subgraphSchema,
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
        schemaSDL: subgraphSchema,
        targetId: subgraph.targetId,
        routingUrl: subgraph.routingUrl,
        subscriptionUrl: subgraph.subscriptionUrl,
        subscriptionProtocol: subgraph.subscriptionProtocol,
        lastUpdatedAt: insertedVersion[0].createdAt.toISOString() ?? '',
        name: subgraphName,
        labels: subgraph.labels,
      };
    });
  }

  public async list(opts: ListFilterOptions): Promise<SubgraphDTO[]> {
    const targets = await this.db
      .select({
        targetId: schema.targets.id,
        name: schema.targets.name,
        lastUpdatedAt: schema.schemaVersion.createdAt,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .leftJoin(schema.schemaVersion, eq(schema.subgraphs.schemaVersionId, schema.schemaVersion.id))
      .orderBy(asc(schema.targets.createdAt), asc(schemaVersion.createdAt))
      .where(and(eq(schema.targets.organizationId, this.organizationId), eq(schema.targets.type, 'subgraph')))
      .limit(opts.limit)
      .offset(opts.offset);

    const subgraphs: SubgraphDTO[] = [];

    for (const target of targets) {
      const sg = await this.byName(target.name);
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
  public async listByFederatedGraph(federatedGraphName: string, opts?: { published: boolean }): Promise<SubgraphDTO[]> {
    const target = await this.db.query.targets.findFirst({
      where: and(
        eq(schema.targets.name, federatedGraphName),
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
        targetId: schema.targets.id,
        name: schema.targets.name,
        lastUpdatedAt: schema.schemaVersion.createdAt,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      [opts?.published ? 'innerJoin' : 'leftJoin'](
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
      const sg = await this.byName(target.name);
      if (sg === undefined) {
        continue;
      }
      subgraphs.push(sg);
    }

    return subgraphs;
  }

  public async byName(name: string): Promise<SubgraphDTO | undefined> {
    const resp = await this.db.query.targets.findFirst({
      where: and(
        eq(schema.targets.name, name),
        eq(schema.targets.organizationId, this.organizationId),
        eq(schema.targets.type, 'subgraph'),
      ),
      with: {
        subgraph: {
          with: {
            schemaVersion: true,
          },
        },
      },
    });

    if (resp === undefined) {
      return undefined;
    }

    let lastUpdatedAt = '';
    let schemaSDL = '';

    // Subgraphs are created without a schema version.
    if (resp.subgraph.schemaVersion !== null) {
      lastUpdatedAt = resp.subgraph.schemaVersion.createdAt?.toISOString() ?? '';
      schemaSDL = resp.subgraph.schemaVersion.schemaSDL ?? '';
    }

    return {
      id: resp.subgraph.id,
      targetId: resp.id,
      routingUrl: resp.subgraph.routingUrl,
      subscriptionUrl: resp.subgraph.subscriptionUrl ?? '',
      subscriptionProtocol: resp.subgraph.subscriptionProtocol ?? 'ws',
      name: resp.name,
      schemaSDL,
      lastUpdatedAt,
      labels: resp.labels?.map?.((l) => splitLabel(l)) ?? [],
    };
  }

  public async checks({
    federatedGraphName,
    limit,
    offset,
    startDate,
    endDate,
  }: {
    federatedGraphName: string;
    limit: number;
    offset: number;
    startDate: string;
    endDate: string;
  }): Promise<GetChecksResponse> {
    const subgraphs = await this.listByFederatedGraph(federatedGraphName, {
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
        hasBreakingChanges: true,
        proposedSubgraphSchemaSDL: true,
        forcedSuccess: true,
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

    const checksCount = await this.getChecksCount({ federatedGraphName, startDate, endDate });

    return {
      checks: checkList.map((c) => ({
        id: c.id,
        targetID: c.targetId,
        subgraphName: subgraphs.find((s) => s.targetId === c.targetId)?.name ?? '',
        timestamp: c.createdAt.toISOString(),
        isBreaking: c.hasBreakingChanges ?? false,
        isComposable: c.isComposable ?? false,
        proposedSubgraphSchemaSDL: c.proposedSubgraphSchemaSDL ?? undefined,
        isForcedSuccess: c.forcedSuccess ?? false,
      })),
      checksCount,
    };
  }

  public async getChecksCount({
    federatedGraphName,
    startDate,
    endDate,
  }: {
    federatedGraphName: string;
    startDate?: string;
    endDate?: string;
  }): Promise<number> {
    const subgraphs = await this.listByFederatedGraph(federatedGraphName, {
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

    const checksCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schemaChecks)
      .where(conditions);

    if (checksCount.length === 0) {
      return 0;
    }
    return checksCount[0].count;
  }

  public async checkDetails(
    id: string,
    federatedTargetID: string,
    federatedGraphName: string,
  ): Promise<SchemaCheckDetailsDTO | undefined> {
    const changes = await this.db.query.schemaCheckChangeAction.findMany({
      columns: {
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

    const check = await this.db.query.schemaChecks.findFirst({
      where: eq(schema.schemaChecks.id, id),
    });

    if (!check) {
      return;
    }

    const subgraphs = await this.listByFederatedGraph(federatedGraphName, {
      published: true,
    });

    return {
      check: {
        id: check.id,
        targetID: check.targetId,
        subgraphName: subgraphs.find((s) => s.targetId === check.targetId)?.name ?? '',
        timestamp: check.createdAt.toISOString(),
        isBreaking: check.hasBreakingChanges ?? false,
        isComposable: check.isComposable ?? false,
        proposedSubgraphSchemaSDL: check.proposedSubgraphSchemaSDL ?? undefined,
        isForcedSuccess: check.forcedSuccess ?? false,
      },
      changes: changes.map((c) => ({
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

  public async exists(name: string) {
    const res = await this.byName(name);
    return res !== undefined;
  }

  public async delete(targetID: string) {
    await this.db.delete(targets).where(eq(targets.id, targetID)).execute();
  }

  public async byGraphLabelMatchers(labelMatchers: string[]): Promise<SubgraphDTO[]> {
    const groupedLabels: Label[][] = [];
    for (const lm of labelMatchers) {
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

    const subgraphs = await this.db
      .select({ id: schema.subgraphs.id, name: schema.targets.name })
      .from(targets)
      .where(and(eq(targets.organizationId, this.organizationId), eq(targets.type, 'subgraph'), ...conditions))
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, targets.id))
      .execute();

    const subgraphDTOs: SubgraphDTO[] = [];

    for (const target of subgraphs) {
      const subgraph = await this.byName(target.name);
      if (subgraph === undefined) {
        throw new Error(`Subgraph ${target.name} not found`);
      }

      subgraphDTOs.push(subgraph);
    }

    return subgraphDTOs;
  }
}
