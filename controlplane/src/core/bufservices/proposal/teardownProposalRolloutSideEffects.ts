import type { AuthContext, FederatedGraphDTO } from '../../../types/index.js';
import type { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import type { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import type { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';

// Shared teardown body for the TeardownProposalRollout RPC and the auto-teardown
// hook in updateProposal (PUBLISHED transition). Idempotent: if no rollout flag
// is linked, returns silently. Audit log + composeAndDeployGraphs run together
// so the two call sites can't drift on what gets recorded or recomposed.
export async function teardownProposalRolloutSideEffects({
  opts,
  authContext,
  proposalId,
  federatedGraph,
  proposalRepo,
  fedGraphRepo,
  featureFlagRepo,
  auditLogRepo,
}: {
  opts: RouterOptions;
  authContext: AuthContext;
  proposalId: string;
  federatedGraph: FederatedGraphDTO;
  proposalRepo: ProposalRepository;
  fedGraphRepo: FederatedGraphRepository;
  featureFlagRepo: FeatureFlagRepository;
  auditLogRepo: AuditLogRepository;
}): Promise<void> {
  const linked = await proposalRepo.getLinkedRolloutFlag(proposalId);
  if (!linked) {
    return;
  }

  await featureFlagRepo.delete(linked.id);

  await auditLogRepo.addAuditLog({
    organizationId: authContext.organizationId,
    organizationSlug: authContext.organizationSlug,
    auditAction: 'feature_flag.deleted',
    action: 'deleted',
    actorId: authContext.userId,
    auditableType: 'feature_flag',
    auditableDisplayName: linked.name,
    apiKeyName: authContext.apiKeyName,
    actorDisplayName: authContext.userDisplayName,
    actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    targetNamespaceId: federatedGraph.namespaceId,
    targetNamespaceDisplayName: federatedGraph.namespace,
  });

  await fedGraphRepo.composeAndDeployGraphs({
    actorId: authContext.userId,
    admissionConfig: {
      cdnBaseUrl: opts.cdnBaseUrl,
      webhookJWTSecret: opts.admissionWebhookJWTSecret,
    },
    blobStorage: opts.blobStorage,
    chClient: opts.chClient!,
    compositionOptions: {},
    federatedGraphs: [federatedGraph],
    webhookProxyUrl: opts.webhookProxyUrl,
  });
}
