import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckSubgraphSchemaRequest,
  CheckSubgraphSchemaResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphQLSchema, parse } from 'graphql';
import { buildSchema } from '../../composition/composition.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../../repositories/GitHubRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  clamp,
  enrichLogger,
  getFederatedGraphRouterCompatibilityVersion,
  getLogger,
  handleError,
  isValidGraphName,
  isValidLabels,
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
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const schemaCheckRepo = new SchemaCheckRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
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
    if (subgraph && subgraph.isFeatureSubgraph) {
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

    let linkedSubgraph:
      | {
          id: string;
          name: string;
          namespace: string;
        }
      | undefined;
    if (subgraph) {
      const linkedSubgraphResult = await subgraphRepo.getLinkedSubgraph({ sourceSubgraphId: subgraph.id });
      if (linkedSubgraphResult) {
        linkedSubgraph = {
          id: linkedSubgraphResult.targetSubgraphId,
          name: linkedSubgraphResult.targetSubgraphName,
          namespace: linkedSubgraphResult.targetSubgraphNamespace,
        };
      }
    }

    if (subgraph && !authContext.rbac.hasSubGraphWriteAccess(subgraph)) {
      throw new UnauthorizedError();
    } else if (!subgraph) {
      if (!authContext.rbac.canCreateSubGraph(namespace)) {
        throw new UnauthorizedError();
      }

      if (!isValidLabels(req.labels)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_LABELS,
            details: `One or more labels were found to be invalid`,
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
      } else if (!isValidGraphName(req.subgraphName)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_NAME,
            details: `The name of the subgraph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
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

    const subgraphName = subgraph?.name || req.subgraphName;

    const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
      labels: subgraph ? subgraph.labels : req.labels,
      namespaceId: namespace.id,
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
          // this new GraphQL schema contains the location info
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

    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    let limit = changeRetention?.limit ?? 7;
    limit = clamp(namespace?.checksTimeframeInDays ?? limit, 1, limit);

    const {
      response,
      checkId: schemaCheckID,
      breakingChanges,
      nonBreakingChanges,
      compositionErrors,
      compositionWarnings,
      operationUsageStats,
      proposalMatchMessage,
      hasClientTraffic,
      checkedFederatedGraphs,
      lintWarnings,
      lintErrors,
      graphPruneWarnings,
      graphPruneErrors,
    } = await subgraphRepo.performSchemaCheck({
      organizationSlug: authContext.organizationSlug,
      namespace,
      subgraphName,
      newSchemaSDL,
      subgraph,
      federatedGraphs,
      skipTrafficCheck: req.skipTrafficCheck,
      vcsContext: req.vcsContext,
      isDeleted: !!req.delete,
      labels: req.labels,
      isTargetCheck: false,
      limit,
      chClient: opts.chClient,
      newGraphQLSchema,
      disableResolvabilityValidation: req.disableResolvabilityValidation,
    });

    if (response && response.code !== EnumStatusCode.OK) {
      return {
        response: {
          code: response.code,
          details: response.details,
        },
        breakingChanges,
        nonBreakingChanges,
        operationUsageStats,
        compositionErrors,
        checkId: schemaCheckID,
        checkedFederatedGraphs,
        lintWarnings,
        lintErrors,
        graphPruneWarnings,
        graphPruneErrors,
        clientTrafficCheckSkipped: req.skipTrafficCheck,
        compositionWarnings,
        proposalMatchMessage,
      };
    }

    let isLinkedTrafficCheckFailed = false;
    let isLinkedPruningCheckFailed = false;

    if (linkedSubgraph) {
      const targetSubgraph = await subgraphRepo.byName(linkedSubgraph.name, linkedSubgraph.namespace);
      if (!targetSubgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `The target subgraph "${linkedSubgraph.name}" was not found.`,
          },
          breakingChanges,
          nonBreakingChanges,
          operationUsageStats,
          compositionErrors,
          checkId: schemaCheckID,
          checkedFederatedGraphs,
          lintWarnings,
          lintErrors,
          graphPruneWarnings,
          graphPruneErrors,
          clientTrafficCheckSkipped: req.skipTrafficCheck,
          compositionWarnings,
          proposalMatchMessage,
          isLinkedTrafficCheckFailed: false,
          isLinkedPruningCheckFailed: false,
        };
      }

      const targetFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: targetSubgraph.labels,
        namespaceId: targetSubgraph.namespaceId,
      });

      const targetNamespace = await namespaceRepo.byId(targetSubgraph.namespaceId);
      if (!targetNamespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `The target namespace "${targetSubgraph.namespaceId}" was not found.`,
          },
          breakingChanges,
          nonBreakingChanges,
          operationUsageStats,
          compositionErrors,
          checkId: schemaCheckID,
          checkedFederatedGraphs,
          lintWarnings,
          lintErrors,
          graphPruneWarnings,
          graphPruneErrors,
          clientTrafficCheckSkipped: req.skipTrafficCheck,
          compositionWarnings,
          proposalMatchMessage,
          isLinkedTrafficCheckFailed: false,
          isLinkedPruningCheckFailed: false,
        };
      }

      let targetLimit = changeRetention?.limit ?? 7;
      targetLimit = clamp(targetNamespace?.checksTimeframeInDays ?? targetLimit, 1, targetLimit);

      let targetNewGraphQLSchema = newGraphQLSchema;
      // If the graph pruning is disabled in the source namespace, the graphql schema is not computed,
      // so here we need to check if the target subgraph has graph pruning enabled and if so, we need to compute the graphql schema
      if (!targetNewGraphQLSchema && targetNamespace.enableGraphPruning && newSchemaSDL) {
        const parsedSchema = parse(newSchemaSDL);
        // this new GraphQL schema contains the location info
        targetNewGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
      }

      const targetCheckResult = await subgraphRepo.performSchemaCheck({
        organizationSlug: authContext.organizationSlug,
        namespace: targetNamespace,
        subgraphName: targetSubgraph.name,
        newSchemaSDL,
        subgraph: targetSubgraph,
        federatedGraphs: targetFederatedGraphs,
        skipTrafficCheck: req.skipTrafficCheck,
        isDeleted: !!req.delete,
        isTargetCheck: true,
        limit: targetLimit,
        chClient: opts.chClient,
        newGraphQLSchema: targetNewGraphQLSchema,
        disableResolvabilityValidation: req.disableResolvabilityValidation,
      });

      await schemaCheckRepo.addLinkedSchemaCheck({
        schemaCheckID,
        linkedSchemaCheckID: targetCheckResult.checkId,
      });

      if (targetCheckResult.response && targetCheckResult.response.code !== EnumStatusCode.OK) {
        return {
          response: {
            code: targetCheckResult.response.code,
            details: targetCheckResult.response.details,
          },
          breakingChanges,
          nonBreakingChanges,
          operationUsageStats,
          compositionErrors,
          checkId: schemaCheckID,
          checkedFederatedGraphs,
          lintWarnings,
          lintErrors,
          graphPruneWarnings,
          graphPruneErrors,
          clientTrafficCheckSkipped: req.skipTrafficCheck,
          compositionWarnings,
          proposalMatchMessage,
          isLinkedTrafficCheckFailed: false,
          isLinkedPruningCheckFailed: false,
        };
      }

      isLinkedTrafficCheckFailed = targetCheckResult.hasClientTraffic;
      isLinkedPruningCheckFailed = targetCheckResult.graphPruneErrors.length > 0;
    }

    if (req.gitInfo && opts.githubApp) {
      try {
        const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
        await githubRepo.createCommitCheck({
          namespace: namespace.name,
          schemaCheckID,
          gitInfo: req.gitInfo,
          compositionErrors,
          breakingChangesCount: breakingChanges.length,
          hasClientTraffic: hasClientTraffic || isLinkedTrafficCheckFailed,
          subgraphName,
          organizationSlug: org.slug,
          webBaseUrl: opts.webBaseUrl,
          composedGraphs: checkedFederatedGraphs.map((c) => c.name),
        });
      } catch (e) {
        logger.warn(e, 'Error creating commit check');
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      breakingChanges,
      nonBreakingChanges,
      operationUsageStats,
      compositionErrors,
      checkId: schemaCheckID,
      checkedFederatedGraphs,
      lintWarnings,
      lintErrors,
      graphPruneWarnings,
      graphPruneErrors,
      clientTrafficCheckSkipped: req.skipTrafficCheck,
      compositionWarnings,
      proposalMatchMessage,
      isLinkedTrafficCheckFailed,
      isLinkedPruningCheckFailed,
    };
  });
}
