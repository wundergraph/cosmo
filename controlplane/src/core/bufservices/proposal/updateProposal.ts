import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { UpdateProposalRequest, UpdateProposalResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { ProposalState } from '../../../db/models.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function updateProposal(
  opts: RouterOptions,
  req: UpdateProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db);
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    const proposal = await proposalRepo.ById(req.proposalId);
    if (!proposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Proposal ${req.proposalId} not found`,
        },
      };
    }

    const federatedGraph = await federatedGraphRepo.byId(proposal.proposal.federatedGraphId);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph of the proposal not found`,
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

    for (const proposalSubgraph of req.updatedSubgraphs) {
      const subgraph = await subgraphRepo.byName(proposalSubgraph.name, req.namespace);
      proposalSubgraphs.push({
        subgraphId: subgraph?.id,
        subgraphName: proposalSubgraph.name,
        schemaSDL: proposalSubgraph.schemaSDL,
        isDeleted: proposalSubgraph.isDeleted,
      });
    }

    await proposalRepo.updateProposal({
      id: req.proposalId,
      state: req.state as ProposalState,
      proposalSubgraphs,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'proposal.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'proposal',
      auditableDisplayName: proposal.proposal.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    orgWebhooks.send(
      {
        eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
        payload: {
          federated_graph: {
            id: federatedGraph.id,
            name: federatedGraph.name,
            namespace: federatedGraph.namespace,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          proposal: {
            id: proposal.proposal.id,
            name: proposal.proposal.name,
            namespace: req.namespace,
            state: req.state,
          },
          actor_id: authContext.userId,
        },
      },
      authContext.userId,
    );

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
