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
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { organizationSchema } from "../../constants.js";

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

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

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
    if (!orgMember.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }


    const validatedReq = organizationSchema.safeParse({ name: req.organizationName, slug: req.organizationSlug });
    if (!validatedReq.success) {
      const { fieldErrors } = validatedReq.error.flatten();
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: fieldErrors.name?.[0] || fieldErrors.slug?.[0] || 'Invalid request',
        },
      };
    }

    if (org.slug !== validatedReq.data.slug) {
      // checking if the provided orgSlug is available
      const newOrg = await orgRepo.bySlug(validatedReq.data.slug);
      if (newOrg) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `Organization with slug ${validatedReq.data.slug} already exists.`,
          },
        };
      }

      await opts.keycloakClient.authenticateClient();
      if (!org.kcGroupId) {
        throw new Error(`Organization group '${org.slug}' not found`);
      }

      await opts.keycloakClient.client.groups.update(
        {
          id: org.kcGroupId,
          realm: opts.keycloakRealm,
        },
        { name: validatedReq.data.slug },
      );

      // Rename all the organization roles
      const kcOrganizationRoles = await opts.keycloakClient.client.roles.find({
        realm: opts.keycloakRealm,
        max: -1,
        search: `${org.slug}:`,
      });

      for (const kcRole of kcOrganizationRoles) {
        await opts.keycloakClient.client.roles.updateById(
          { realm: opts.keycloakRealm, id: kcRole.id! },
          {
            name: kcRole.name!.replace(`${org.slug}:`, `${validatedReq.data.slug}:`),
          },
        );
      }
    }

    await orgRepo.updateOrganization({
      id: authContext.organizationId,
      name: validatedReq.data.name,
      slug: validatedReq.data.slug,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization_details.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'organization',
      auditableDisplayName: org.name,
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
