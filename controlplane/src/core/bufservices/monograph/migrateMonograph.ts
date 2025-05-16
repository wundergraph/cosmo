import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  MigrateMonographRequest,
  MigrateMonographResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function migrateMonograph(
  opts: RouterOptions,
  req: MigrateMonographRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<MigrateMonographResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<MigrateMonographResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const graph = await fedGraphRepo.byName(req.name, req.namespace, {
      supportsFederation: false,
    });
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Monograph '${req.name}' not found`,
        },
        compositionErrors: [],
      };
    }

    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: graph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: graph.targetId,
    });

    if (subgraphs.length > 0) {
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: subgraphs[0].targetId,
          targetType: 'subgraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });
    }

    await fedGraphRepo.enableFederationSupport({
      targetId: graph.targetId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
    };
  });
}
