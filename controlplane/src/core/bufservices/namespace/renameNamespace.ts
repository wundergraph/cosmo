import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RenameNamespaceRequest,
  RenameNamespaceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidNamespaceName } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function renameNamespace(
  opts: RouterOptions,
  req: RenameNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RenameNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RenameNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const isValid = isValidNamespaceName(req.name);
    if (!isValid) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'The provided name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
        },
      };
    }

    if (req.name === DefaultNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'You cannot rename the default namespace',
        },
      };
    }

    const exists = await namespaceRepo.byName(req.name);
    if (!exists) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'The namespace was not found',
        },
      };
    }

    if (!authContext.rbac.hasNamespaceWriteAccess(exists)) {
      throw new UnauthorizedError();
    }

    await namespaceRepo.rename({
      ...req,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
