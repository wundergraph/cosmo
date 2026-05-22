import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ListNamespaceSSOMappingsRequest,
  ListNamespaceSSOMappingsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceSsoMappingRepository } from '../../repositories/NamespaceSsoMappingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function listNamespaceSSOMappings(
  opts: RouterOptions,
  _req: ListNamespaceSSOMappingsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ListNamespaceSSOMappingsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ListNamespaceSSOMappingsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const mappingRepo = new NamespaceSsoMappingRepository(opts.db);
    // Pass rbac so the repo limits results to namespaces the caller's login
    // method can access (matches the namespace dropdown and the update self-check).
    const mappings = await mappingRepo.listMappings({
      organizationId: authContext.organizationId,
      rbac: authContext.rbac,
    });

    return {
      response: { code: EnumStatusCode.OK },
      mappings: mappings.map((m) => ({
        namespaceId: m.namespaceId,
        allowedSsoProviderIds: m.allowedSsoProviderIds,
        allowPasswordLogin: m.allowPasswordLogin,
      })),
    };
  });
}
