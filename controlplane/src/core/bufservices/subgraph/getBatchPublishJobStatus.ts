import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  BatchPublishJobStatus,
  GetBatchPublishJobStatusRequest,
  GetBatchPublishJobStatusResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { maxRowLimitForChecks } from '../../constants.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { RouterOptions } from '../../routes.js';
import { clamp, enrichLogger, getLogger, handleError } from '../../util.js';
import { BatchPublishJobDetailsRepository } from '../../repositories/BatchPublishJobDetailsRepository.js';

export function getBatchPublishJobStatus(
  opts: RouterOptions,
  req: GetBatchPublishJobStatusRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetBatchPublishJobStatusResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetBatchPublishJobStatusResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const jobDetailsRepo = new BatchPublishJobDetailsRepository(opts.db, authContext.organizationId);
    const jobDetails = await jobDetailsRepo.byId(req.jobId);
    if (!jobDetails) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `A job with the identifier "${req.jobId}" does not exists`,
        },
        deploymentErrors: [],
        compositionWarnings: [],
        compositionErrors: [],
        updatedSubgraphNames: [],
      };
    }

    const compositionErrors = jobDetails.compositionResult?.compositionErrors ?? [];
    const compositionWarnings = jobDetails.compositionResult?.compositionWarnings ?? [];
    const deploymentErrors = jobDetails.compositionResult?.deploymentErrors ?? [];

    let status: BatchPublishJobStatus | undefined;
    let failureReason = jobDetails.failureReason || undefined;
    switch (jobDetails.status) {
      case 'pending': {
        status = BatchPublishJobStatus.PENDING;
        break;
      }
      case 'processing': {
        status = BatchPublishJobStatus.PROCESSING;
        break;
      }
      case 'failed': {
        status = BatchPublishJobStatus.FAILED;
        break;
      }
      case 'completed': {
        status = BatchPublishJobStatus.COMPLETED;
        break;
      }
    }

    // If there is an existing lock for the job and it has expired, we consider the job abandoned
    if (
      (status === BatchPublishJobStatus.PENDING || status === BatchPublishJobStatus.PROCESSING) &&
      jobDetails.lockExpiresAt &&
      jobDetails.lockExpiresAt < new Date()
    ) {
      status = BatchPublishJobStatus.FAILED;
      failureReason = 'Server closed before the composition completed.';
    }

    const boundedLimit = req.limit === undefined ? maxRowLimitForChecks : clamp(req.limit, 1, maxRowLimitForChecks);
    return {
      response: {
        code:
          compositionErrors.length > 0
            ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
            : deploymentErrors.length > 0
              ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
              : EnumStatusCode.OK,
      },
      status,
      failureReason,
      deploymentErrors: deploymentErrors.slice(0, boundedLimit),
      compositionErrors: compositionErrors.slice(0, boundedLimit),
      compositionWarnings: compositionWarnings.slice(0, boundedLimit),
      counts: {
        compositionErrors: compositionErrors.length,
        compositionWarnings: compositionWarnings.length,
        deploymentErrors: deploymentErrors.length,
      },
      updatedSubgraphNames: jobDetails?.compositionResult?.updatedSubgraphNames ?? [],
    };
  });
}
