import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCheckOperationsRequest,
  GetCheckOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getCheckOperations(
  opts: RouterOptions,
  req: GetCheckOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCheckOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCheckOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const schemaCheckRepo = new SchemaCheckRepository(opts.db);

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
        operations: [],
        trafficCheckDays: 0,
        createdAt: '',
        clientTrafficCheckSkipped: false,
        totalOperationsCount: 0,
        doAllOperationsHaveIgnoreAllOverride: false,
        doAllOperationsHaveAllTheirChangesMarkedSafe: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const check = await subgraphRepo.checkById({
      id: req.checkId,
      federatedGraphTargetId: graph.targetId,
      federatedGraphId: graph.id,
    });
    const checkDetails = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

    if (!check || !checkDetails) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested check not found',
        },
        operations: [],
        trafficCheckDays: 0,
        createdAt: '',
        clientTrafficCheckSkipped: false,
        totalOperationsCount: 0,
        doAllOperationsHaveIgnoreAllOverride: false,
        doAllOperationsHaveAllTheirChangesMarkedSafe: false,
      };
    }

    // check that the limit is less than the max option provided in the ui
    if (req.limit > 200) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid limit',
        },
        operations: [],
        trafficCheckDays: 0,
        createdAt: '',
        clientTrafficCheckSkipped: false,
        totalOperationsCount: 0,
        doAllOperationsHaveIgnoreAllOverride: false,
        doAllOperationsHaveAllTheirChangesMarkedSafe: false,
      };
    }

    const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId({
      checkId: req.checkId,
      limit: req.limit,
      offset: req.offset,
      search: req.search,
    });

    const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

    const operationsRepo = new OperationsRepository(opts.db, graph.id);

    const overrides = await operationsRepo.getChangeOverrides({
      namespaceId: graph.namespaceId,
    });

    const ignoreAllOverrides = await operationsRepo.getIgnoreAllOverrides({
      namespaceId: graph.namespaceId,
    });

    const affectedOperationsCount = await schemaCheckRepo.getAffectedOperationsCountByCheckId({
      checkId: req.checkId,
      search: req.search,
    });

    const { doAllOperationsHaveIgnoreAllOverride, doAllOperationsHaveAllTheirChangesMarkedSafe } =
      await operationsRepo.getOperationOverrideStatusOfCheck({
        checkId: req.checkId,
        checkDetails,
        overrides,
        ignoreAllOverrides,
      });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: affectedOperations.map((operation) => ({
        ...operation,
        impactingChanges: checkDetails.changes
          .filter(({ id }) => operation.schemaChangeIds.includes(id))
          .map((c) => ({
            ...c,
            hasOverride: overrides.some(
              (o) => o.hash === operation.hash && o.changeType === c.changeType && o.path === c.path,
            ),
          })),
        hasIgnoreAllOverride: ignoreAllOverrides.some((io) => io.hash === operation.hash),
      })),
      trafficCheckDays,
      createdAt: check.timestamp,
      clientTrafficCheckSkipped: check.clientTrafficCheckSkipped || false,
      totalOperationsCount: affectedOperationsCount,
      doAllOperationsHaveIgnoreAllOverride,
      doAllOperationsHaveAllTheirChangesMarkedSafe,
    };
  });
}
