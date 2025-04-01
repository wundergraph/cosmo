import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetChecksOfProposalRequest,
  GetChecksOfProposalResponse,
  SchemaCheck,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getChecksOfProposal(
  opts: RouterOptions,
  req: GetChecksOfProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetChecksOfProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetChecksOfProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db);

    // Default pagination values
    const limit = req.pagination?.limit || 10;
    const offset = req.pagination?.offset || 0;

    // Get date range if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (req.dateRange?.start) {
      startDate = new Date(req.dateRange.start);
    }

    if (req.dateRange?.end) {
      endDate = new Date(req.dateRange.end);
    }

    // Check if the proposal exists
    const proposal = await proposalRepo.ById(req.proposalId);
    if (!proposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Proposal with ID ${req.proposalId} not found`,
        },
        checks: [],
        checksCountBasedOnDateRange: 0,
        totalChecksCount: 0,
      };
    }

    // Get checks for the proposal
    const { checks, totalCount, countBasedOnDateRange } = await proposalRepo.getChecksByProposalId(
      req.proposalId,
      limit,
      offset,
      startDate,
      endDate,
    );

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      checks: checks.map(
        (check) =>
          new SchemaCheck({
            id: check.id,
            targetID: check.targetID,
            subgraphName: check.subgraphName || '',
            timestamp: check.timestamp,
            isComposable: check.isComposable,
            isBreaking: check.isBreaking,
            hasClientTraffic: check.hasClientTraffic,
            isForcedSuccess: check.isForcedSuccess,
            hasLintErrors: check.hasLintErrors,
            hasGraphPruningErrors: check.hasGraphPruningErrors,
            clientTrafficCheckSkipped: check.clientTrafficCheckSkipped,
            lintSkipped: check.lintSkipped,
            graphPruningSkipped: check.graphPruningSkipped,
            checkedSubgraphs: check.checkedSubgraphs.map((subgraph: any) => ({
              id: subgraph.id,
              subgraphName: subgraph.subgraphName || '',
              subgraphId: subgraph.subgraphId,
              isDeleted: subgraph.isDeleted,
              isNew: subgraph.isNew,
            })),
          }),
      ),
      checksCountBasedOnDateRange: countBasedOnDateRange,
      totalChecksCount: totalCount,
    };
  });
}
