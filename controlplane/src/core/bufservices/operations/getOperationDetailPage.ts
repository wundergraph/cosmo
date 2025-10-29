/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OperationType } from '@wundergraph/cosmo-connect/dist/graphqlmetrics/v1/graphqlmetrics_pb';
import {
  GetOperationDetailPageRequest,
  GetOperationDetailPageResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOperationDetailPage(
  opts: RouterOptions,
  req: GetOperationDetailPageRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationDetailPageResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationDetailPageResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        operations: [],
      };
    }

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      detail: {
        id: 'xxx',
        operationName: 'operation_xxx',
        timestamp: '',
        operationType: OperationType.QUERY,
        operationContent: 'query xxx { __introspection }',
      },
    };
  });
}
