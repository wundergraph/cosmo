import { PlainMessage } from '@bufbuild/protobuf';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CompositionError,
  CompositionWarning,
  GraphPruningIssue,
  LintIssue,
  ProposalSubgraph,
  SchemaChange,
  VCSContext,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { and, eq, ilike, inArray, is, or, SQL, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { GraphQLSchema, parse } from 'graphql';
import _ from 'lodash';
import pLimit from 'p-limit';
import { NewSchemaChangeOperationUsage, ProposalMatch } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import {
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  schemaCheckComposition,
  schemaChecks,
} from '../../db/schema.js';
import {
  CheckedSubgraphDTO,
  FederatedGraphDTO,
  Label,
  NamespaceDTO,
  SchemaGraphPruningIssues,
  SchemaLintIssues,
} from '../../types/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { CheckSubgraph, ComposedFederatedGraph, Composer } from '../composition/composer.js';
import { buildSchema } from '../composition/composition.js';
import { getDiffBetweenGraphs, SchemaDiff } from '../composition/schemaCheck.js';
import {
  collectOperationUsageStats,
  InspectorOperationResult,
  InspectorSchemaChange,
  SchemaUsageTrafficInspector,
} from '../services/SchemaUsageTrafficInspector.js';
import {
  clamp,
  createBatches,
  getFederatedGraphRouterCompatibilityVersion,
  isCheckSuccessful,
  normalizeLabels,
} from '../util.js';
import { FederatedGraphConfig, FederatedGraphRepository } from './FederatedGraphRepository.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { ProposalRepository } from './ProposalRepository.js';
import { SchemaGraphPruningRepository } from './SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from './SchemaLintRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { NamespaceRepository } from './NamespaceRepository.js';

export class SchemaCheckRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async create(data: {
    targetId?: string;
    isComposable?: boolean;
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
        isDeleted: null,
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
    proposalMatch?: ProposalMatch;
    lintSkipped?: boolean;
    graphPruningSkipped?: boolean;
    trafficCheckSkipped?: boolean;
    compositionSkipped?: boolean;
    breakingChangesSkipped?: boolean;
    errorMessage?: string;
  }): Promise<string | undefined> {
    const updatedSchemaCheck = await this.db
      .update(schemaChecks)
      .set({
        isComposable: data.isComposable,
        hasBreakingChanges: data.hasBreakingChanges,
        hasClientTraffic: data.hasClientTraffic,
        hasLintErrors: data.hasLintErrors,
        hasGraphPruningErrors: data.hasGraphPruningErrors,
        proposalMatch: data.proposalMatch,
        lintSkipped: data.lintSkipped,
        graphPruningSkipped: data.graphPruningSkipped,
        clientTrafficCheckSkipped: data.trafficCheckSkipped,
        compositionSkipped: data.compositionSkipped,
        breakingChangesSkipped: data.breakingChangesSkipped,
        errorMessage: data.errorMessage,
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
    const existing = await this.db.query.schemaCheckFederatedGraphs.findFirst({
      where: and(
        eq(schema.schemaCheckFederatedGraphs.checkId, schemaCheckId),
        eq(schema.schemaCheckFederatedGraphs.federatedGraphId, federatedGraphId),
      ),
    });

    if (existing) {
      return existing.id;
    }

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
    search,
  }: {
    checkId: string;
    limit?: number;
    offset?: number;
    search?: string;
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
      const conditions: (SQL<unknown> | undefined)[] = [];

      if (search) {
        conditions.push(
          or(
            ilike(schema.schemaCheckChangeActionOperationUsage.name, `%${search}%`),
            ilike(schema.schemaCheckChangeActionOperationUsage.hash, `%${search}%`),
          ),
        );
      }

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
        .where(
          and(
            inArray(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, changeActionIds),
            ...conditions,
          ),
        )
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

  public async getAffectedOperationsCountByCheckId({ checkId, search }: { checkId: string; search?: string }) {
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
      const conditions: (SQL<unknown> | undefined)[] = [];

      if (search) {
        conditions.push(
          or(
            ilike(schema.schemaCheckChangeActionOperationUsage.name, `%${search}%`),
            ilike(schema.schemaCheckChangeActionOperationUsage.hash, `%${search}%`),
          ),
        );
      }

      const result = await this.db
        .selectDistinctOn([schema.schemaCheckChangeActionOperationUsage.hash], {
          hash: schema.schemaCheckChangeActionOperationUsage.hash,
          name: schema.schemaCheckChangeActionOperationUsage.name,
          type: schema.schemaCheckChangeActionOperationUsage.type,
        })
        .from(schema.schemaCheckChangeActionOperationUsage)
        .where(
          and(
            inArray(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, changeActionIds),
            ...conditions,
          ),
        )
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
      subgraphId?: string;
      subgraphName: string;
      proposedSubgraphSchemaSDL: string;
      isDeleted: boolean;
      isNew: boolean;
      namespaceId: string;
      labels?: Label[];
    };
  }) {
    const schemaCheckSubgraph = await this.db
      .insert(schema.schemaCheckSubgraphs)
      .values({
        ...data,
        labels: data.isNew && data.labels ? normalizeLabels(data.labels).map((l) => joinLabel(l)) : undefined,
      })
      .returning();
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
        labels: schema.schemaCheckSubgraphs.labels,
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
      labels: subgraph.labels ? subgraph.labels.map((l) => splitLabel(l)) : [],
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

  public async checkMultipleSchemas({
    organizationId,
    organizationSlug,
    subgraphs,
    namespace,
    orgRepo,
    subgraphRepo,
    fedGraphRepo,
    schemaLintRepo,
    schemaGraphPruningRepo,
    proposalRepo,
    composer,
    trafficInspector,
    logger,
    vcsContext,
    chClient,
    skipProposalMatchCheck,
  }: {
    organizationId: string;
    organizationSlug: string;
    orgRepo: OrganizationRepository;
    subgraphRepo: SubgraphRepository;
    fedGraphRepo: FederatedGraphRepository;
    schemaLintRepo: SchemaLintRepository;
    schemaGraphPruningRepo: SchemaGraphPruningRepository;
    proposalRepo: ProposalRepository;
    trafficInspector: SchemaUsageTrafficInspector;
    composer: Composer;
    // proposal subgraphs do not contain feature subgraphs
    subgraphs: ProposalSubgraph[];
    namespace: NamespaceDTO;
    logger: FastifyBaseLogger;
    vcsContext?: VCSContext;
    chClient?: ClickHouseClient;
    skipProposalMatchCheck: boolean;
  }) {
    const breakingChanges: SchemaChange[] = [];
    const nonBreakingChanges: SchemaChange[] = [];
    const lintWarnings: LintIssue[] = [];
    const lintErrors: LintIssue[] = [];
    const graphPruneWarnings: GraphPruningIssue[] = [];
    const graphPruneErrors: GraphPruningIssue[] = [];
    const inspectedOperations: InspectorOperationResult[] = [];
    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    const federatedGraphs: FederatedGraphDTO[] = [];
    const checkSubgraphs: Map<string, CheckSubgraph> = new Map();

    const changeRetention = await orgRepo.getFeature({
      organizationId,
      featureId: 'breaking-change-retention',
    });

    const limit = changeRetention?.limit ?? 7;

    const schemaCheckID = await this.create({
      proposedSubgraphSchemaSDL: '',
      lintSkipped: !namespace.enableLinting,
      graphPruningSkipped: !namespace.enableGraphPruning,
      vcsContext,
    });

    const linkedSubgraphs: {
      id: string;
      name: string;
      namespace: string;
      baseSubgraphName: string;
    }[] = [];

    for (const s of subgraphs) {
      const subgraph = await subgraphRepo.byName(s.name, namespace.name);
      const newSchemaSDL = s.isDeleted ? '' : s.schemaSDL;
      const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion(federatedGraphs);

      const graphs = await fedGraphRepo.bySubgraphLabels({
        labels: subgraph?.labels || s.labels,
        namespaceId: namespace.id,
      });

      const schemaCheckSubgraphId = await this.createSchemaCheckSubgraph({
        data: {
          schemaCheckId: schemaCheckID,
          subgraphId: subgraph?.id,
          subgraphName: s.name,
          proposedSubgraphSchemaSDL: newSchemaSDL,
          isDeleted: newSchemaSDL === '',
          isNew: !subgraph,
          namespaceId: namespace.id,
          labels: subgraph ? undefined : s.labels,
        },
      });

      if (subgraph) {
        const linkedSubgraph = await subgraphRepo.getLinkedSubgraph({ sourceSubgraphId: subgraph.id });
        if (linkedSubgraph) {
          linkedSubgraphs.push({
            id: linkedSubgraph.targetSubgraphId,
            name: linkedSubgraph.targetSubgraphName,
            namespace: linkedSubgraph.targetSubgraphNamespace,
            baseSubgraphName: s.name,
          });
        }
      }

      for (const graph of graphs) {
        // if the check federated graph already exists, we don't need to create a new one
        const checkFederatedGraphId = await this.createCheckedFederatedGraph(schemaCheckID, graph.id, limit);
        await this.createSchemaCheckSubgraphFederatedGraphs({
          schemaCheckFederatedGraphId: checkFederatedGraphId,
          checkSubgraphIds: [schemaCheckSubgraphId],
        });
      }

      federatedGraphs.push(...graphs.filter((g) => !federatedGraphs.some((fg) => fg.id === g.id)));

      let newGraphQLSchema: GraphQLSchema | undefined;
      if (newSchemaSDL) {
        try {
          // Here we check if the schema is valid as a subgraph SDL
          const result = buildSchema(newSchemaSDL, true, routerCompatibilityVersion);
          if (!result.success) {
            await this.update({
              schemaCheckID,
              compositionSkipped: true,
              breakingChangesSkipped: true,
              trafficCheckSkipped: true,
              graphPruningSkipped: true,
              lintSkipped: true,
              errorMessage: `Invalid schema of subgraph '${s.name}'`,
            });

            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
                details: result.errors.map((e) => e.toString()).join('\n'),
              },
              breakingChanges: [],
              nonBreakingChanges: [],
              compositionErrors: [],
              checkId: schemaCheckID,
              lintWarnings: [],
              lintErrors: [],
              graphPruneWarnings: [],
              graphPruneErrors: [],
              compositionWarnings: [],
            };
          }
          if (namespace.enableGraphPruning) {
            const parsedSchema = parse(newSchemaSDL);
            // this new GraphQL schema conatins the location info
            newGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
          }
        } catch (e: any) {
          await this.update({
            schemaCheckID,
            compositionSkipped: true,
            breakingChangesSkipped: true,
            trafficCheckSkipped: true,
            graphPruningSkipped: true,
            lintSkipped: true,
            errorMessage: `Invalid schema of subgraph '${s.name}'`,
          });

          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: schemaCheckID,
            lintWarnings: [],
            lintErrors: [],
            graphPruneWarnings: [],
            graphPruneErrors: [],
            compositionWarnings: [],
          };
        }
      }

      const schemaChanges = await getDiffBetweenGraphs(
        subgraph?.schemaSDL || '',
        newSchemaSDL,
        routerCompatibilityVersion,
      );
      if (schemaChanges.kind === 'failure') {
        logger.warn(`Error finding diff between graphs of the subgraph ${s.name}: ${schemaChanges.error}`);

        await this.update({
          schemaCheckID,
          compositionSkipped: true,
          breakingChangesSkipped: true,
          trafficCheckSkipped: true,
          graphPruningSkipped: true,
          lintSkipped: true,
          errorMessage: `Breaking change detection failed for the subgraph '${s.name}'`,
        });

        return {
          response: {
            code: schemaChanges.errorCode,
            details: schemaChanges.errorMessage,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: schemaCheckID,
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
        };
      }

      checkSubgraphs.set(s.name, {
        subgraph,
        newSchemaSDL,
        newGraphQLSchema,
        schemaChanges,
        inspectorChanges: [],
        storedBreakingChanges: [],
        checkSubgraphId: schemaCheckSubgraphId,
        routerCompatibilityVersion,
        labels: s.isNew ? s.labels : undefined,
      });
    }

    let proposalMatchMessage: string | undefined;
    for (const [subgraphName, checkSubgraph] of checkSubgraphs.entries()) {
      const {
        subgraph,
        newSchemaSDL,
        newGraphQLSchema,
        schemaChanges,
        routerCompatibilityVersion,
        checkSubgraphId: schemaCheckSubgraphId,
      } = checkSubgraph;
      if (namespace.enableProposals && !skipProposalMatchCheck) {
        const proposalConfig = await proposalRepo.getProposalConfig({ namespaceId: namespace.id });
        // currently matching only with the subgraph that is already present in the namespace
        if (proposalConfig) {
          const match = await proposalRepo.matchSchemaWithProposal({
            subgraphName,
            namespaceId: namespace.id,
            schemaSDL: newSchemaSDL,
            routerCompatibilityVersion,
            schemaCheckId: schemaCheckID,
            isDeleted: newSchemaSDL === '',
          });

          await this.update({
            schemaCheckID,
            proposalMatch: match ? 'success' : proposalConfig.checkSeverityLevel === 'warn' ? 'warn' : 'error',
          });

          if (!match) {
            if (proposalConfig.checkSeverityLevel === 'warn') {
              proposalMatchMessage += `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.\n`;
            } else {
              await this.update({
                schemaCheckID,
                compositionSkipped: true,
                breakingChangesSkipped: true,
                trafficCheckSkipped: true,
                graphPruningSkipped: true,
                lintSkipped: true,
              });

              return {
                response: {
                  code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL,
                  details: `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
                },
                breakingChanges: [],
                nonBreakingChanges: [],
                compositionErrors: [],
                checkId: schemaCheckID,
                lintWarnings: [],
                lintErrors: [],
                graphPruneWarnings: [],
                graphPruneErrors: [],
                compositionWarnings: [],
                proposalMatchMessage: `The subgraph ${subgraphName}'s schema does not match to this subgraph's schema in any approved proposal.`,
              };
            }
          }
        }
      }

      await this.createSchemaCheckChanges({
        changes: schemaChanges.nonBreakingChanges,
        schemaCheckID,
        schemaCheckSubgraphId,
      });

      const storedBreakingChanges = await this.createSchemaCheckChanges({
        changes: schemaChanges.breakingChanges,
        schemaCheckID,
        schemaCheckSubgraphId,
      });

      let inspectorChanges: InspectorSchemaChange[] = [];
      // For operations checks we only consider breaking changes
      inspectorChanges = trafficInspector.schemaChangesToInspectorChanges(
        schemaChanges.breakingChanges,
        storedBreakingChanges,
      );

      checkSubgraphs.set(subgraphName, {
        ...checkSubgraph,
        inspectorChanges,
        storedBreakingChanges,
        checkSubgraphId: schemaCheckSubgraphId,
      });

      const lintIssues: SchemaLintIssues = await schemaLintRepo.performSchemaLintCheck({
        schemaCheckID,
        newSchemaSDL,
        namespaceId: namespace.id,
        isLintingEnabled: namespace.enableLinting,
        schemaCheckSubgraphId,
      });

      let graphPruningIssues: SchemaGraphPruningIssues = {
        warnings: [],
        errors: [],
      };
      if (subgraph) {
        graphPruningIssues = await schemaGraphPruningRepo.performSchemaGraphPruningCheck({
          newGraphQLSchema,
          schemaCheckID,
          subgraph,
          namespaceID: namespace.id,
          organizationID: organizationId,
          isGraphPruningEnabled: namespace.enableGraphPruning,
          schemaChanges,
          chClient,
          fedGraphRepo,
          subgraphRepo,
          rangeInDays: limit,
          schemaCheckSubgraphId,
        });
      }

      breakingChanges.push(
        ...schemaChanges.breakingChanges.map(
          (c) =>
            new SchemaChange({
              ...c,
              subgraphName,
            }),
        ),
      );
      nonBreakingChanges.push(
        ...schemaChanges.nonBreakingChanges.map(
          (c) =>
            new SchemaChange({
              ...c,
              subgraphName,
            }),
        ),
      );
      lintErrors.push(
        ...lintIssues.errors.map(
          (e) =>
            new LintIssue({
              ...e,
              subgraphName,
            }),
        ),
      );
      lintWarnings.push(
        ...lintIssues.warnings.map(
          (w) =>
            new LintIssue({
              ...w,
              subgraphName,
            }),
        ),
      );
      graphPruneErrors.push(
        ...graphPruningIssues.errors.map(
          (e) =>
            new GraphPruningIssue({
              ...e,
              subgraphName,
            }),
        ),
      );
      graphPruneWarnings.push(
        ...graphPruningIssues.warnings.map(
          (w) =>
            new GraphPruningIssue({
              ...w,
              subgraphName,
            }),
        ),
      );
    }

    const { composedGraphs } = await composer.composeWithProposedSchemas({
      inputSubgraphs: checkSubgraphs,
      graphs: federatedGraphs.filter((g) => !g.contract),
    });

    await this.createSchemaCheckCompositions({
      schemaCheckID,
      compositions: composedGraphs,
    });

    let hasClientTraffic = false;

    for (const composition of composedGraphs) {
      for (const error of composition.errors) {
        compositionErrors.push({
          message: error.message,
          federatedGraphName: composition.name,
          namespace: composition.namespace,
          featureFlag: '',
        });
      }

      for (const warning of composition.warnings) {
        compositionWarnings.push({
          message: warning.message,
          federatedGraphName: composition.name,
          namespace: composition.namespace,
          featureFlag: '',
        });
      }

      /*
          We don't collect operation usage when
          1. we have composition errors
          2. when we don't have any inspectable changes.
          3. When user wants to skip the traffic check altogether
          That means any breaking change is really breaking
          */
      for (const [subgraphName, checkSubgraph] of checkSubgraphs.entries()) {
        if (composition.errors.length > 0 || checkSubgraph.inspectorChanges.length === 0) {
          continue;
        }

        let result: Map<string, InspectorOperationResult[]> = new Map();
        if (checkSubgraph.subgraph) {
          result = await trafficInspector.inspect(checkSubgraph.inspectorChanges, {
            daysToConsider: limit,
            federatedGraphId: composition.id,
            organizationId,
            subgraphId: checkSubgraph.subgraph.id,
          });
        }

        if (result.size === 0) {
          continue;
        }

        const overrideCheck = await this.checkClientTrafficAgainstOverrides({
          changes: checkSubgraph.storedBreakingChanges,
          inspectorResultsByChangeId: result,
          namespaceId: namespace.id,
        });

        hasClientTraffic = overrideCheck.hasUnsafeClientTraffic;

        // Store operation usage
        await this.createOperationUsage(overrideCheck.result, composition.id);

        // Collect all inspected operations for later aggregation
        for (const resultElement of overrideCheck.result.values()) {
          inspectedOperations.push(...resultElement);
        }
      }
    }

    // Update the overall schema check with the results
    await this.update({
      schemaCheckID,
      hasClientTraffic,
      hasBreakingChanges: breakingChanges.length > 0,
      hasLintErrors: lintErrors.length > 0,
      hasGraphPruningErrors: graphPruneErrors.length > 0,
    });

    let isLinkedTrafficCheckFailed = false;
    let isLinkedPruningCheckFailed = false;

    for (const linkedSubgraph of linkedSubgraphs) {
      const targetSubgraph = await subgraphRepo.byName(linkedSubgraph.name, linkedSubgraph.namespace);
      if (!targetSubgraph) {
        continue;
      }

      const targetFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: targetSubgraph.labels,
        namespaceId: targetSubgraph.namespaceId,
      });

      const namespaceRepo = new NamespaceRepository(this.db, organizationId);
      const targetNamespace = await namespaceRepo.byId(targetSubgraph.namespaceId);
      if (!targetNamespace) {
        continue;
      }

      let targetLimit = changeRetention?.limit ?? 7;
      targetLimit = clamp(targetNamespace?.checksTimeframeInDays ?? targetLimit, 1, targetLimit);

      const baseCheckSubgraph = checkSubgraphs.get(linkedSubgraph.baseSubgraphName);
      if (!baseCheckSubgraph) {
        continue;
      }

      const newSchemaSDL = baseCheckSubgraph.newSchemaSDL;
      let targetNewGraphQLSchema = baseCheckSubgraph.newGraphQLSchema;
      // If the graph pruning is disabled in the source namespace, the graphql schema is not computed,
      // so here we need to check if the target subgraph has graph pruning enabled and if so, we need to compute the graphql schema
      if (!targetNewGraphQLSchema && targetNamespace.enableGraphPruning && newSchemaSDL) {
        const parsedSchema = parse(newSchemaSDL);
        // this new GraphQL schema contains the location info
        targetNewGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
      }

      const targetCheckResult = await subgraphRepo.performSchemaCheck({
        organizationSlug,
        namespace: targetNamespace,
        subgraphName: targetSubgraph.name,
        newSchemaSDL,
        subgraph: targetSubgraph,
        federatedGraphs: targetFederatedGraphs,
        skipTrafficCheck: false,
        isDeleted: !baseCheckSubgraph.newSchemaSDL,
        isTargetCheck: true,
        limit: targetLimit,
        chClient,
        newGraphQLSchema: targetNewGraphQLSchema,
        disableResolvabilityValidation: false,
      });

      await this.addLinkedSchemaCheck({
        schemaCheckID,
        linkedSchemaCheckID: targetCheckResult.checkId,
      });

      isLinkedTrafficCheckFailed = isLinkedTrafficCheckFailed || targetCheckResult.hasClientTraffic;
      isLinkedPruningCheckFailed = isLinkedPruningCheckFailed || targetCheckResult.graphPruneErrors.length > 0;
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      breakingChanges,
      nonBreakingChanges,
      compositionErrors,
      checkId: schemaCheckID,
      lintWarnings,
      lintErrors,
      graphPruneWarnings,
      graphPruneErrors,
      compositionWarnings,
      operationUsageStats: collectOperationUsageStats(inspectedOperations),
      proposalMatchMessage,
      isLinkedTrafficCheckFailed,
      isLinkedPruningCheckFailed,
    };
  }

  public async createSchemaCheckProposal({ schemaCheckID, proposalID }: { schemaCheckID: string; proposalID: string }) {
    await this.db.insert(schema.proposalChecks).values({
      schemaCheckId: schemaCheckID,
      proposalId: proposalID,
    });
  }

  public async addLinkedSchemaCheck(data: { schemaCheckID: string; linkedSchemaCheckID: string }) {
    if (data.schemaCheckID === data.linkedSchemaCheckID) {
      throw new Error('schemaCheckID and linkedSchemaCheckID must differ');
    }

    await this.db
      .insert(schema.linkedSchemaChecks)
      .values({
        schemaCheckId: data.schemaCheckID,
        linkedSchemaCheckId: data.linkedSchemaCheckID,
      })
      .onConflictDoNothing()
      .execute();
  }

  public async getLinkedSchemaChecks({
    schemaCheckID,
    organizationId,
  }: {
    schemaCheckID: string;
    organizationId: string;
  }) {
    const linkedSchemaChecks = await this.db
      .select({
        linkedSchemaCheckId: schema.linkedSchemaChecks.linkedSchemaCheckId,
      })
      .from(schema.linkedSchemaChecks)
      .where(eq(schema.linkedSchemaChecks.schemaCheckId, schemaCheckID));
    if (linkedSchemaChecks.length === 0) {
      return [];
    }

    const checks = await this.db.query.schemaChecks.findMany({
      where: inArray(
        schema.schemaChecks.id,
        linkedSchemaChecks.map((l) => l.linkedSchemaCheckId),
      ),
      with: {
        affectedGraphs: {
          with: {
            federatedGraph: {
              with: {
                target: {
                  columns: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        subgraphs: {
          columns: {
            subgraphName: true,
          },
          with: {
            namespace: {
              columns: {
                name: true,
                organizationId: true,
              },
            },
          },
        },
      },
    });

    const linkedChecks = [];

    for (const check of checks) {
      if (!check || check.subgraphs.length === 0 || !check.subgraphs[0].namespace) {
        continue;
      }

      // Validate that the check belongs to the correct organization
      if (check.subgraphs[0].namespace.organizationId !== organizationId) {
        continue;
      }

      linkedChecks.push({
        id: check.id,
        affectedGraphNames: check.affectedGraphs.map(({ federatedGraph }) => federatedGraph.target.name),
        subgraphNames: check.subgraphs.map(({ subgraphName }) => subgraphName),
        namespace: check.subgraphs[0].namespace.name,
        hasClientTraffic: check.hasClientTraffic ?? false,
        hasGraphPruningErrors: check.hasGraphPruningErrors ?? false,
        isCheckSuccessful: isCheckSuccessful({
          isComposable: !!check.isComposable,
          isBreaking: !!check.hasBreakingChanges,
          hasClientTraffic: !!check.hasClientTraffic,
          hasLintErrors: !!check.hasLintErrors,
          hasGraphPruningErrors: !!check.hasGraphPruningErrors,
          clientTrafficCheckSkipped: !!check.clientTrafficCheckSkipped,
          hasProposalMatchError: check.proposalMatch === 'error',
        }),
        clientTrafficCheckSkipped: !!check.clientTrafficCheckSkipped,
        graphPruningCheckSkipped: !!check.graphPruningSkipped,
        isForcedSuccess: check.forcedSuccess ?? false,
      });
    }

    return linkedChecks;
  }
}
