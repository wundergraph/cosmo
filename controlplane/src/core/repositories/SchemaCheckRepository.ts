import { PlainMessage } from '@bufbuild/protobuf';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckOperationUsageStats,
  CheckOperationUsageStatsofSubgraph,
  CompositionError,
  CompositionWarning,
  GraphPruningIssue,
  LintIssue,
  ProposalSubgraph,
  SchemaChange,
  VCSContext,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { createBatches, getFederatedGraphRouterCompatibilityVersion } from '../util.js';
import { FederatedGraphConfig, FederatedGraphRepository } from './FederatedGraphRepository.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { ProposalRepository } from './ProposalRepository.js';
import { SchemaGraphPruningRepository } from './SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from './SchemaLintRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';

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
    proposalMatch?: ProposalMatch;
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

  public async checkMultipleSchemas({
    organizationId,
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
    orgRepo: OrganizationRepository;
    subgraphRepo: SubgraphRepository;
    fedGraphRepo: FederatedGraphRepository;
    schemaLintRepo: SchemaLintRepository;
    schemaGraphPruningRepo: SchemaGraphPruningRepository;
    proposalRepo: ProposalRepository;
    trafficInspector: SchemaUsageTrafficInspector;
    composer: Composer;
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
    const operationUsageStats: CheckOperationUsageStatsofSubgraph[] = [];

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

    for (const s of subgraphs) {
      const subgraph = await subgraphRepo.byName(s.name, namespace.name);
      // TODO: even if the subgraph is not found, we should still check the schema
      if (!subgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Subgraph '${s.name}' not found`,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          operationUsageStats: [],
        };
      }

      if (subgraph.isFeatureSubgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              `The subgraph "${s.name}" is a feature subgraph.` +
              ` Feature subgraphs do not currently support check operations.`,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          operationUsageStats: [],
        };
      }

      const graphs = await fedGraphRepo.bySubgraphLabels({
        labels: subgraph.labels,
        namespaceId: namespace.id,
        excludeContracts: true,
      });

      federatedGraphs.push(...graphs.filter((g) => !federatedGraphs.some((fg) => fg.id === g.id)));

      const newSchemaSDL = s.isDeleted ? '' : s.schemaSDL;
      const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion(graphs);
      let newGraphQLSchema: GraphQLSchema | undefined;
      if (newSchemaSDL) {
        try {
          // Here we check if the schema is valid as a subgraph SDL
          const result = buildSchema(newSchemaSDL, true, routerCompatibilityVersion);
          if (!result.success) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
                details: result.errors.map((e) => e.toString()).join('\n'),
              },
              breakingChanges: [],
              nonBreakingChanges: [],
              compositionErrors: [],
              checkId: '',
              lintWarnings: [],
              lintErrors: [],
              graphPruneWarnings: [],
              graphPruneErrors: [],
              compositionWarnings: [],
              operationUsageStats: [],
            };
          }
          if (namespace.enableGraphPruning) {
            const parsedSchema = parse(newSchemaSDL);
            // this new GraphQL schema conatins the location info
            newGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
          }
        } catch (e: any) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: '',
            lintWarnings: [],
            lintErrors: [],
            graphPruneWarnings: [],
            graphPruneErrors: [],
            compositionWarnings: [],
            operationUsageStats: [],
          };
        }
      }

      const schemaChanges = await getDiffBetweenGraphs(subgraph.schemaSDL, newSchemaSDL, routerCompatibilityVersion);
      if (schemaChanges.kind === 'failure') {
        logger.warn(`Error finding diff between graphs of the subgraph ${subgraph.name}: ${schemaChanges.error}`);
        return {
          response: {
            code: schemaChanges.errorCode,
            details: schemaChanges.errorMessage,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: schemaCheckID,
          checkedFederatedGraphs: [],
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
          operationUsageStats: [],
        };
      }

      checkSubgraphs.set(s.name, {
        subgraph,
        newSchemaSDL,
        newGraphQLSchema,
        schemaChanges,
        inspectorChanges: [],
        storedBreakingChanges: [],
        checkSubgraphId: '',
        routerCompatibilityVersion,
      });
    }

    let proposalMatchMessage: string | undefined;
    for (const s of checkSubgraphs.values()) {
      const { subgraph, newSchemaSDL, newGraphQLSchema, schemaChanges, routerCompatibilityVersion } = s;
      if (namespace.enableProposals && !skipProposalMatchCheck) {
        const proposalConfig = await proposalRepo.getProposalConfig({ namespaceId: namespace.id });
        if (proposalConfig) {
          const match = await proposalRepo.matchSchemaWithProposal({
            subgraphId: subgraph.id,
            schemaSDL: newSchemaSDL,
            routerCompatibilityVersion,
            schemaCheckId: schemaCheckID,
          });
          
          await this.update({
            schemaCheckID,
            proposalMatch: match ? 'success' : proposalConfig.checkSeverityLevel === 'warn' ? 'warn' : 'error',
          });

          if (!match) {
            if (proposalConfig.checkSeverityLevel === 'warn') {
              proposalMatchMessage += `The subgraph ${subgraph.name}'s schema does not match to this subgraph's schema in any approved proposal.\n`;
            } else {
              return {
                response: {
                  code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL,
                  details: `The subgraph ${subgraph.name}'s schema does not match to this subgraph's schema in any approved proposal.`,
                },
                breakingChanges: [],
                nonBreakingChanges: [],
                compositionErrors: [],
                checkId: '',
                lintWarnings: [],
                lintErrors: [],
                graphPruneWarnings: [],
                graphPruneErrors: [],
                compositionWarnings: [],
                operationUsageStats: [],
                proposalMatchMessage: `The subgraph ${subgraph.name}'s schema does not match to this subgraph's schema in any approved proposal.`,
              };
            }
          }
        }
      }

      const schemaCheckSubgraphId = await this.createSchemaCheckSubgraph({
        data: {
          schemaCheckId: schemaCheckID,
          subgraphId: subgraph.id,
          subgraphName: subgraph.name,
          proposedSubgraphSchemaSDL: newSchemaSDL,
          isDeleted: newSchemaSDL === '',
          isNew: false,
        },
      });

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

      checkSubgraphs.set(subgraph.name, {
        ...s,
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

      const graphPruningIssues: SchemaGraphPruningIssues = await schemaGraphPruningRepo.performSchemaGraphPruningCheck({
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

      breakingChanges.push(
        ...schemaChanges.breakingChanges.map(
          (c) =>
            new SchemaChange({
              ...c,
              subgraphName: subgraph.name,
            }),
        ),
      );
      nonBreakingChanges.push(
        ...schemaChanges.nonBreakingChanges.map(
          (c) =>
            new SchemaChange({
              ...c,
              subgraphName: subgraph.name,
            }),
        ),
      );
      lintErrors.push(
        ...lintIssues.errors.map(
          (e) =>
            new LintIssue({
              ...e,
              subgraphName: subgraph.name,
            }),
        ),
      );
      lintWarnings.push(
        ...lintIssues.warnings.map(
          (w) =>
            new LintIssue({
              ...w,
              subgraphName: subgraph.name,
            }),
        ),
      );
      graphPruneErrors.push(
        ...graphPruningIssues.errors.map(
          (e) =>
            new GraphPruningIssue({
              ...e,
              subgraphName: subgraph.name,
            }),
        ),
      );
      graphPruneWarnings.push(
        ...graphPruningIssues.warnings.map(
          (w) =>
            new GraphPruningIssue({
              ...w,
              subgraphName: subgraph.name,
            }),
        ),
      );
    }

    const { composedGraphs, checkSubgraphsByFedGraph } = await composer.composeWithProposedSchemas({
      inputSubgraphs: checkSubgraphs,
      graphs: federatedGraphs,
    });

    await this.createSchemaCheckCompositions({
      schemaCheckID,
      compositions: composedGraphs,
    });

    let hasClientTraffic = false;

    for (const composition of composedGraphs) {
      const checkFederatedGraphId = await this.createCheckedFederatedGraph(schemaCheckID, composition.id, limit);
      const checkSubgraphsUsedForComposition = checkSubgraphsByFedGraph.get(composition.id);
      if (checkSubgraphsUsedForComposition && checkSubgraphsUsedForComposition.length > 0) {
        await this.createSchemaCheckSubgraphFederatedGraphs({
          schemaCheckFederatedGraphId: checkFederatedGraphId,
          checkSubgraphIds: checkSubgraphsUsedForComposition,
        });
      }

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
      for (const checkSubgraph of checkSubgraphs.values()) {
        if (composition.errors.length > 0 || checkSubgraph.inspectorChanges.length === 0) {
          continue;
        }

        const result = await trafficInspector.inspect(checkSubgraph.inspectorChanges, {
          daysToConsider: limit,
          federatedGraphId: composition.id,
          organizationId,
          subgraphId: checkSubgraph.subgraph.id,
        });

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

        operationUsageStats.push(
          new CheckOperationUsageStatsofSubgraph({
            operationUsageStats: new CheckOperationUsageStats({
              ...collectOperationUsageStats(inspectedOperations),
            }),
            subgraphName: checkSubgraph.subgraph.name,
          }),
        );
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
      operationUsageStats,
      proposalMatchMessage,
    };
  }

  public async createSchemaCheckProposal({ schemaCheckID, proposalID }: { schemaCheckID: string; proposalID: string }) {
    await this.db.insert(schema.schemaCheckProposals).values({
      schemaCheckId: schemaCheckID,
      proposalId: proposalID,
    });
  }
}
