import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCompositionsRequest,
  GetCompositionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getCompositions(
  opts: RouterOptions,
  req: GetCompositionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCompositionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCompositionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const graphCompositionRepository = new GraphCompositionRepository(logger, opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        compositions: [],
        count: 0,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      dateRange: {
        start: req.startDate,
        end: req.endDate,
      },
    });

    if (!dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        compositions: [],
        count: 0,
      };
    }

    // check that the limit is less than the max option provided in the ui
    if (req.limit > 50) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid limit',
        },
        compositions: [],
        count: 0,
      };
    }

    const compositions = await graphCompositionRepository.getGraphCompositions({
      fedGraphTargetId: federatedGraph.targetId,
      organizationId: authContext.organizationId,
      limit: req.limit,
      offset: req.offset,
      dateRange: {
        start: dateRange.start,
        end: dateRange.end,
      },
      excludeFeatureFlagCompositions: req.excludeFeatureFlagCompositions,
    });

    const compositionsCount = await graphCompositionRepository.getGraphCompositionsCount({
      fedGraphTargetId: federatedGraph.targetId,
      dateRange: {
        start: dateRange.start,
        end: dateRange.end,
      },
      excludeFeatureFlagCompositions: req.excludeFeatureFlagCompositions,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositions,
      count: compositionsCount,
    };
  });
}
