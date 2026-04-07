import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetFieldUsageRequest, GetFieldUsageResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DateRange } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { UsageRepository } from '../../repositories/analytics/UsageRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getFieldUsage(
  opts: RouterOptions,
  req: GetFieldUsageRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFieldUsageResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFieldUsageResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        clients: [],
        requestSeries: [],
      };
    }

    const usageRepo = new UsageRepository(opts.chClient);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        clients: [],
        requestSeries: [],
      };
    }

    const graph = await federatedGraphRepo.byName(req.graphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
        clients: [],
        requestSeries: [],
      };
    }

    let dr: DateRange | undefined;

    if (req.dateRange?.start && req.dateRange?.end) {
      dr = {
        start: req.dateRange?.start,
        end: req.dateRange?.end,
      };
    }

    const { clients, requestSeries, meta } = await usageRepo.getFieldUsage({
      federatedGraphId: graph.id,
      organizationId: authContext.organizationId,
      typename: req.typename,
      field: req.field,
      namedType: req.namedType,
      range: req.range,
      dateRange: dr,
      isArgument: req.isArgument ?? false, // default to false if not provided
      isInput: req.isInput ?? false, // default to false if not provided
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
      requestSeries,
      meta,
    };
  });
}
