import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigureNamespaceGraphPruningConfigRequest,
  ConfigureNamespaceGraphPruningConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function configureNamespaceGraphPruningConfig(
  opts: RouterOptions,
  req: ConfigureNamespaceGraphPruningConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureNamespaceGraphPruningConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureNamespaceGraphPruningConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
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

    if (!authContext.rbac.hasNamespaceWriteAccess(namespace)) {
      throw new UnauthorizedError();
    }

    await schemaGraphPruningRepo.configureNamespaceGraphPruningConfigs({
      namespaceId: namespace.id,
      graphPruningConfigs: req.configs,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
