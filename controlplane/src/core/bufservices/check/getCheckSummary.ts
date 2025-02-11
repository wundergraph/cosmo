import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCheckSummaryRequest,
  GetCheckSummaryResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

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
      };
    }

    const check = await subgraphRepo.checkById({ id: req.checkId, federatedGraphId: graph.id });
    const checkDetails = await subgraphRepo.checkDetails({
      id: req.checkId,
      federatedTargetID: graph.targetId,
      federatedGraphID: graph.id,
    });

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
      };
    }

    const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

    const lintIssues = await schemaLintRepo.getSchemaCheckLintIsssues({ schemaCheckId: req.checkId });
    const graphPruningIssues = await schemaGraphPruningRepo.getSchemaCheckGraphPruningIsssues({
      schemaCheckId: req.checkId,
      federatedGraphId: graph.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      check,
      affectedGraphs: check.affectedGraphs,
      proposedSubgraphSchemaSDL: check.proposedSubgraphSchemaSDL,
      changes: checkDetails.changes.map((change) => ({
        ...change,
        federatedGraphId: graph.id,
        federatedGraphName: graph.name,
      })),
      compositionErrors: checkDetails.compositionErrors,
      trafficCheckDays,
      lintIssues,
      graphPruningIssues,
      compositionWarnings: checkDetails.compositionWarnings,
    };
  });
}
