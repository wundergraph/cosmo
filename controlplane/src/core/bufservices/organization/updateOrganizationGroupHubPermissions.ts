import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  HubPermissionGrant,
  UpdateOrganizationGroupHubPermissionsRequest,
  UpdateOrganizationGroupHubPermissionsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { parseHubPermission } from '../../hubPermissions.js';
import type { HubPermission } from '../../../db/models.js';
import { sendGovernanceUpdated } from '../../webhooks/governanceWebhook.js';
import type { HubPermissionGrantDTO, PlainMessage } from '../../../types/index.js';

// Only view_hidden_schema carries tags. Empty tags mean every hidden tag.
function normalizeTags(permission: HubPermission, tags: string[]): string[] {
  if (permission !== 'view_hidden_schema') {
    return [];
  }

  const normalized = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0);

  return [...new Set(normalized)].sort();
}

// Merges grants of the same permission so each permission is stored once per group.
function mergeGrants(grants: HubPermissionGrant[]): HubPermissionGrantDTO[] | string {
  const merged = new Map<string, HubPermissionGrantDTO>();

  for (const grant of grants) {
    const permission = parseHubPermission(grant.permission);
    if (!permission) {
      return grant.permission;
    }

    const tags = normalizeTags(permission, grant.tags);

    const existing = merged.get(permission);
    if (!existing) {
      merged.set(permission, {
        permission,
        namespaces: [...new Set(grant.namespaces)],
        resources: [...new Set(grant.resources)],
        tags,
      });
      continue;
    }

    existing.namespaces = [...new Set([...existing.namespaces, ...grant.namespaces])];
    existing.resources = [...new Set([...existing.resources, ...grant.resources])];

    // A grant without tags already covers every hidden tag.
    const coversEveryTag = existing.tags.length === 0 || tags.length === 0;
    existing.tags = coversEveryTag ? [] : normalizeTags(permission, [...existing.tags, ...tags]);
  }

  return [...merged.values()];
}

export function updateOrganizationGroupHubPermissions(
  opts: RouterOptions,
  req: UpdateOrganizationGroupHubPermissionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationGroupHubPermissionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationGroupHubPermissionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const orgGroup = await orgGroupRepo.byId({
      organizationId: authContext.organizationId,
      groupId: req.groupId,
    });

    if (!orgGroup) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Group not found',
        },
      };
    }

    const grants = mergeGrants(req.hubPermissions);
    if (typeof grants === 'string') {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: `Unknown Hub permission "${grants}"`,
        },
      };
    }

    await orgGroupRepo.setHubPermissions({ groupId: orgGroup.groupId, grants });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'group.hub_permissions_updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableDisplayName: orgGroup.name,
      auditableType: 'group',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    sendGovernanceUpdated(opts, {
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      actorId: authContext.userId,
      reason: 'hub_permissions',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
