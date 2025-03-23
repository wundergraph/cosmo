import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateProposalRequest, CreateProposalResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createProposal(
  opts: RouterOptions,
  req: CreateProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
        proposalId: '',
      };
    }

    const proposalSubgraphs: {
      subgraphId?: string;
      subgraphName: string;
      schemaSDL: string;
      isDeleted: boolean;
    }[] = [];

    for (const proposalSubgraph of req.subgraphs) {
      const subgraph = await subgraphRepo.byName(proposalSubgraph.name, req.namespace);
      proposalSubgraphs.push({
        subgraphId: subgraph?.id,
        subgraphName: proposalSubgraph.name,
        schemaSDL: proposalSubgraph.schemaSDL,
        isDeleted: proposalSubgraph.isDeleted,
      });
    }

    const proposal = await proposalRepo.createProposal({
      federatedGraphId: federatedGraph.id,
      name: req.name,
      userId: authContext.userId,
      proposalSubgraphs,
      didHubCreate: req.didHubCreate,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'proposal.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'proposal',
      auditableDisplayName: proposal.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      proposalId: proposal.id,
    };
  });
}
