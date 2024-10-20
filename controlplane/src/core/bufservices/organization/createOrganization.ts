import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOrganizationRequest,
  CreateOrganizationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PublicError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { BillingService } from '../../services/BillingService.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createOrganization(
  opts: RouterOptions,
  req: CreateOrganizationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const billingRepo = new BillingRepository(opts.db);
    const plans = await billingRepo.listPlans();

    if (opts.stripeSecretKey) {
      if (!plans?.length) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'No billing plans configured. Please contact support.',
          },
        };
      }

      // Validate the plan
      if (plans?.length && !plans.some((plan) => plan.id === req.plan && 'stripePriceId' in plan)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Invalid plan. Please contact support.',
          },
        };
      }
    }

    await opts.keycloakClient.authenticateClient();

    // Create the organization group in Keycloak + subgroups
    await opts.keycloakClient.seedGroup({
      userID: authContext.userId,
      organizationSlug: req.slug,
      realm: opts.keycloakRealm,
    });

    try {
      const data = await opts.db.transaction(async (tx) => {
        const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
        const billingRepo = new BillingRepository(tx);
        const billingService = new BillingService(tx, billingRepo);
        const auditLogRepo = new AuditLogRepository(tx);

        const organization = await orgRepo.createOrganization({
          organizationName: req.name,
          organizationSlug: req.slug,
          ownerID: authContext.userId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: organization.id,
          auditAction: 'organization.created',
          action: 'created',
          actorId: authContext.userId,
          targetId: organization.id,
          targetType: 'organization',
          targetDisplayName: organization.name,
          auditableType: 'organization',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          auditableDisplayName: organization.name,
        });

        const orgMember = await orgRepo.addOrganizationMember({
          organizationID: organization.id,
          userID: authContext.userId,
        });

        await orgRepo.addOrganizationMemberRoles({
          memberID: orgMember.id,
          roles: ['admin'],
        });

        let sessionId: string | undefined;
        if (opts.stripeSecretKey) {
          const session = await billingService.createCheckoutSession({
            organizationId: organization.id,
            organizationSlug: organization.slug,
            plan: req.plan,
          });
          sessionId = session.id;
        }

        const namespaceRepo = new NamespaceRepository(tx, organization.id);
        const ns = await namespaceRepo.create({
          name: DefaultNamespace,
          createdBy: authContext.userId,
        });

        if (!ns) {
          throw new PublicError(EnumStatusCode.ERR, `Could not create ${DefaultNamespace} namespace`);
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'namespace.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'namespace',
          auditableDisplayName: ns.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          organization,
          sessionId,
        };
      });

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        organization: {
          id: data.organization.id,
          name: data.organization.name,
          slug: data.organization.slug,
          createdAt: data.organization.createdAt,
          creatorUserId: data.organization.creatorUserId,
        },
        stripeSessionId: data.sessionId,
      };
    } catch (err) {
      logger.error(err);

      // Delete the organization group in Keycloak + subgroups
      // when the organization creation fails
      await opts.keycloakClient.deleteOrganizationGroup({
        realm: opts.keycloakRealm,
        organizationSlug: req.slug,
      });

      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Organization creation failed',
        },
      };
    }
  });
}
