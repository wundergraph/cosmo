import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetClientsRequest, GetClientsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import { getDateRange } from '../../repositories/analytics/util.js';
import type { RouterOptions } from '../../routes.js';
import { defaultRetentionLimitInDays } from '../../constants.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getClients(
  opts: RouterOptions,
  req: GetClientsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetClientsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetClientsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        clients: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);

    if (req.includeTraffic && opts.chClient) {
      const clients = await operationsRepo.getRegisteredClientsWithMetadata();
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

      const metricsRepo = new MetricsRepository(opts.chClient);
      const clientNamesWithTraffic = await metricsRepo.getClientsWithPersistedOperationTraffic({
        organizationId: authContext.organizationId,
        graphId: federatedGraph.id,
        start,
        end,
      });

      const clientsWithTraffic = [];
      for (const client of clients) {
        clientsWithTraffic.push({
          ...client,
          hasTraffic: clientNamesWithTraffic.has(client.name),
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        clients: clientsWithTraffic,
      };
    }

    const clients = await operationsRepo.getRegisteredClients();

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
    };
  });
}
