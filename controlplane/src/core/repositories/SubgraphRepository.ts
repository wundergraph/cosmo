import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { and, asc, eq, gt, inArray, lt, notInArray, SQL, sql } from 'drizzle-orm';
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
import { updateComposedSchema } from '../composition/updateComposedSchema.js';
import { normalizeLabels } from '../util.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

/**
 * Repository for managing subgraphs.
 */
export class SubgraphRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>, private organizationId: string) {}

  public create(data: { name: string; routingUrl: string; labels: Label[] }): Promise<SubgraphDTO | undefined> {
    const uniqueLabels = normalizeLabels(data.labels);

    return this.db.transaction(async (db) => {
      /**
       * 1. Create a new target of type subgraph.
       * The name is the name of the subgraph.
       */
      const insertedTarget = await db
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
       * 2. Create the subgraph with the initial schema version.
       */
      const insertedGraph = await db
        .insert(subgraphs)
        .values({
          targetId: insertedTarget[0].id,
          routingUrl: data.routingUrl,
        })
        .returning()
        .execute();

      /**
       * 3. Insert into federatedSubgraphs by matching labels
       */

      const fedGraphRepo = new FederatedGraphRepository(db, this.organizationId);
      const graphs = await fedGraphRepo.bySubgraphLabels(uniqueLabels);

      const ops = graphs.map((federatedGraph) => {
        return db
          .insert(subgraphsToFederatedGraph)
          .values({
            federatedGraphId: federatedGraph.id,
            subgraphId: insertedGraph[0].id,
          })
          .execute();
      });

      await Promise.all(ops);

      return this.byName(data.name);
    });
  }

  public async update(data: {
    name: string;
    routingUrl: string;
    labels: Label[];
  }): Promise<{ compositionErrors: CompositionError[]; updatedFederatedGraphs: FederatedGraphDTO[] }> {
    const uniqueLabels = normalizeLabels(data.labels);
    const compositionErrors: CompositionError[] = [];
    const updatedFederatedGraphs: FederatedGraphDTO[] = [];

    const subgraph = await this.byName(data.name);
    if (!subgraph) {
      return { compositionErrors, updatedFederatedGraphs };
    }

    await this.db.transaction(async (db) => {
      const fedGraphRepo = new FederatedGraphRepository(db, this.organizationId);
      const subgraphRepo = new SubgraphRepository(db, this.organizationId);

      // update labels
      if (data.labels.length > 0) {
        const oldGraphs = await fedGraphRepo.bySubgraphLabels(uniqueLabels);

        await db
          .update(targets)
          .set({
            labels: uniqueLabels.map((ul) => joinLabel(ul)),
          })
          .where(eq(targets.id, subgraph.targetId));

        const newGraphs = await fedGraphRepo.bySubgraphLabels(uniqueLabels);

        let deleteCondition: SQL<unknown> | undefined = eq(subgraphsToFederatedGraph.subgraphId, subgraph.id);

        // we do this conditionally because notInArray cannot take empty value
        if (newGraphs.length > 0) {
          deleteCondition = and(
            deleteCondition,
            notInArray(
              subgraphsToFederatedGraph.federatedGraphId,
              newGraphs.map((g) => g.id),
            ),
          );
        }

        await db.delete(subgraphsToFederatedGraph).where(deleteCondition);

        const insertOps = newGraphs.map((federatedGraph) => {
          return db
            .insert(subgraphsToFederatedGraph)
            .values({
              federatedGraphId: federatedGraph.id,
              subgraphId: subgraph.id,
            })
            .onConflictDoNothing()
            .execute();
        });

        await Promise.all(insertOps);

        // update schema of graphs which were changed since subgraphs would have changed
        const changedGraphs = [
          ...oldGraphs.filter((b) => !newGraphs.some((a) => a.id === b.id)),
          ...newGraphs.filter((a) => !oldGraphs.some((b) => a.id === b.id)),
        ];
        updatedFederatedGraphs.push(...changedGraphs);
        changedGraphs.map(async (federatedGraph) => {
          const ce = await updateComposedSchema({
            federatedGraph,
            fedGraphRepo,
            subgraphRepo,
          });
          compositionErrors.push(...ce);
        });
      }

      // update routing URL
      if (data.routingUrl !== '') {
        await db.update(subgraphs).set({ routingUrl: data.routingUrl }).where(eq(subgraphs.id, subgraph.id)).execute();
      }
    });

    return { compositionErrors, updatedFederatedGraphs };
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

      // TODO add changes to changelog table

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
  public async listByGraph(federatedGraphName: string, opts?: { published: boolean }): Promise<SubgraphDTO[]> {
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
    const subgraphs = await this.listByGraph(federatedGraphName, {
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
      },
      limit,
      offset,
      orderBy: asc(schemaChecks.createdAt),
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
    const subgraphs = await this.listByGraph(federatedGraphName, {
      published: true,
    });

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

  public async checkDetails(id: string, federatedTargetID: string): Promise<SchemaCheckDetailsDTO> {
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

    return {
      changes: changes.map((c) => ({
        changeType: c.changeType ?? '',
        message: c.changeMessage ?? '',
        path: c.path ?? undefined,
        isBreaking: c.isBreaking ?? false,
      })),
      compositionErrors,
    };
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
