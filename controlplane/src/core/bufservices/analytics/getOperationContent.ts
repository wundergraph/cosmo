import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationContentRequest,
  GetOperationContentResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';

// Get operation content by hash
// TODO: Specify daterange to improve clickhouse performance
export function getOperationContent(
  opts: RouterOptions,
  req: GetOperationContentRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationContentResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationContentResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        operationContent: '',
      };
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        operationContent: '',
      };
    }

    const query = `
      SELECT OperationContent as operationContent
      FROM ${opts.chClient?.database}.gql_metrics_operations
      WHERE OrganizationID = {organizationId:String} 
      AND FederatedGraphID = {federatedGraphId:String}
      AND OperationHash = {operationHash:String}
      ${req.name === undefined ? '' : 'AND OperationName = {operationName:String}'}
      LIMIT 1 SETTINGS use_query_cache = true, query_cache_ttl = 2629800
    `;

    const params: Record<string, string | number | boolean> = {
      organizationId: authContext.organizationId,
      federatedGraphId: graph.id,
      operationHash: req.hash.replace(/'/g, "''"),
    };

    if (req.name !== undefined) {
      params.operationName = req.name.replace(/'/g, "''");
    }

    const result = await opts.chClient.queryPromise(query, params);

    if (!Array.isArray(result) || result.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested operation not found',
        },
        operationContent: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operationContent: result[0].operationContent,
    };
  });
}
