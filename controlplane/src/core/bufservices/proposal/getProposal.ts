import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
    GetProposalRequest,
    GetProposalResponse,
    Proposal
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getProposal(
  opts: RouterOptions,
  req: GetProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db);

    const proposal = await proposalRepo.ById(req.proposalId);
    if (!proposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Proposal ${req.proposalId} not found`,
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      proposal: new Proposal({
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
    };
  });
}
