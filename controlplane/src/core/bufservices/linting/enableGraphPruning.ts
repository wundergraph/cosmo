import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  EnableGraphPruningRequest,
  EnableGraphPruningResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function enableGraphPruning(
  opts: RouterOptions,
  req: EnableGraphPruningRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<EnableGraphPruningResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<EnableGraphPruningResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
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

    const fieldPruningGracePeriod = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'field-pruning-grace-period',
    });
    if (!fieldPruningGracePeriod || !fieldPruningGracePeriod.limit) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Upgrade to a paid plan to enable graph pruning`,
        },
      };
    }

    await namespaceRepo.updateConfiguration({
      id: namespace.id,
      enableGraphPruning: req.enableGraphPruning,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
