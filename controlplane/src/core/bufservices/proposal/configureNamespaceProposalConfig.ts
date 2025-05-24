import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigureNamespaceProposalConfigRequest,
  ConfigureNamespaceProposalConfigResponse,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function configureNamespaceProposalConfig(
  opts: RouterOptions,
  req: ConfigureNamespaceProposalConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureNamespaceProposalConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureNamespaceProposalConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const proposalRepo = new ProposalRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        configs: [],
      };
    }

    if (!authContext.rbac.hasNamespaceWriteAccess(namespace)) {
      throw new UnauthorizedError();
    }

    await proposalRepo.configureProposalConfig({
      namespaceId: namespace.id,
      checkSeverityLevel: req.checkSeverityLevel === LintSeverity.error ? 'error' : 'warn',
      publishSeverityLevel: req.publishSeverityLevel === LintSeverity.error ? 'error' : 'warn',
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'namespace_proposal_config.updated',
      action: 'updated',
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
