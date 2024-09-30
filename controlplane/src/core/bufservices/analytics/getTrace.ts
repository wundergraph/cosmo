import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetTraceRequest, GetTraceResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { TraceRepository } from '../../repositories/analytics/TraceRepository.js';
import type { RouterOptions } from '../../routes.js';
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
