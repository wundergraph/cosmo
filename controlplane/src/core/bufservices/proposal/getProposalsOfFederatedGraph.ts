import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetProposalsOfFederatedGraphRequest,
  GetProposalsOfFederatedGraphResponse,
  Proposal,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';

export function getProposalsOfFederatedGraph(
  opts: RouterOptions,
  req: GetProposalsOfFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetProposalsOfFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetProposalsOfFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
        proposals: [],
      };
    }

    const breakingChangeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: breakingChangeRetention?.limit ?? 7,
      dateRange: {
        start: req.startDate,
        end: req.endDate,
      },
    });

    if (!dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        proposals: [],
      };
    }

    // check that the limit is less than the max option provided in the ui
    if (req.limit > 50) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid limit',
        },
        proposals: [],
      };
    }

    const { proposals } = await proposalRepo.ByFederatedGraphId({
      federatedGraphId: federatedGraph.id,
      startDate: dateRange.start,
      endDate: dateRange.end,
      limit: req.limit,
      offset: req.offset,
    });

    // Get the latest check success for each proposal
    const proposalsWithChecks = await Promise.all(
      proposals.map(async (proposal) => {
        const latestCheck = await proposalRepo.getLatestCheckForProposal(proposal.proposal.id);
        return {
          ...proposal,
          latestCheckSuccess: latestCheck?.isSuccessful || false,
          latestCheckId: latestCheck?.checkId || '',
        };
      }),
    );

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      proposals: proposalsWithChecks.map(
        (proposal) =>
          new Proposal({
            id: proposal.proposal.id,
            name: proposal.proposal.name,
            createdAt: proposal.proposal.createdAt,
            createdByEmail: proposal.proposal.createdByEmail || '',
            state: proposal.proposal.state,
            federatedGraphId: proposal.proposal.federatedGraphId,
            federatedGraphName: req.federatedGraphName,
            subgraphs: proposal.proposalSubgraphs.map((subgraph) => ({
              name: subgraph.subgraphName,
              schemaSDL: subgraph.schemaSDL,
              isDeleted: subgraph.isDeleted,
            })),
            latestCheckSuccess: proposal.latestCheckSuccess,
            latestCheckId: proposal.latestCheckId,
          }),
      ),
    };
  });
}
