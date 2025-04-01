import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetChecksOfProposalRequest,
  GetChecksOfProposalResponse,
  SchemaCheck,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';

export function getChecksOfProposal(
  opts: RouterOptions,
  req: GetChecksOfProposalRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetChecksOfProposalResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetChecksOfProposalResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const proposalRepo = new ProposalRepository(opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    // Check if the proposal exists
    const proposal = await proposalRepo.ById(req.proposalId);
    if (!proposal) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Proposal with ID ${req.proposalId} not found`,
        },
        checks: [],
        totalChecksCount: 0,
      };
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
        totalChecksCount: 0,
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
        totalChecksCount: 0,
      };
    }

    // Get checks for the proposal
    const { checks, checksCount } = await proposalRepo.getChecksByProposalId({
      proposalId: req.proposalId,
      federatedGraphId: proposal.proposal.federatedGraphId,
      limit: req.limit,
      offset: req.offset,
      startDate: dateRange?.start,
      endDate: dateRange?.end,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      checks,
      totalChecksCount: checksCount,
    };
  });
}
