import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateIntegrationRequest,
  CreateIntegrationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import Slack from '../../services/Slack.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createIntegration(
  opts: RouterOptions,
  req: CreateIntegrationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateIntegrationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateIntegrationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    if (!opts.slack || !opts.slack.clientID || !opts.slack.clientSecret) {
      throw new Error('Slack env variables must be set to use this feature.');
    }

    const integration = await orgRepo.getIntegrationByName(authContext.organizationId, req.name);
    if (integration) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Integration with name ${req.name} already exists`,
        },
      };
    }

    const slack = new Slack({ clientID: opts.slack.clientID, clientSecret: opts.slack.clientSecret });

    const accessTokenResp = await slack.fetchAccessToken(
      req.code,
      `${opts.webBaseUrl}/${authContext.organizationSlug}/integrations`,
    );
    if (!accessTokenResp) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not set up the integration. Please try again.',
        },
      };
    }

    await slack.addSlackInstallations({
      accessToken: accessTokenResp.accessToken,
      db: opts.db,
      organizationId: authContext.organizationId,
      slackChannelId: accessTokenResp.slackChannelId,
      slackChannelName: accessTokenResp.slackChannelName,
      slackOrganizationId: accessTokenResp.slackOrgId,
      slackOrganizationName: accessTokenResp.slackOrgName,
      slackUserId: accessTokenResp.slackUserId,
    });

    await orgRepo.createIntegration({
      organizationId: authContext.organizationId,
      endpoint: accessTokenResp.webhookURL,
      events: req.events,
      eventsMeta: req.eventsMeta,
      name: req.name,
      type: req.type,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'integration.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'integration',
      auditableDisplayName: req.name,
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
