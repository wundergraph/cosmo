import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  EnableProposalsForNamespaceRequest,
  EnableProposalsForNamespaceResponse,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function enableProposalsForNamespace(
  opts: RouterOptions,
  req: EnableProposalsForNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<EnableProposalsForNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<EnableProposalsForNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const proposalsFeature = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'proposals',
    });
    if (!proposalsFeature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: `Upgrade to a scale plan to enable proposals.`,
        },
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
      };
    }

    if (!authContext.rbac.hasNamespaceWriteAccess(namespace)) {
      throw new UnauthorizedError();
    }

    await namespaceRepo.updateConfiguration({ id: namespace.id, enableProposals: req.enableProposals });
    if (req.enableProposals) {
      await proposalRepo.configureProposalConfig({
        namespaceId: namespace.id,
        checkSeverityLevel: 'error',
        publishSeverityLevel: 'error',
      });
    } else {
      await proposalRepo.deleteProposalConfig({ namespaceId: namespace.id });
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: req.enableProposals ? 'proposal.enabled' : 'proposal.disabled',
      action: req.enableProposals ? 'enabled' : 'disabled',
      actorId: authContext.userId,
      auditableType: 'namespace',
      auditableDisplayName: namespace.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: namespace.id,
      targetNamespaceDisplayName: namespace.name,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
