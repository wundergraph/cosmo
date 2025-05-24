import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AddReadmeRequest, AddReadmeResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { TargetRepository } from '../../repositories/TargetRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function addReadme(
  opts: RouterOptions,
  req: AddReadmeRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<AddReadmeResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<AddReadmeResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const targetRepo = new TargetRepository(opts.db, authContext.organizationId);
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const target = await targetRepo.byName(req.targetName, req.namespace);
    if (!target) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Target ${req.targetName} not found in ${req.namespace} namespace`,
        },
      };
    }

    // check whether the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: target.id,
        targetType: target.type === 'federated' ? 'federatedGraph' : 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    await targetRepo.updateReadmeOfTarget({ id: target.id, readme: req.readme });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
