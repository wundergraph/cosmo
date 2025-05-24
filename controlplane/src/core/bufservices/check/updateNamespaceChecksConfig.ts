import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateNamespaceChecksConfigurationRequest,
  UpdateNamespaceChecksConfigurationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, clamp } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateNamespaceChecksConfig(
  opts: RouterOptions,
  req: UpdateNamespaceChecksConfigurationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateNamespaceChecksConfigurationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateNamespaceChecksConfigurationResponse>>(ctx, logger, async () => {
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
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.hasNamespaceWriteAccess(namespace)) {
      throw new UnauthorizedError();
    }

    const changeRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'breaking-change-retention',
    });

    const timeframeLimitInDays = changeRetention?.limit ?? 7;
    await namespaceRepo.updateConfiguration({
      id: namespace.id,
      checksTimeframeInDays: clamp(req.timeframeInDays, 1, timeframeLimitInDays),
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
