import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckMultipleSubgraphSchemasRequest,
  CheckMultipleSubgraphSchemasResponse,
  CheckOperationUsageStats,
  CheckOperationUsageStatsofSubgraph,
  CompositionError,
  CompositionWarning,
  GraphPruningIssue,
  LintIssue,
  SchemaChange,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphQLSchema, parse } from 'graphql';
import { SchemaGraphPruningIssues, SchemaLintIssues } from '../../../types/index.js';
import { CheckSubgraph, Composer } from '../../composition/composer.js';
import { buildSchema } from '../../composition/composition.js';
import { getDiffBetweenGraphs } from '../../composition/schemaCheck.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  collectOperationUsageStats,
  InspectorOperationResult,
  InspectorSchemaChange,
  SchemaUsageTrafficInspector,
} from '../../services/SchemaUsageTrafficInspector.js';
import { enrichLogger, getFederatedGraphRouterCompatibilityVersion, getLogger, handleError } from '../../util.js';

export function checkMultipleSubgraphSchemas(
  opts: RouterOptions,
  req: CheckMultipleSubgraphSchemasRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckMultipleSubgraphSchemasResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckMultipleSubgraphSchemasResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const schemaLintRepo = new SchemaLintRepository(opts.db);
    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
    const schemaCheckRepo = new SchemaCheckRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
    const graphCompostionRepo = new GraphCompositionRepository(logger, opts.db);
    const trafficInspector = new SchemaUsageTrafficInspector(opts.chClient!);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user does not have the permissions to perform this operation`,
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
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
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
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
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
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    const federatedGraph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
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
        lintingSkipped: false,
        graphPruningSkipped: false,
        checkUrl: '',
      };
    }

    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    const limit = changeRetention?.limit ?? 7;

    const checkSubgraphs: Map<string, CheckSubgraph> = new Map();
    const subgraphsByFederatedGraph = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
    });

    for (const s of subgraphsByFederatedGraph) {
      checkSubgraphs.set(s.name, {
        subgraph: s,
        newSchemaSDL: s.schemaSDL,
        isNewSchemaSDL: false,
        inspectorChanges: [],
        storedBreakingChanges: [],
      });
    }

    const schemaCheckID = await schemaCheckRepo.create({
      targetId: federatedGraph.targetId,
      proposedSubgraphSchemaSDL: '',
      lintSkipped: !namespace.enableLinting,
      graphPruningSkipped: !namespace.enableGraphPruning,
      targetType: 'federated',
    });

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

    for (const s of req.subgraphs) {
      const subgraph = await subgraphRepo.byName(s.name, req.namespace);
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
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
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
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
        };
      }

      const newSchemaSDL = s.delete ? '' : s.schema;
      const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion([federatedGraph]);
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
              lintingSkipped: false,
              graphPruningSkipped: false,
              checkUrl: '',
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
            lintingSkipped: false,
            graphPruningSkipped: false,
            checkUrl: '',
          };
        }
      }

      const schemaCheckSubgraphId = await schemaCheckRepo.createSchemaCheckSubgraph({
        data: {
          schemaCheckId: schemaCheckID,
          subgraphId: subgraph.id,
          subgraphName: subgraph.name,
          proposedSubgraphSchemaSDL: newSchemaSDL,
          isDeleted: !!s.delete,
        },
      });

      const schemaChanges = await getDiffBetweenGraphs(subgraph.schemaSDL, newSchemaSDL, routerCompatibilityVersion);
      if (schemaChanges.kind === 'failure') {
        logger.warn(`Error finding diff between graphs of the subgraph ${s.name}: ${schemaChanges.error}`);
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
          lintingSkipped: false,
          graphPruningSkipped: false,
          checkUrl: '',
        };
      }

      await schemaCheckRepo.createSchemaCheckChanges({
        changes: schemaChanges.nonBreakingChanges,
        schemaCheckID,
        schemaCheckSubgraphId,
      });

      const storedBreakingChanges = await schemaCheckRepo.createSchemaCheckChanges({
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

      checkSubgraphs.set(s.name, {
        subgraph,
        newSchemaSDL,
        newGraphQLSchema,
        isNewSchemaSDL: true,
        inspectorChanges,
        storedBreakingChanges,
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
        organizationID: authContext.organizationId,
        isGraphPruningEnabled: namespace.enableGraphPruning,
        schemaChanges,
        chClient: opts.chClient,
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
              subgraphName: s.name,
            }),
        ),
      );
      nonBreakingChanges.push(
        ...schemaChanges.nonBreakingChanges.map(
          (c) =>
            new SchemaChange({
              ...c,
              subgraphName: s.name,
            }),
        ),
      );
      lintErrors.push(
        ...lintIssues.errors.map(
          (e) =>
            new LintIssue({
              ...e,
              subgraphName: s.name,
            }),
        ),
      );
      lintWarnings.push(
        ...lintIssues.warnings.map(
          (w) =>
            new LintIssue({
              ...w,
              subgraphName: s.name,
            }),
        ),
      );
      graphPruneErrors.push(
        ...graphPruningIssues.errors.map(
          (e) =>
            new GraphPruningIssue({
              ...e,
              subgraphName: s.name,
            }),
        ),
      );
      graphPruneWarnings.push(
        ...graphPruningIssues.warnings.map(
          (w) =>
            new GraphPruningIssue({
              ...w,
              subgraphName: s.name,
            }),
        ),
      );
    }

    const composer = new Composer(
      logger,
      opts.db,
      fedGraphRepo,
      subgraphRepo,
      contractRepo,
      graphCompostionRepo,
      opts.chClient,
    );

    const result = await composer.composeWithProposedSchemas({
      subgraphs: checkSubgraphs,
      graph: federatedGraph,
    });

    await schemaCheckRepo.createSchemaCheckCompositions({
      schemaCheckID,
      compositions: result,
    });

    let hasClientTraffic = false;

    for (const composition of result) {
      await schemaCheckRepo.createCheckedFederatedGraph(schemaCheckID, composition.id, limit);

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
          organizationId: authContext.organizationId,
          subgraphId: checkSubgraph.subgraph.id,
        });

        if (result.size === 0) {
          continue;
        }

        const overrideCheck = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
          changes: checkSubgraph.storedBreakingChanges,
          inspectorResultsByChangeId: result,
          namespaceId: namespace.id,
        });

        hasClientTraffic = overrideCheck.hasUnsafeClientTraffic;

        // Store operation usage
        await schemaCheckRepo.createOperationUsage(overrideCheck.result, composition.id);

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
    await schemaCheckRepo.update({
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
      lintingSkipped: !namespace.enableLinting,
      graphPruningSkipped: !namespace.enableGraphPruning,
      checkUrl: `${process.env.WEB_BASE_URL}/${authContext.organizationSlug}/${namespace.name}/${federatedGraph.name}/checks/${schemaCheckID}`,
    };
  });
}
