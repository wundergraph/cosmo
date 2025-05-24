import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrganizationWebhookConfigRequest,
  UpdateOrganizationWebhookConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuthenticationError, UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function updateOrganizationWebhookConfig(
  opts: RouterOptions,
  req: UpdateOrganizationWebhookConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationWebhookConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    if (!req.id) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Webhook config id is required`,
        },
      };
    }

    const webhook = await orgRepo.getWebhookConfigById(req.id, authContext.organizationId);
    if (!webhook) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Webhook config not found`,
        },
      };
    }

    // Check if the user is authorized to subscribe to the events of the federated / mono graphs
    for (const eventMeta of req.eventsMeta) {
      if (!eventMeta.meta.value) {
        continue;
      }
      for (const graphId of eventMeta.meta.value.graphIds) {
        const graph = await fedRepo.byId(graphId);
        if (!graph) {
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHORIZED, `Not authorized to access graph`);
        }
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: graph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });
      }
    }

    await orgRepo.updateWebhookConfig({
      organizationId: authContext.organizationId,
      id: req.id,
      endpoint: req.endpoint,
      events: req.events,
      key: req.key,
      eventsMeta: req.eventsMeta,
      shouldUpdateKey: req.shouldUpdateKey,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'webhook_config.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'webhook_config',
      auditableDisplayName: req.endpoint,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
