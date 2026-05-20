import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceSSOMappingRequest,
  GetNamespaceSSOMappingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { NamespaceSsoMappingRepository } from '../../repositories/NamespaceSsoMappingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getNamespaceSSOMapping(
  opts: RouterOptions,
  req: GetNamespaceSSOMappingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceSSOMappingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceSSOMappingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const namespace = await namespaceRepo.byId(req.namespaceId);
    if (!namespace) {
      return {
        response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'Namespace not found' },
      };
    }

    const mappingRepo = new NamespaceSsoMappingRepository(opts.db);
    const rows = await mappingRepo.getMapping({ namespaceId: req.namespaceId });

    return {
      response: { code: EnumStatusCode.OK },
      mapping: {
        namespaceId: req.namespaceId,
        allowedSsoProviderIds: rows.filter((r) => r.ssoProviderId).map((r) => r.ssoProviderId!),
        allowPasswordLogin: rows.some((r) => r.isPasswordLogin),
      },
    };
  });
}
