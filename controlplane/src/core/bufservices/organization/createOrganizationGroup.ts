import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOrganizationGroupRequest,
  CreateOrganizationGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { OrganizationGroupDTO } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createOrganizationGroup(
  opts: RouterOptions,
  req: CreateOrganizationGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Organization not found.',
        },
      };
    }

    if (!org.kcGroupId) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization group "${org.slug}" not found.`,
        },
      };
    }

    const rbac = await orgRepo.getFeature({ organizationId: authContext.organizationId, featureId: 'rbac' });
    if (!rbac?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: `RBAC feature is not enabled for this organization.`,
        },
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (await orgGroupRepo.nameExists({ organizationId: authContext.organizationId, name: req.name })) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `A group with the name "${req.name}" already exists.`,
        },
      };
    }

    await opts.keycloakClient.authenticateClient();
    const createdGroupId = await opts.keycloakClient.createSubGroup({
      realm: opts.keycloakRealm,
      parentId: org.kcGroupId,
      groupName: req.name,
    });

    if (!createdGroupId) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not create the new group',
        },
      };
    }

    let createdGroup: OrganizationGroupDTO;
    try {
      createdGroup = await orgGroupRepo.create({
        organizationId: authContext.organizationId,
        name: req.name,
        description: req.description,
        kcGroupId: createdGroupId,
      });
    } catch {
      if (createdGroupId) {
        try {
          await opts.keycloakClient.deleteGroupById({
            realm: opts.keycloakRealm,
            groupId: createdGroupId,
          });
        } catch {
          // ignored
        }
      }

      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not create the new group.',
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'group.created',
      action: 'created',
      actorId: authContext.userId,
      auditableDisplayName: req.name,
      auditableType: 'group',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      group: {
        groupId: createdGroup.groupId,
        name: createdGroup.name,
        description: createdGroup.description,
        builtin: createdGroup.builtin,
        membersCount: 0,
        apiKeysCount: 0,
        rules: [],
        hasOidcMappers: false,
      },
    };
  });
}
