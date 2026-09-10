import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  Feature,
  AcceptFeatureTermsRequest,
  AcceptFeatureTermsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage, FeatureIds } from '../../../types/index.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function acceptFeatureTerms(
  opts: RouterOptions,
  req: AcceptFeatureTermsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<AcceptFeatureTermsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<AcceptFeatureTermsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const featureIds: FeatureIds[] = [];
    if (req.featureId) {
      switch (req.featureId) {
        case Feature.ai: {
          featureIds.push('ai');
          break;
        }
        case Feature.promptToQuery: {
          featureIds.push('prompt-to-query');
          break;
        }
        default: {
          throw new Error(`Feature doesnt exist`);
        }
      }
    } else {
      featureIds.push('ai', 'split-config-loading');
    }

    if (featureIds.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    }

    await orgRepo.acceptTermsForFeature({
      actorId: authContext.userId,
      organizationId: authContext.organizationId,
      featureIds,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
