/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCheckSummaryRequest,
  GetCheckSummaryResponse,
  GetCheckSummaryResponse_AffectedGraph,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isCheckSuccessful } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getCheckSummary(
  opts: RouterOptions,
  req: GetCheckSummaryRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCheckSummaryResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCheckSummaryResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const schemaCheckRepo = new SchemaCheckRepository(opts.db);
    const schemaLintRepo = new SchemaLintRepository(opts.db);
    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        compositionErrors: [],
        compositionWarnings: [],
        changes: [],
        affectedGraphs: [],
        trafficCheckDays: 0,
        lintIssues: [],
        graphPruningIssues: [],
        isGraphPruningEnabled: false,
        isLintingEnabled: false,
        checkedSubgraphs: [],
        proposalMatches: [],
        isProposalsEnabled: false,
      };
    }

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
        compositionErrors: [],
        compositionWarnings: [],
        changes: [],
        affectedGraphs: [],
        trafficCheckDays: 0,
        lintIssues: [],
        graphPruningIssues: [],
        isGraphPruningEnabled: false,
        isLintingEnabled: false,
        checkedSubgraphs: [],
        proposalMatches: [],
        isProposalsEnabled: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const check = await subgraphRepo.checkById({
      id: req.checkId,
      federatedGraphTargetId: graph.targetId,
      federatedGraphId: graph.id,
    });
    const checkDetails = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

    if (!check || !checkDetails) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested check not found',
        },
        compositionErrors: [],
        compositionWarnings: [],
        changes: [],
        affectedGraphs: [],
        trafficCheckDays: 0,
        lintIssues: [],
        graphPruningIssues: [],
        isGraphPruningEnabled: false,
        isLintingEnabled: false,
        checkedSubgraphs: [],
        proposalMatches: [],
        isProposalsEnabled: false,
      };
    }

    const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

    const lintIssues = await schemaLintRepo.getSchemaCheckLintIsssues({ schemaCheckId: req.checkId });
    const graphPruningIssues = await schemaGraphPruningRepo.getSchemaCheckGraphPruningIsssues({
      schemaCheckId: req.checkId,
      federatedGraphId: graph.id,
    });

    const currentAffectedGraph = check.affectedGraphs.find((ag) => ag.id === graph.id);
    if (!currentAffectedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Check not found for the current graph',
        },
        compositionErrors: [],
        compositionWarnings: [],
        changes: [],
        affectedGraphs: [],
        trafficCheckDays: 0,
        lintIssues: [],
        graphPruningIssues: [],
        isGraphPruningEnabled: false,
        isLintingEnabled: false,
        checkedSubgraphs: [],
        proposalMatches: [],
        isProposalsEnabled: false,
      };
    }

    const affectedGraphs: GetCheckSummaryResponse_AffectedGraph[] = [];

    const hasLintErrors = lintIssues.some((issue) => issue.severity === LintSeverity.error);
    let hasAffectedOperations = false;
    if (check.hasClientTraffic) {
      const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId({
        checkId: req.checkId,
        limit: 1,
        offset: 0,
      });
      hasAffectedOperations = affectedOperations.length > 0;
    }

    const isLinkedTrafficCheckFailed = check.linkedChecks.some(
      (linkedCheck) => linkedCheck.hasClientTraffic && !linkedCheck.isForcedSuccess,
    );
    const isLinkedPruningCheckFailed = check.linkedChecks.some(
      (linkedCheck) => linkedCheck.hasGraphPruningErrors && !linkedCheck.isForcedSuccess,
    );

    affectedGraphs.push(
      new GetCheckSummaryResponse_AffectedGraph({
        ...currentAffectedGraph,
        name: graph.name,
        isCheckSuccessful: isCheckSuccessful({
          isComposable: checkDetails.compositionErrors.length === 0,
          isBreaking: checkDetails.changes.some((change) => change.isBreaking),
          hasClientTraffic: hasAffectedOperations,
          hasLintErrors,
          hasGraphPruningErrors: graphPruningIssues.some((issue) => issue.severity === LintSeverity.error),
          clientTrafficCheckSkipped: check.clientTrafficCheckSkipped,
          hasProposalMatchError: check.proposalMatch === 'error',
          isLinkedTrafficCheckFailed,
          isLinkedPruningCheckFailed,
        }),
        isComposable: checkDetails.compositionErrors.length === 0,
        isBreaking: checkDetails.changes.some((change) => change.isBreaking),
        hasClientTraffic: hasAffectedOperations,
        hasLintErrors,
        hasGraphPruningErrors: graphPruningIssues.some((issue) => issue.severity === LintSeverity.error),
      }),
    );

    // checking if the checks for the other affected graphs are successful
    for (const ag of check.affectedGraphs) {
      if (ag.id === graph.id) {
        continue;
      }
      const fedGraph = await fedGraphRepo.byId(ag.id);
      if (!fedGraph) {
        continue;
      }
      const checkDetails = await subgraphRepo.checkDetails(req.checkId, fedGraph.targetId);
      if (!checkDetails) {
        continue;
      }
      const graphPruningIssues = await schemaGraphPruningRepo.getSchemaCheckGraphPruningIsssues({
        schemaCheckId: req.checkId,
        federatedGraphId: fedGraph.id,
      });

      if (check.hasClientTraffic) {
        const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId({
          checkId: req.checkId,
          limit: 1,
          offset: 0,
        });
        hasAffectedOperations = affectedOperations.length > 0;
      }
      affectedGraphs.push(
        new GetCheckSummaryResponse_AffectedGraph({
          ...ag,
          name: fedGraph.name,
          isCheckSuccessful: isCheckSuccessful({
            isComposable: checkDetails.compositionErrors.length === 0,
            isBreaking: checkDetails.changes.some((change) => change.isBreaking),
            hasClientTraffic: hasAffectedOperations,
            hasLintErrors,
            hasGraphPruningErrors: graphPruningIssues.some((issue) => issue.severity === LintSeverity.error),
            clientTrafficCheckSkipped: check.clientTrafficCheckSkipped,
            hasProposalMatchError: check.proposalMatch === 'error',
            isLinkedTrafficCheckFailed,
            isLinkedPruningCheckFailed,
          }),
          isComposable: checkDetails.compositionErrors.length === 0,
          isBreaking: checkDetails.changes.some((change) => change.isBreaking),
          hasClientTraffic: hasAffectedOperations,
          hasLintErrors,
          hasGraphPruningErrors: graphPruningIssues.some((issue) => issue.severity === LintSeverity.error),
        }),
      );
    }

    const proposal = await proposalRepo.getProposalByCheckId({ checkId: req.checkId });
    const proposalSchemaMatches = await proposalRepo.getProposalSchemaMatchesOfCheck({
      checkId: req.checkId,
      federatedGraphId: graph.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      check,
      affectedGraphs,
      proposedSubgraphSchemaSDL: check.proposedSubgraphSchemaSDL,
      changes: checkDetails.changes,
      compositionErrors: checkDetails.compositionErrors,
      trafficCheckDays,
      lintIssues,
      graphPruningIssues,
      compositionWarnings: checkDetails.compositionWarnings,
      proposalId: proposal?.proposalId,
      proposalName: proposal?.proposalName,
      proposalMatches: proposalSchemaMatches,
      isProposalsEnabled: namespace.enableProposals,
    };
  });
}
