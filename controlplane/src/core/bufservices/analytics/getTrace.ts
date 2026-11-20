import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetTraceRequest, GetTraceResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { TraceRepository } from '../../repositories/analytics/TraceRepository.js';
import { summarizeTrace } from '../../repositories/analytics/traceSummary.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';
import { authenticateAnalyticsRead } from '../../util/analytics/auth.js';

const MAX_SPANS = 2000;

export function getTrace(
  opts: RouterOptions,
  req: GetTraceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetTraceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetTraceResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        spans: [],
        truncated: false,
        totalSpans: 0,
      };
    }
    const authContext = await authenticateAnalyticsRead(opts, ctx);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graph = await fedGraphRepo.byId(req.federatedGraphId);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph not found`,
        },
        spans: [],
        truncated: false,
        totalSpans: 0,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const tracingRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'tracing-retention',
    });

    if (req.maxSpans !== undefined && (req.maxSpans < 1 || req.maxSpans > MAX_SPANS)) {
      return {
        response: { code: EnumStatusCode.ERR_BAD_REQUEST, details: `maxSpans must be between 1 and ${MAX_SPANS}.` },
        spans: [],
        truncated: false,
        totalSpans: 0,
      };
    }

    const traceRepo = new TraceRepository(opts.chClient);
    const trace = await traceRepo.getTrace({
      traceId: req.id,
      spanId: req.spanId || undefined,
      organizationId: authContext.organizationId,
      federatedGraphId: req.federatedGraphId,
      retentionDays: tracingRetention?.limit ?? 7,
      // Studio asks for a span and its descendants and shows up to 100 of them.
      maxSpans: req.maxSpans ?? (req.spanId ? 100 : 1000),
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      spans: trace.spans,
      summary: req.includeSummary ? summarizeTrace(trace.summarySpans, trace.eventsAvailable) : undefined,
      truncated: trace.truncated,
      totalSpans: trace.totalSpans,
    };
  });
}
