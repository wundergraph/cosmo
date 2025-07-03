import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrganizationGroupRequest,
  UpdateOrganizationGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { organizationRoleEnum } from '../../../db/schema.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { OrganizationRole } from '../../../db/models.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateOrganizationGroup(
  opts: RouterOptions,
  req: UpdateOrganizationGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);

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

    const orgGroup = await orgGroupRepo.byId({
      organizationId: authContext.organizationId,
      groupId: req.groupId,
    });

    if (!orgGroup) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    if (orgGroup.builtin) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Builtin groups cannot be updated.',
        },
      };
    }

    // Combine resources into a single array of unique values per role
    const allResourcesGroupedByRole = Object.groupBy(req.rules, ({ role }) => role);
    const resourcesByRole: {
      role: OrganizationRole;
      namespaces: string[];
      resources: string[];
    }[] = [];

    const orgRoles = new Set<OrganizationRole>(['organization-admin', 'organization-developer', 'organization-viewer']);
    for (const key of Object.keys(allResourcesGroupedByRole)) {
      const role = organizationRoleEnum.enumValues.find((r) => r === key.toLowerCase());
      if (!role) {
        continue;
      }

      const groupRules = allResourcesGroupedByRole[key] ?? [];
      const namespaces = groupRules.flatMap((x) => x.namespaces);
      const resources = groupRules.flatMap((x) => x.resources);

      const isOrganizationRole = orgRoles.has(role);
      resourcesByRole.push({
        role,
        namespaces: isOrganizationRole ? [] : [...new Set(namespaces)],
        resources: isOrganizationRole || namespaces.length > 0 ? [] : [...new Set(resources)],
      });
    }

    // Make sure the organization roles exists
    await opts.keycloakClient.authenticateClient();

    const rolesToAddToGroup = resourcesByRole.map((r) => `${authContext.organizationSlug}:${r.role}`);
    await Promise.all(
      rolesToAddToGroup.map(async (roleName) => {
        if (!(await opts.keycloakClient.roleExists({ realm: opts.keycloakRealm, roleName }))) {
          await opts.keycloakClient.createRole({ realm: opts.keycloakRealm, roleName });
        }
      }),
    );

    // Swap the Keycloak group's roles
    // - load all the existing roles existing for the organization
    // - delete all the role mappings from the target group
    // - add the target role mappings to the target group
    const kcOrgRoles = await opts.keycloakClient.client.roles.find({
      realm: opts.keycloakRealm,
      search: `${authContext.organizationSlug}:`,
    });

    const kcOrgRolesPayload = kcOrgRoles.map((r) => ({ id: r.id!, name: r.name! }));

    await opts.keycloakClient.client.groups.delRealmRoleMappings({
      realm: opts.keycloakRealm,
      id: orgGroup.kcGroupId!,
      roles: kcOrgRolesPayload,
    });

    await opts.keycloakClient.client.groups.addRealmRoleMappings({
      realm: opts.keycloakRealm,
      id: orgGroup.kcGroupId!,
      roles: kcOrgRolesPayload.filter((r) => rolesToAddToGroup.includes(r.name)),
    });

    // Finally, update the group roles
    await orgGroupRepo.updateGroup({
      organizationId: authContext.organizationId,
      groupId: orgGroup.groupId,
      description: req.description,
      rules: resourcesByRole,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
