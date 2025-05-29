import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOrganizationWebhookConfigRequest,
  CreateOrganizationWebhookConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuthenticationError, UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createOrganizationWebhookConfig(
  opts: RouterOptions,
  req: CreateOrganizationWebhookConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationWebhookConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
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

    const webhookConfigId = await orgRepo.createWebhookConfig({
      organizationId: authContext.organizationId,
      eventsMeta: req.eventsMeta,
      key: req.key,
      events: req.events,
      endpoint: req.endpoint,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'webhook_config.created',
      action: 'created',
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
      webhookConfigId,
    };
  });
}
