import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFederatedGraphChangelogRequest,
  GetFederatedGraphChangelogResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFederatedGraphChangelog(
  opts: RouterOptions,
  req: GetFederatedGraphChangelogRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFederatedGraphChangelogResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFederatedGraphChangelogResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedgraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    req.namespace = req.namespace || DefaultNamespace;

    const federatedGraph = await fedgraphRepo.byName(req.name, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
        federatedGraphChangelogOutput: [],
        hasNextPage: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    if (!req.pagination || !req.dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Please provide pagination and daterange',
        },
        federatedGraphChangelogOutput: [],
        hasNextPage: false,
      };
    }

    const changelogRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'changelog-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: changelogRetention?.limit ?? 7,
      dateRange: req.dateRange,
    });

    if (!dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        federatedGraphChangelogOutput: [],
        hasNextPage: false,
      };
    }

    const result = await fedgraphRepo.fetchFederatedGraphChangelog(federatedGraph.targetId, req.pagination, dateRange);

    if (!result) {
      return {
        federatedGraphChangelogOutput: [],
        hasNextPage: false,
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      federatedGraphChangelogOutput: result.federatedGraphChangelog,
      hasNextPage: result.hasNextPage,
    };
  });
}
