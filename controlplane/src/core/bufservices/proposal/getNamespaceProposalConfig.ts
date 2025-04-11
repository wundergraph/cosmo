import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceProposalConfigRequest,
  GetNamespaceProposalConfigResponse,
  LintSeverity,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';

export function getNamespaceProposalConfig(
  opts: RouterOptions,
  req: GetNamespaceProposalConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceProposalConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceProposalConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const proposalRepo = new ProposalRepository(opts.db);

    const proposalsFeature = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'proposals',
    });
    if (!proposalsFeature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: `Upgrade to a enterprise plan to enable proposals.`,
        },
        enabled: false,
        checkSeverityLevel: LintSeverity.error,
        publishSeverityLevel: LintSeverity.error,
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        enabled: false,
        checkSeverityLevel: LintSeverity.error,
        publishSeverityLevel: LintSeverity.error,
      };
    }

    if (!namespace.enableProposals) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        enabled: false,
        checkSeverityLevel: LintSeverity.error,
        publishSeverityLevel: LintSeverity.error,
      };
    }

    const proposalConfig = await proposalRepo.getProposalConfig({ namespaceId: namespace.id });
    if (!proposalConfig) {
      return {
        response: {
          code: EnumStatusCode.ERR,
        },
        enabled: true,
        checkSeverityLevel: LintSeverity.error,
        publishSeverityLevel: LintSeverity.error,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      enabled: namespace.enableProposals,
      checkSeverityLevel: proposalConfig.checkSeverityLevel === 'error' ? LintSeverity.error : LintSeverity.warn,
      publishSeverityLevel: proposalConfig.publishSeverityLevel === 'error' ? LintSeverity.error : LintSeverity.warn,
    };
  });
}
