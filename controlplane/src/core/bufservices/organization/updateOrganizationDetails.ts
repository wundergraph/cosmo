import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrganizationDetailsRequest,
  UpdateOrganizationDetailsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidOrganizationName, isValidOrganizationSlug } from '../../util.js';

export function updateOrganizationDetails(
  opts: RouterOptions,
  req: UpdateOrganizationDetailsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationDetailsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationDetailsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const orgMember = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
    });

    if (!orgMember) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // non admins cannot update the organization name
    if (!orgMember.roles.includes('admin')) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User does not have the permissions to update the organization name.',
        },
      };
    }

    if (!isValidOrganizationSlug(req.organizationSlug)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'Invalid slug. It must be of 3-24 characters in length, start and end with an alphanumeric character and may contain hyphens in between.',
        },
      };
    }

    if (!isValidOrganizationName(req.organizationName)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid name. It must be of 1-24 characters in length.',
        },
      };
    }

    if (org.slug !== req.organizationSlug) {
      // checking if the provided orgSlug is available
      const newOrg = await orgRepo.bySlug(req.organizationSlug);
      if (newOrg) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `Organization with slug ${req.organizationSlug} already exists.`,
          },
        };
      }

      await opts.keycloakClient.authenticateClient();

      const organizationGroup = await opts.keycloakClient.client.groups.find({
        max: 1,
        search: org.slug,
        realm: opts.keycloakRealm,
      });

      if (organizationGroup.length === 0) {
        throw new Error(`Organization group '${org.slug}' not found`);
      }

      await opts.keycloakClient.client.groups.update(
        {
          id: organizationGroup[0].id!,
          realm: opts.keycloakRealm,
        },
        { name: req.organizationSlug },
      );
    }

    await orgRepo.updateOrganization({
      id: authContext.organizationId,
      name: req.organizationName,
      slug: req.organizationSlug,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'organization_details.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'organization',
      auditableDisplayName: org.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
