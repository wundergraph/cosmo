import { VCSContext } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import _ from 'lodash';
import pLimit from 'p-limit';
import { NewSchemaChangeOperationUsage } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import {
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  schemaCheckComposition,
  schemaChecks,
} from '../../db/schema.js';
import { ComposedFederatedGraph } from '../composition/composer.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { InspectorOperationResult } from '../services/SchemaUsageTrafficInspector.js';
import { createBatches } from '../util.js';
import { CheckedSubgraphDTO } from '../../types/index.js';
import { FederatedGraphConfig } from './FederatedGraphRepository.js';

export class SchemaCheckRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async create(data: {
    targetId?: string;
    isComposable?: boolean;
    isDeleted?: boolean;
    // TODO: remove proposedSubgraphSchemaSDL as we will be storing those in the schema_check_subgraphs table
    proposedSubgraphSchemaSDL: string;
    trafficCheckSkipped?: boolean;
    lintSkipped?: boolean;
    graphPruningSkipped?: boolean;
    vcsContext?: VCSContext;
  }): Promise<string> {
    const insertedSchemaCheck = await this.db
      .insert(schemaChecks)
      .values({
        targetId: data.targetId,
        isComposable: data.isComposable,
        isDeleted: data.isDeleted,
        proposedSubgraphSchemaSDL: data.proposedSubgraphSchemaSDL,
        clientTrafficCheckSkipped: data.trafficCheckSkipped || false,
        lintSkipped: data.lintSkipped || false,
        graphPruningSkipped: data.graphPruningSkipped || false,
        vcsContext: data.vcsContext
          ? {
              author: data.vcsContext.author,
              commitSha: data.vcsContext.commitSha,
              branch: data.vcsContext.branch,
            }
          : null,
      })
      .returning()
      .execute();
    return insertedSchemaCheck[0].id;
  }

  public async update(data: {
    schemaCheckID: string;
    isComposable?: boolean;
    hasClientTraffic?: boolean;
    hasBreakingChanges?: boolean;
    hasLintErrors?: boolean;
    hasGraphPruningErrors?: boolean;
  }): Promise<string | undefined> {
    const updatedSchemaCheck = await this.db
      .update(schemaChecks)
      .set({
        isComposable: data.isComposable,
        hasBreakingChanges: data.hasBreakingChanges,
        hasClientTraffic: data.hasClientTraffic,
        hasLintErrors: data.hasLintErrors,
        hasGraphPruningErrors: data.hasGraphPruningErrors,
      })
      .where(eq(schemaChecks.id, data.schemaCheckID))
      .returning()
      .execute();
    return updatedSchemaCheck[0].id;
  }

  public createSchemaCheckChanges(data: {
    schemaCheckID: string;
    changes: SchemaDiff[];
    schemaCheckSubgraphId: string;
  }) {
    if (data.changes.length === 0) {
      return [];
    }
    return this.db
      .insert(schemaCheckChangeAction)
      .values(
        data.changes.map((change) => ({
          schemaCheckId: data.schemaCheckID,
          changeType: change.changeType,
          changeMessage: change.message,
          path: change.path,
          isBreaking: change.isBreaking,
          schemaCheckSubgraphId: data.schemaCheckSubgraphId,
        })),
      )
      .returning();
  }

  public async createOperationUsage(
    schemaCheckActionOperations: Map<string, InspectorOperationResult[]>,
    federatedGraphId: string,
  ) {
    const values: NewSchemaChangeOperationUsage[] = [];
    const limit = pLimit(10);

    for (const [schemaCheckChangeActionId, operations] of schemaCheckActionOperations.entries()) {
      values.push(
        ...operations.map(
          (op) =>
            ({
              schemaCheckChangeActionId,
              name: op.name,
              type: op.type,
              hash: op.hash,
              firstSeenAt: op.firstSeenAt,
              lastSeenAt: op.lastSeenAt,
              federatedGraphId,
              isSafeOverride: op.isSafeOverride,
            }) as NewSchemaChangeOperationUsage,
        ),
      );
    }

    if (values.length === 0) {
      return;
    }

    const arrayOfValues: NewSchemaChangeOperationUsage[][] = createBatches<NewSchemaChangeOperationUsage>(values, 1000);
    const promises = [];

    for (const values of arrayOfValues) {
      promises.push(limit(() => this.db.insert(schemaCheckChangeActionOperationUsage).values(values).execute()));
    }

    await Promise.all(promises);
  }

  private mapChangesFromDriverValue = (val: any) => {
    if (typeof val === 'string' && val.length > 0 && val !== '{}') {
      const pairs = val.slice(2, -2).split('","');

      return pairs.map((pair) => {
        const [changeType, path] = pair.slice(1, -1).split(',');
        return { changeType, path };
      });
    }
    return [];
  };

  public async checkClientTrafficAgainstOverrides(data: {
    changes: { id: string; changeType: string | null; path: string | null }[];
    inspectorResultsByChangeId: Map<string, InspectorOperationResult[]>;
    namespaceId: string;
  }) {
    let hasUnsafeClientTraffic = false;

    const result = _.cloneDeep(data.inspectorResultsByChangeId);

    const changeActionsByOperationHash: Map<string, typeof data.changes> = new Map();

    for (const [schemaCheckChangeId, operationResults] of result.entries()) {
      for (const operationResult of operationResults) {
        const { hash } = operationResult;
        if (!changeActionsByOperationHash.has(hash)) {
          changeActionsByOperationHash.set(hash, []);
        }

        const change = data.changes.find((c) => c.id === schemaCheckChangeId);
        if (change) {
          changeActionsByOperationHash.get(hash)?.push(change);
        }
      }
    }

    for (const [hash, changes] of changeActionsByOperationHash) {
      const incomingChanges = `array[${changes.map((c) => `('${c.changeType}'::schema_change_type, '${c.path}'::text)`)}]`;
      const storedChanges = `array_agg(distinct (${schema.operationChangeOverrides.changeType.name}, ${schema.operationChangeOverrides.path.name}))`;

      // Incoming changes are new breaking changes detected in the current check run
      // Stored changes are a a list of changes that have been marked as safe (override) by the user
      // Here except tells us the incoming changes that are not safe and an intersect tells us the incoming changes that are safe
      const res = await this.db
        .select({
          unsafeChanges: sql
            .raw(`array(select unnest(${incomingChanges}) except select unnest(${storedChanges}))`)
            .mapWith({
              mapFromDriverValue: this.mapChangesFromDriverValue,
            }),
          safeChanges: sql
            .raw(`array(select unnest(${incomingChanges}) intersect select unnest(${storedChanges}))`)
            .mapWith({
              mapFromDriverValue: this.mapChangesFromDriverValue,
            }),
        })
        .from(schema.operationChangeOverrides)
        .where(
          and(
            eq(schema.operationChangeOverrides.hash, hash),
            eq(schema.operationChangeOverrides.namespaceId, data.namespaceId),
          ),
        )
        .groupBy(schema.operationChangeOverrides.hash);

      const ignoreAll = await this.db.query.operationIgnoreAllOverrides.findFirst({
        where: and(
          eq(schema.operationIgnoreAllOverrides.hash, hash),
          eq(schema.operationIgnoreAllOverrides.namespaceId, data.namespaceId),
        ),
      });

      if (res.length === 0 && !ignoreAll) {
        // If no safe overrides are found, then mark traffic as unsafe
        hasUnsafeClientTraffic = true;
        continue;
      }

      const safeChanges = ignoreAll ? changes : res[0].safeChanges;

      for (const safeChange of safeChanges) {
        const change = changes.find((c) => c.changeType === safeChange.changeType && c.path === safeChange.path);
        if (!change) {
          continue;
        }

        const op = result.get(change.id)?.find((c) => c.hash === hash);
        if (!op) {
          continue;
        }

        op.isSafeOverride = true;
      }

      if (!ignoreAll && res[0].unsafeChanges.length > 0) {
        hasUnsafeClientTraffic = true;
      }
    }

    return { hasUnsafeClientTraffic, result };
  }

  public async createCheckedFederatedGraph(schemaCheckId: string, federatedGraphId: string, trafficCheckDays: number) {
    const result = await this.db
      .insert(schema.schemaCheckFederatedGraphs)
      .values({
        checkId: schemaCheckId,
        federatedGraphId,
        trafficCheckDays,
      })
      .returning();

    return result[0].id;
  }

  public async getAffectedOperationsByCheckId({
    checkId,
    limit,
    offset,
  }: {
    checkId: string;
    limit?: number;
    offset?: number;
  }) {
    const changeActionIds = (
      await this.db.query.schemaCheckChangeAction.findMany({
        where: and(
          eq(schema.schemaCheckChangeAction.schemaCheckId, checkId),
          eq(schema.schemaCheckChangeAction.isBreaking, true),
        ),
        columns: {
          id: true,
        },
      })
    ).map((r) => r.id);

    if (changeActionIds.length > 0) {
      const dbQuery = this.db
        .selectDistinctOn([schema.schemaCheckChangeActionOperationUsage.hash], {
          hash: schema.schemaCheckChangeActionOperationUsage.hash,
          name: schema.schemaCheckChangeActionOperationUsage.name,
          type: schema.schemaCheckChangeActionOperationUsage.type,
          firstSeenAt: sql`min(${schema.schemaCheckChangeActionOperationUsage.firstSeenAt})`.mapWith({
            mapFromDriverValue: (value) => new Date(value).toUTCString(),
          }),
          lastSeenAt: sql`max(${schema.schemaCheckChangeActionOperationUsage.lastSeenAt})`.mapWith({
            mapFromDriverValue: (value) => new Date(value).toUTCString(),
          }),
          schemaChangeIds: sql<
            string[]
          >`array_agg(${schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId})`,
          isSafe: sql<boolean>`true = all(array_agg(${schema.schemaCheckChangeActionOperationUsage.isSafeOverride}))`,
        })
        .from(schema.schemaCheckChangeActionOperationUsage)
        .where(inArray(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, changeActionIds))
        .groupBy(({ hash, name, type }) => [hash, name, type]);

      if (limit) {
        dbQuery.limit(limit);
      }

      if (offset) {
        dbQuery.offset(offset);
      }

      return await dbQuery.execute();
    }

    return [];
  }

  public async getAffectedOperationsCountByCheckId({ checkId }: { checkId: string }) {
    const changeActionIds = (
      await this.db.query.schemaCheckChangeAction.findMany({
        where: and(
          eq(schema.schemaCheckChangeAction.schemaCheckId, checkId),
          eq(schema.schemaCheckChangeAction.isBreaking, true),
        ),
        columns: {
          id: true,
        },
      })
    ).map((r) => r.id);

    if (changeActionIds.length > 0) {
      const result = await this.db
        .selectDistinctOn([schema.schemaCheckChangeActionOperationUsage.hash], {
          hash: schema.schemaCheckChangeActionOperationUsage.hash,
          name: schema.schemaCheckChangeActionOperationUsage.name,
          type: schema.schemaCheckChangeActionOperationUsage.type,
        })
        .from(schema.schemaCheckChangeActionOperationUsage)
        .where(inArray(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, changeActionIds))
        .groupBy(({ hash, name, type }) => [hash, name, type])
        .execute();

      return result.length;
    }

    return 0;
  }

  public createSchemaCheckCompositions(data: { schemaCheckID: string; compositions: ComposedFederatedGraph[] }) {
    if (data.compositions.length === 0) {
      return;
    }

    return this.db.transaction(async (tx) => {
      // let's check if the subgraph change has produced any composition error.
      // In that case, we will mark all checks as not composable
      const hasCompositionErrors = data.compositions.some((composition) => composition.errors.length > 0);

      await tx
        .insert(schemaCheckComposition)
        .values(
          data.compositions.map((composition) => ({
            federatedTargetId: composition.targetID,
            schemaCheckId: data.schemaCheckID,
            composedSchemaSDL: composition.composedSchema,
            clientSchema: composition.federatedClientSchema,
            compositionErrors: composition.errors?.map((e) => e.toString()).join('\n'),
            compositionWarnings: composition.warnings?.map((w) => w.toString()).join('\n'),
          })),
        )
        .execute();

      // update the isComposable column in schema_checks table
      await tx
        .update(schemaChecks)
        .set({
          isComposable: !hasCompositionErrors,
        })
        .where(eq(schemaChecks.id, data.schemaCheckID))
        .returning()
        .execute();
    });
  }

  public async getFederatedGraphConfigForCheckId(
    checkId: string,
    federatedGraphId: string,
  ): Promise<FederatedGraphConfig> {
    const result = await this.db.query.schemaCheckFederatedGraphs.findFirst({
      where: and(
        eq(schema.schemaCheckFederatedGraphs.checkId, checkId),
        eq(schema.schemaCheckFederatedGraphs.federatedGraphId, federatedGraphId),
      ),
    });

    return {
      trafficCheckDays: result?.trafficCheckDays ?? 7,
    };
  }

  public async createSchemaCheckSubgraph({
    data,
  }: {
    data: {
      schemaCheckId: string;
      subgraphId: string;
      subgraphName: string;
      proposedSubgraphSchemaSDL: string;
      isDeleted: boolean;
      isNew: boolean;
    };
  }) {
    const schemaCheckSubgraph = await this.db.insert(schema.schemaCheckSubgraphs).values(data).returning();
    return schemaCheckSubgraph[0].id;
  }

  public async getCheckedSubgraphsForCheckIdAndFederatedGraphId({
    checkId,
    federatedGraphId,
  }: {
    checkId: string;
    federatedGraphId: string;
  }): Promise<CheckedSubgraphDTO[]> {
    const result = await this.db
      .select({
        id: schema.schemaCheckSubgraphs.id,
        subgraphId: schema.schemaCheckSubgraphs.subgraphId,
        subgraphName: schema.schemaCheckSubgraphs.subgraphName,
        isDeleted: schema.schemaCheckSubgraphs.isDeleted,
        isNew: schema.schemaCheckSubgraphs.isNew,
      })
      .from(schema.schemaCheckFederatedGraphs)
      .innerJoin(
        schema.schemaCheckSubgraphsFederatedGraphs,
        eq(
          schema.schemaCheckFederatedGraphs.id,
          schema.schemaCheckSubgraphsFederatedGraphs.schemaCheckFederatedGraphId,
        ),
      )
      .innerJoin(
        schema.schemaCheckSubgraphs,
        eq(schema.schemaCheckSubgraphsFederatedGraphs.schemaCheckSubgraphId, schema.schemaCheckSubgraphs.id),
      )
      .where(
        and(
          eq(schema.schemaCheckFederatedGraphs.checkId, checkId),
          eq(schema.schemaCheckFederatedGraphs.federatedGraphId, federatedGraphId),
        ),
      );

    return result.map((subgraph) => ({
      id: subgraph.id,
      subgraphId: subgraph.subgraphId || undefined,
      subgraphName: subgraph.subgraphName,
      isDeleted: subgraph.isDeleted,
      isNew: subgraph.isNew,
    }));
  }

  public getProposedSchemaOfCheckedSubgraph({
    checkId,
    checkedSubgraphId,
  }: {
    checkId: string;
    checkedSubgraphId: string;
  }) {
    return this.db.query.schemaCheckSubgraphs.findFirst({
      where: and(
        eq(schema.schemaCheckSubgraphs.schemaCheckId, checkId),
        eq(schema.schemaCheckSubgraphs.id, checkedSubgraphId),
      ),
      columns: {
        proposedSubgraphSchemaSDL: true,
      },
    });
  }

  public async createSchemaCheckSubgraphFederatedGraphs({
    schemaCheckFederatedGraphId,
    checkSubgraphIds,
  }: {
    schemaCheckFederatedGraphId: string;
    checkSubgraphIds: string[];
  }) {
    await this.db
      .insert(schema.schemaCheckSubgraphsFederatedGraphs)
      .values(
        checkSubgraphIds.map((checkSubgraphId) => ({
          schemaCheckFederatedGraphId,
          schemaCheckSubgraphId: checkSubgraphId,
        })),
      )
      .execute();
  }
}
