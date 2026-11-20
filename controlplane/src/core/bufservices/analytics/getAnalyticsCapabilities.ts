import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ANALYTICS_DATASETS } from '@wundergraph/cosmo-shared';
import {
  GetAnalyticsCapabilitiesRequest,
  GetAnalyticsCapabilitiesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { FeatureIds, PlainMessage } from '../../../types/index.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { enforceAnalyticsRateLimit, isMcpRequest } from '../../services/AnalyticsRateLimiter.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

// How long each family of analytics data is stored, from the ClickHouse table TTLs.
const RETENTION_FAMILIES: { family: string; featureId: FeatureIds; storageTtlDays: number }[] = [
  { family: 'tracing', featureId: 'tracing-retention', storageTtlDays: 30 },
  { family: 'analytics', featureId: 'analytics-retention', storageTtlDays: 30 },
  { family: 'schema_usage', featureId: 'analytics-retention', storageTtlDays: 90 },
  { family: 'request_volume', featureId: 'analytics-retention', storageTtlDays: 90 },
];

export function getAnalyticsCapabilities(
  opts: RouterOptions,
  req: GetAnalyticsCapabilitiesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAnalyticsCapabilitiesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAnalyticsCapabilitiesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const getLimit = async (featureId: FeatureIds) =>
      (await orgRepo.getFeature({ organizationId: authContext.organizationId, featureId }))?.limit ?? undefined;

    const retention = await Promise.all(
      RETENTION_FAMILIES.map(async ({ family, featureId, storageTtlDays }) => {
        const planDays = (await getLimit(featureId)) ?? 7;
        return { family, planDays, storageTtlDays, effectiveDays: Math.min(planDays, storageTtlDays) };
      }),
    );

    const isApiKey = authContext.auth === 'api_key';
    const isOrganizationAdmin = authContext.rbac.isOrganizationAdmin;
    const monthlyRequestLimitInMillions = isOrganizationAdmin ? await getLimit('requests') : undefined;

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      now: new Date().toISOString(),
      principalType: isApiKey ? 'api_key' : 'user',
      isOrganizationAdmin,
      namespaceLoginRestrictionsApply: !isApiKey,
      retention,
      // Same default the router receives at registration (NodeService).
      traceSamplingRateLimit: (await getLimit('trace-sampling-rate')) ?? 0.1,
      analyticsEnabled: Boolean(opts.chClient),
      monthlyRequestLimit:
        monthlyRequestLimitInMillions === undefined ? undefined : BigInt(monthlyRequestLimitInMillions * 1_000_000),
      warnings: isApiKey ? ['API keys bypass namespace login-method restrictions.'] : [],
      datasets: opts.chClient ? ANALYTICS_DATASETS.map((dataset) => dataset.name) : [],
    };
  });
}
