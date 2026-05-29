import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetTraceRequest, GetTraceResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { TraceRepository } from '../../repositories/analytics/TraceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getTrace(
  opts: RouterOptions,
  req: GetTraceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetTraceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetTraceResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        spans: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graph = await fedGraphRepo.byId(req.federatedGraphId);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph not found`,
        },
        spans: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const traceRepo = new TraceRepository(opts.chClient);

    const spans = await traceRepo.getTrace(req.id, req.spanId, authContext.organizationId, req.federatedGraphId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      spans,
    };
  });
}
