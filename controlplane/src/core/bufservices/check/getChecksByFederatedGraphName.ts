import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetChecksByFederatedGraphNameRequest,
  GetChecksByFederatedGraphNameResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { validate as isValidUuid } from 'uuid';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { federatedGraphs } from '../../../db/schema.js';

export function getChecksByFederatedGraphName(
  opts: RouterOptions,
  req: GetChecksByFederatedGraphNameRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetChecksByFederatedGraphNameResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetChecksByFederatedGraphNameResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedgraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    req.namespace = req.namespace || DefaultNamespace;

    const federatedGraph = await fedgraphRepo.byName(req.name, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
        checks: [],
        checksCountBasedOnDateRange: 0,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const breakingChangeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: breakingChangeRetention?.limit ?? 7,
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
        checks: [],
        checksCountBasedOnDateRange: 0,
      };
    }

    // check that the limit is less than the max option provided in the ui
    if (req.limit > 50) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid limit',
        },
        checks: [],
        checksCountBasedOnDateRange: 0,
      };
    }

    const includeSubgraphs = req.filters?.subgraphs?.filter((id) => isValidUuid(id)) ?? [];
    const checksData = await subgraphRepo.checks({
      federatedGraphTargetId: federatedGraph.targetId,
      federatedGraphId: federatedGraph.id,
      limit: req.limit,
      offset: req.offset,
      startDate: dateRange.start,
      endDate: dateRange.end,
      includeSubgraphs,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      checks: checksData.checks,
      checksCountBasedOnDateRange: checksData.checksCount,
    };
  });
}
