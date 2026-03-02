import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  CheckPersistedOperationTrafficRequest,
  CheckPersistedOperationTrafficResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import type { RouterOptions } from '../../routes.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import { getDateRange } from '../../repositories/analytics/util.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { defaultRetentionLimitInDays } from '../../constants.js';

export function checkPersistedOperationTraffic(
  opts: RouterOptions,
  req: CheckPersistedOperationTrafficRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckPersistedOperationTrafficResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckPersistedOperationTrafficResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
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
      clientName: req.clientName,
    });

    if (!operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Persisted operation ${req.operationId} does not exist`,
        },
      };
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });
    const limit = changeRetention?.limit ?? defaultRetentionLimitInDays;
    const [start, end] = getDateRange({
      start: Date.now() - limit * 24 * 60 * 60 * 1000,
      end: Date.now(),
    });

    const metricsRepository = new MetricsRepository(opts.chClient);
    const operationMetrics = await metricsRepository.getPersistedOperationMetrics({
      organizationId: authContext.organizationId,
      graphId: federatedGraph.id,
      id: operation.hash,
      start,
      end,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operation: {
        id: operation.id,
        operationId: operation.operationId,
        clientName: operation.clientName,
        operationNames: operation.operationNames,
        hasTraffic: operationMetrics.totalRequests > 0,
      },
    };
  });
}
