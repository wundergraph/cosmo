import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceRequest,
  GetNamespaceResponse,
  Namespace,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { NamespaceDTO } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getNamespace(
  opts: RouterOptions,
  req: GetNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    let namespace: NamespaceDTO | undefined;

    if (req.id) {
      namespace = await namespaceRepo.byId(req.id);
    } else {
      namespace = await namespaceRepo.byName(req.name);
    }

    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.id || req.name}' not found`,
        },
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      namespace,
    };
  });
}
