import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetNamespaceChecksConfigurationRequest,
  GetNamespaceChecksConfigurationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getNamespaceChecksConfig(
  opts: RouterOptions,
  req: GetNamespaceChecksConfigurationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespaceChecksConfigurationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespaceChecksConfigurationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        timeframeInDays: 0,
        timeframeLimitInDays: 0,
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    const timeframeLimitInDays = changeRetention?.limit ?? 7;
    return {
      response: {
        code: EnumStatusCode.OK,
      },
      timeframeInDays: namespace.checksTimeframeInDays ?? timeframeLimitInDays,
      timeframeLimitInDays,
    };
  });
}
