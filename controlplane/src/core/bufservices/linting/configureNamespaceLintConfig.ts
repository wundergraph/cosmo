import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigureNamespaceLintConfigRequest,
  ConfigureNamespaceLintConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SchemaLintRepository } from '../../repositories/SchemaLintRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function configureNamespaceLintConfig(
  opts: RouterOptions,
  req: ConfigureNamespaceLintConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureNamespaceLintConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureNamespaceLintConfigResponse>>(ctx, logger, async () => {
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

    const schemaLintRepo = new SchemaLintRepository(opts.db);
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

    await schemaLintRepo.configureNamespaceLintConfig({
      namespaceId: namespace.id,
      lintConfigs: req.configs,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
