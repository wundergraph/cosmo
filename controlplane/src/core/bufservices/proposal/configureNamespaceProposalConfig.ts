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
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function configureNamespaceProposalConfig(
  opts: RouterOptions,
  req: ConfigureNamespaceProposalConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureNamespaceProposalConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureNamespaceProposalConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
    }

    const proposalRepo = new ProposalRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

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

    await proposalRepo.configureProposalConfig({
      namespaceId: namespace.id,
      checkSeverityLevel: req.checkSeverityLevel === LintSeverity.error ? 'error' : 'warn',
      publishSeverityLevel: req.publishSeverityLevel === LintSeverity.error ? 'error' : 'warn',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
