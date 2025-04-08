import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckSubgraphSchemaRequest,
  CheckSubgraphSchemaResponse,
  CompositionError,
  CompositionWarning,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphQLSchema, parse } from 'graphql';
import { SchemaGraphPruningIssues, SchemaLintIssues } from '../../../types/index.js';
import { CheckSubgraph, Composer } from '../../composition/composer.js';
import { buildSchema } from '../../composition/composition.js';
import { getDiffBetweenGraphs } from '../../composition/schemaCheck.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../../repositories/GitHubRepository.js';
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
import {
  enrichLogger,
  getFederatedGraphRouterCompatibilityVersion,
  getLogger,
  handleError,
  clamp,
} from '../../util.js';

export function checkSubgraphSchema(
  opts: RouterOptions,
  req: CheckSubgraphSchemaRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckSubgraphSchemaResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckSubgraphSchemaResponse>>(ctx, logger, async () => {
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
        checkedFederatedGraphs: [],
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
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
        checkedFederatedGraphs: [],
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
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
        checkedFederatedGraphs: [],
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
      };
    }

    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph '${req.subgraphName}' not found`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        checkedFederatedGraphs: [],
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
      };
    }

    if (subgraph.isFeatureSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            `The subgraph "${req.subgraphName}" is a feature subgraph.` +
            ` Feature subgraphs do not currently support check operations.`,
        },
        breakingChanges: [],
        nonBreakingChanges: [],
        compositionErrors: [],
        checkId: '',
        checkedFederatedGraphs: [],
        lintWarnings: [],
        lintErrors: [],
        graphPruneWarnings: [],
        graphPruneErrors: [],
        compositionWarnings: [],
      };
    }

    const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
      labels: subgraph.labels,
      namespaceId: namespace.id,
      excludeContracts: true,
    });
    /*
     * If there are any federated graphs for which the subgraph is a constituent, the subgraph will be validated
     * against the first router compatibility version encountered.
     * If no federated graphs have yet been created, the subgraph will be validated against the latest router
     * compatibility version.
     */
    const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion(federatedGraphs);
    const newSchemaSDL = req.delete ? '' : new TextDecoder().decode(req.schema);
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
            checkedFederatedGraphs: [],
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
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
            details: e.message,
          },
          breakingChanges: [],
          nonBreakingChanges: [],
          compositionErrors: [],
          checkId: '',
          checkedFederatedGraphs: [],
          lintWarnings: [],
          lintErrors: [],
          graphPruneWarnings: [],
          graphPruneErrors: [],
          compositionWarnings: [],
        };
      }
    }

    const schemaCheckID = await schemaCheckRepo.create({
      proposedSubgraphSchemaSDL: '',
      trafficCheckSkipped: req.skipTrafficCheck,
      lintSkipped: !namespace.enableLinting,
      graphPruningSkipped: !namespace.enableGraphPruning,
      vcsContext: req.vcsContext,
    });

    const schemaCheckSubgraphId = await schemaCheckRepo.createSchemaCheckSubgraph({
      data: {
        schemaCheckId: schemaCheckID,
        subgraphId: subgraph.id,
        subgraphName: subgraph.name,
        proposedSubgraphSchemaSDL: newSchemaSDL,
        isDeleted: !!req.delete,
        isNew: false,
      },
    });

    const schemaChanges = await getDiffBetweenGraphs(subgraph.schemaSDL, newSchemaSDL, routerCompatibilityVersion);
    if (schemaChanges.kind === 'failure') {
      logger.warn(`Error finding diff between graphs: ${schemaChanges.error}`);
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
      };
    }

    const hasBreakingChanges = schemaChanges.breakingChanges.length > 0;

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

    const composer = new Composer(
      logger,
      opts.db,
      fedGraphRepo,
      subgraphRepo,
      contractRepo,
      graphCompostionRepo,
      opts.chClient,
    );

    const checkSubgraphs = new Map<string, CheckSubgraph>();
    checkSubgraphs.set(subgraph.name, {
      subgraph,
      checkSubgraphId: schemaCheckSubgraphId,
      newSchemaSDL,
      newGraphQLSchema,
      schemaChanges,
      storedBreakingChanges,
      inspectorChanges: [],
    });

    const { composedGraphs } = await composer.composeWithProposedSchemas({
      inputSubgraphs: checkSubgraphs,
      graphs: federatedGraphs,
    });

    await schemaCheckRepo.createSchemaCheckCompositions({
      schemaCheckID,
      compositions: composedGraphs,
    });

    let hasClientTraffic = false;

    const trafficInspector = new SchemaUsageTrafficInspector(opts.chClient!);
    const inspectedOperations: InspectorOperationResult[] = [];
    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    let inspectorChanges: InspectorSchemaChange[] = [];

    // For operations checks we only consider breaking changes
    inspectorChanges = trafficInspector.schemaChangesToInspectorChanges(
      schemaChanges.breakingChanges,
      storedBreakingChanges,
    );

    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    let limit = changeRetention?.limit ?? 7;
    limit = clamp(namespace?.checksTimeframeInDays ?? limit, 1, limit);

    for (const composedGraph of composedGraphs) {
      const checkFederatedGraphId = await schemaCheckRepo.createCheckedFederatedGraph(
        schemaCheckID,
        composedGraph.id,
        limit,
      );
      await schemaCheckRepo.createSchemaCheckSubgraphFederatedGraphs({
        schemaCheckFederatedGraphId: checkFederatedGraphId,
        checkSubgraphIds: [schemaCheckSubgraphId],
      });

      for (const error of composedGraph.errors) {
        compositionErrors.push({
          message: error.message,
          federatedGraphName: composedGraph.name,
          namespace: composedGraph.namespace,
          featureFlag: '',
        });
      }

      for (const warning of composedGraph.warnings) {
        compositionWarnings.push({
          message: warning.message,
          federatedGraphName: composedGraph.name,
          namespace: composedGraph.namespace,
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
      if (composedGraph.errors.length > 0 || inspectorChanges.length === 0 || req.skipTrafficCheck) {
        continue;
      }

      const result = await trafficInspector.inspect(inspectorChanges, {
        daysToConsider: limit,
        federatedGraphId: composedGraph.id,
        organizationId: authContext.organizationId,
        subgraphId: subgraph.id,
      });

      if (result.size === 0) {
        continue;
      }

      const overrideCheck = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
        changes: storedBreakingChanges,
        inspectorResultsByChangeId: result,
        namespaceId: namespace.id,
      });

      hasClientTraffic = overrideCheck.hasUnsafeClientTraffic;

      // Store operation usage
      await schemaCheckRepo.createOperationUsage(overrideCheck.result, composedGraph.id);

      // Collect all inspected operations for later aggregation
      for (const resultElement of overrideCheck.result.values()) {
        inspectedOperations.push(...resultElement);
      }
    }

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

    // Update the overall schema check with the results
    await schemaCheckRepo.update({
      schemaCheckID,
      hasClientTraffic,
      hasBreakingChanges,
      hasLintErrors: lintIssues.errors.length > 0,
      hasGraphPruningErrors: graphPruningIssues.errors.length > 0,
    });

    if (req.gitInfo && opts.githubApp) {
      try {
        const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
        await githubRepo.createCommitCheck({
          namespace: namespace.name,
          schemaCheckID,
          gitInfo: req.gitInfo,
          compositionErrors,
          breakingChangesCount: schemaChanges.breakingChanges.length,
          hasClientTraffic,
          subgraphName: subgraph.name,
          organizationSlug: org.slug,
          webBaseUrl: opts.webBaseUrl,
          composedGraphs: composedGraphs.map((c) => c.name),
        });
      } catch (e) {
        logger.warn(e, 'Error creating commit check');
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      breakingChanges: schemaChanges.breakingChanges,
      nonBreakingChanges: schemaChanges.nonBreakingChanges,
      operationUsageStats: collectOperationUsageStats(inspectedOperations),
      compositionErrors,
      checkId: schemaCheckID,
      checkedFederatedGraphs: composedGraphs.map((c) => ({
        id: c.id,
        name: c.name,
        namespace: c.namespace,
        organizationSlug: authContext.organizationSlug,
      })),
      lintWarnings: lintIssues.warnings,
      lintErrors: lintIssues.errors,
      graphPruneWarnings: graphPruningIssues.warnings,
      graphPruneErrors: graphPruningIssues.errors,
      clientTrafficCheckSkipped: req.skipTrafficCheck,
      compositionWarnings,
    };
  });
}
