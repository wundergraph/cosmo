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
import { AuditLogRepository } from "../../repositories/AuditLogRepository.js";

export function createOrganizationGroup(
  opts: RouterOptions,
  req: CreateOrganizationGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

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
      organizationSlug: authContext.organizationSlug,
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
        kcGroupId: createdGroupId,
      });
    } catch (e: unknown) {
      await opts.keycloakClient.client.groups.del({ id: createdGroupId });
      throw e;
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
        groupId: createdGroup.id,
        name: createdGroup.name,
        membersCount: 0,
        rules: [],
      },
    };
  });
}
