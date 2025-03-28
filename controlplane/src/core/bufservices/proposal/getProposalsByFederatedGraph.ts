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
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

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
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);

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

    const proposals = await proposalRepo.ByFederatedGraphId(federatedGraph.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      proposals: proposals.proposals.map(
        (proposal) =>
          new Proposal({
            id: proposal.proposal.id,
            name: proposal.proposal.name,
            createdAt: proposal.proposal.createdAt,
            createdByEmail: proposal.proposal.createdByEmail || '',
            state: proposal.proposal.state,
            subgraphs: proposal.proposalSubgraphs.map((subgraph) => ({
              name: subgraph.subgraphName,
              schemaSDL: subgraph.schemaSDL,
              isDeleted: subgraph.isDeleted,
            })),
          }),
      ),
    };
  });
}
