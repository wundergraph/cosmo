import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOrganizationRequest,
  DeleteOrganizationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { addDays } from 'date-fns';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { delayForManualOrgDeletionInDays } from '../../constants.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteOrganization(
  opts: RouterOptions,
  req: DeleteOrganizationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const billingRepo = new BillingRepository(opts.db);

    const memberships = await orgRepo.memberships({ userId: authContext.userId });
    const orgCount = memberships.length;

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const subscription = await billingRepo.getActiveSubscriptionOfOrganization(org.id);
    if (subscription?.id) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'The organization subscription must be cancelled before the organization is deleted.',
        },
      };
    }

    const user = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
    });

    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // non admins cannot delete the organization
    if (!user.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    // Minimum one organization is required for a user
    if (orgCount <= 1) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Minimum one organization is required for a user.',
        },
      };
    }

    // If the organization deletion have already been queued we shouldn't do it again
    if (org.deletion) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    }

    const organizationMembers = await orgRepo.getMembers({ organizationID: org.id });
    const orgAdmins = organizationMembers.filter((m) => m.rbac.isOrganizationAdmin);

    const now = new Date();
    const oneMonthFromNow = addDays(now, delayForManualOrgDeletionInDays);

    await orgRepo.queueOrganizationDeletion({
      organizationId: org.id,
      queuedBy: authContext.userDisplayName,
      deleteOrganizationQueue: opts.queues.deleteOrganizationQueue,
    });

    await auditLogRepo.addAuditLog({
      organizationId: org.id,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization.deletion_queued',
      action: 'queued_deletion',
      actorId: authContext.userId,
      auditableType: 'organization',
      auditableDisplayName: org.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    if (opts.mailerClient && orgAdmins.length > 0) {
      const intl = Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      await opts.mailerClient.sendOrganizationDeletionQueuedEmail({
        receiverEmails: orgAdmins.map((m) => m.email),
        organizationName: org.name,
        userDisplayName: authContext.userDisplayName,
        queuedOnDate: intl.format(now),
        deletionDate: intl.format(oneMonthFromNow),
        restoreLink: `${process.env.WEB_BASE_URL}/${org.slug}/settings`,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
