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

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
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

    await namespaceRepo.updateConfiguration({ id: namespace.id, enableProposals: req.enableProposals });
    if (req.enableProposals) {
      await proposalRepo.configureProposalConfig({
        namespaceId: namespace.id,
        checkSeverityLevel: 'warn',
        publishSeverityLevel: 'warn',
      });
    } else {
      await proposalRepo.deleteProposalConfig({ namespaceId: namespace.id });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
