import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  Feature,
  UpdateFeatureSettingsRequest,
  UpdateFeatureSettingsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureIds } from '../../../types/index.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateFeatureSettings(
  opts: RouterOptions,
  req: UpdateFeatureSettingsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateFeatureSettingsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateFeatureSettingsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    let featureId: FeatureIds;
    switch (req.featureId) {
      case Feature.rbac: {
        featureId = 'rbac';
        break;
      }
      case Feature.ai: {
        featureId = 'ai';
        break;
      }
      case Feature.scim: {
        featureId = 'scim';
        break;
      }
      default: {
        throw new Error(`Feature doesnt exist`);
      }
    }

    await orgRepo.updateFeature({
      organizationId: authContext.organizationId,
      id: featureId,
      enabled: req.enable,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
