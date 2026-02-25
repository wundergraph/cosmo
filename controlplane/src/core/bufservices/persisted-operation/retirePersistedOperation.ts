import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  RetirePersistedOperationRequest,
  RetirePersistedOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function retirePersistedOperation(
  opts: RouterOptions,
  req: RetirePersistedOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RetirePersistedOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RetirePersistedOperationResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        filters: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
      };
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const operation = await operationsRepo.getPersistedOperation({
      operationId: req.operationId,
    });

    if (!operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Persisted operation ${req.operationId} does not exist`,
        },
      };
    }

    const metricsRepository = new MetricsRepository(opts.chClient);
    const operationMetrics = req.force
      ? null
      : await metricsRepository.getPersistedOperationMetrics({
          organizationId: authContext.organizationId,
          graphId: federatedGraph.id,
          id: operation.hash,
        });

    if (operationMetrics && operationMetrics.totalRequests > 0) {
      return {
        response: {
          code: EnumStatusCode.WARN_DESTRUCTIVE_OPERATION,
          details: `Persisted operation ${req.operationId} still receives traffic`,
        },
      };
    }

    const retiredOperation = await operationsRepo.retirePersistedOperation({
      operationId: req.operationId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operation: retiredOperation
        ? {
            id: retiredOperation.id,
            operationId: retiredOperation.operationId,
          }
        : undefined,
    };
  });
}
