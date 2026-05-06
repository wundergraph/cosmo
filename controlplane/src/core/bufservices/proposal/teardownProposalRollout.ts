import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  TeardownProposalRolloutRequest,
  TeardownProposalRolloutResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { teardownProposalRolloutSideEffects } from './teardownProposalRolloutSideEffects.js';

// TeardownProposalRollout deletes the feature flag created from a caching
// proposal. The on-delete-cascade on featureFlagToFeatureSubgraphs and the
// subgraph cleanup invoked here remove the per-proposal feature subgraphs
// too. Recomposes so the rollout entry vanishes from the next router config.
//
// This is also the code path called from the auto-teardown hook in
// updateProposal when a CACHING proposal transitions to PUBLISHED — both go
// through the shared `teardownProposalRolloutSideEffects` helper so the audit
// trail and the recompose stay in lockstep.
export function teardownProposalRollout(
  opts: RouterOptions,
  req: TeardownProposalRolloutRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<TeardownProposalRolloutResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<TeardownProposalRolloutResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const proposal = await proposalRepo.ById(req.proposalId);
    if (!proposal) {
      return {
        response: { code: EnumStatusCode.ERR_NOT_FOUND, details: `Proposal ${req.proposalId} not found` },
      };
    }

    const federatedGraph = await fedGraphRepo.byId(proposal.proposal.federatedGraphId);
    if (!federatedGraph) {
      // Idempotent: nothing to recompose if the federated graph vanished.
      return { response: { code: EnumStatusCode.OK } };
    }

    await teardownProposalRolloutSideEffects({
      opts,
      authContext,
      proposalId: req.proposalId,
      federatedGraph,
      proposalRepo,
      fedGraphRepo,
      featureFlagRepo,
      auditLogRepo,
    });

    return { response: { code: EnumStatusCode.OK } };
  });
}
