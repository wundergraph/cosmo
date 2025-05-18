import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetRoutersRequest, GetRoutersResponse, Router } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { validate as validateUUID } from 'uuid';
import { GraphCompositionDTO } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { RouterMetricsRepository } from '../../repositories/analytics/RouterMetricsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getRouters(
  opts: RouterOptions,
  req: GetRoutersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetRoutersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetRoutersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        routers: [],
      };
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        routers: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const routers: PlainMessage<Router>[] = [];

    const routerRepo = new RouterMetricsRepository(opts.chClient);
    const routersDTOs = await routerRepo.getActiveRouters({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
    });

    const graphCompositionRepository = new GraphCompositionRepository(logger, opts.db);

    for await (const routerDTO of routersDTOs) {
      let composition: GraphCompositionDTO | undefined;

      // Might be empty when starting with a local composed config that has no config version id
      if (routerDTO.configVersionId && validateUUID(routerDTO.configVersionId)) {
        composition = await graphCompositionRepository.getGraphCompositionBySchemaVersion({
          organizationId: authContext.organizationId,
          schemaVersionId: routerDTO.configVersionId,
        });
      }

      const runtimeMetrics = await routerRepo.getRouterRuntime({
        organizationId: authContext.organizationId,
        federatedGraphId: federatedGraph.id,
        serviceInstanceId: routerDTO.serviceInstanceId,
      });

      routers.push({
        hostname: routerDTO.hostname,
        clusterName: routerDTO.clusterName,
        compositionId: composition?.id ?? '',
        serviceName: routerDTO.serviceName,
        serviceVersion: routerDTO.serviceVersion,
        serviceInstanceId: routerDTO.serviceInstanceId,
        uptimeSeconds: routerDTO.processUptimeSeconds,
        serverUptimeSeconds: runtimeMetrics.serverUptimeSeconds,
        onLatestComposition: composition?.isLatestValid ?? false,
        processId: routerDTO.processId,
        cpuUsagePercent: runtimeMetrics.cpuUsage.currentPercent ?? 0,
        cpuUsageChangePercent: runtimeMetrics.cpuUsage.changePercent,
        memoryUsageMb: runtimeMetrics.memoryUsage.currentMb ?? 0,
        memoryUsageChangePercent: runtimeMetrics.memoryUsage.changePercent ?? 0,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      routers,
    };
  });
}
