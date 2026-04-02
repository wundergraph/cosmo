import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOnboardingRequest,
  CreateOnboardingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserInviteService } from '../../services/UserInviteService.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { organizationNameSchema } from '../../constants.js';

export function createOnboarding(
  opts: RouterOptions,
  req: CreateOnboardingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOnboardingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOnboardingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const organizationId = authContext.organizationId;
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const org = await orgRepo.byId(organizationId);

    if (!org || org.creatorUserId !== authContext.userId) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Only the organization creator can create onboarding.',
        },
        federatedGraphsCount: 0,
        slack: false,
        email: false,
      };
    }

    const auditLogRepo = new AuditLogRepository(opts.db);
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const validatedName = organizationNameSchema.safeParse(req.organizationName);
    if (!validatedName.success) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: validatedName.error.errors[0]?.message || 'Invalid organization name',
        },
        federatedGraphsCount: 0,
        slack: false,
        email: false,
      };
    }

    const onboardingRepo = new OnboardingRepository(opts.db, organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, organizationId);
    const organizationGroupRepo = new OrganizationGroupRepository(opts.db);
    const orgGroup = await organizationGroupRepo.byName({
      organizationId,
      name: 'organization-developer',
    });

    const service = new UserInviteService({
      db: opts.db,
      logger,
      keycloakRealm: opts.keycloakRealm,
      keycloak: opts.keycloakClient,
      mailer: opts.mailerClient,
    });

    async function createInvitationPromise({
      email,
      organizationId,
      userId,
      groupId,
    }: {
      email: string;
      organizationId: string;
      userId: string;
      groupId: string;
    }) {
      await service.inviteUser({
        organizationId,
        inviterUserId: userId,
        email,
        groups: [groupId],
      });

      await auditLogRepo.addAuditLog({
        organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'organization_invitation.created',
        action: 'created',
        actorId: authContext.userId,
        auditableDisplayName: email,
        auditableType: 'user',
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
    }

    const [onboarding, federatedGraphsCount] = await Promise.all([
      onboardingRepo.createOrUpdate({
        userId: authContext.userId,
        slack: req.slack,
        email: req.email,
      }),
      fedGraphRepo.count(),
      ...(validatedName.data === org.name
        ? []
        : [
            orgRepo.updateOrganizationName({
              id: org.id,
              name: validatedName.data,
            }),
          ]),
      ...(req.invititationEmails.length > 0 && orgGroup
        ? req.invititationEmails.map((email) =>
            createInvitationPromise({
              email,
              organizationId,
              userId: authContext.userId,
              groupId: orgGroup!.groupId,
            }),
          )
        : []),
    ]);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      finishedAt: onboarding.finishedAt?.toISOString(),
      federatedGraphsCount,
      slack: onboarding.slack,
      email: onboarding.email,
    };
  });
}
