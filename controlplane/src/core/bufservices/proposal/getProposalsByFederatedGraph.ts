import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetProposalsByFederatedGraphRequest,
  GetProposalsByFederatedGraphResponse,
  Proposal,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getProposalsByFederatedGraph(
  opts: RouterOptions,
  req: GetProposalsByFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetProposalsByFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetProposalsByFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace ${req.namespace} not found`,
        },
        proposals: [],
        isProposalsEnabled: false,
      };
    }

    if (!namespace.enableProposals) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Proposals are not enabled for namespace ${req.namespace}`,
        },
        proposals: [],
        isProposalsEnabled: false,
      };
    }

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
        proposals: [],
        isProposalsEnabled: namespace.enableProposals,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
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
        isProposalsEnabled: namespace.enableProposals,
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
        isProposalsEnabled: namespace.enableProposals,
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
        const latestCheck = await proposalRepo.getLatestCheckForProposal(
          proposal.proposal.id,
          authContext.organizationId,
        );
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
              isNew: subgraph.isNew,
              labels: subgraph.labels || [],
            })),
            latestCheckSuccess: proposal.latestCheckSuccess,
            latestCheckId: proposal.latestCheckId,
          }),
      ),
      isProposalsEnabled: true,
    };
  });
}
