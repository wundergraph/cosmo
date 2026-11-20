import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  SetGraphResourceOwnersRequest,
  SetGraphResourceOwnersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphResourceOwnerRepository } from '../../repositories/GraphResourceOwnerRepository.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { parseGraphResourceKind } from '../../hubPermissions.js';
import { sendGovernanceUpdated } from '../../webhooks/governanceWebhook.js';
import type { PlainMessage } from '../../../types/index.js';

export function setGraphResourceOwners(
  opts: RouterOptions,
  req: SetGraphResourceOwnersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<SetGraphResourceOwnersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<SetGraphResourceOwnersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const ownerRepo = new GraphResourceOwnerRepository(opts.db, authContext.organizationId);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const resourceKind = parseGraphResourceKind(req.resourceKind);
    if (!resourceKind || !req.resource) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'A resource kind of subgraph, type or override and a resource are required',
        },
      };
    }

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace || DefaultNamespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const groupIds = [...new Set(req.groupIds)];
    const groups = await orgGroupRepo.byIds({ organizationId: authContext.organizationId, groupIds });
    if (groups.length !== groupIds.length) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'One of the submitted groups is not part of this organization',
        },
      };
    }

    const orgMemberIds = [...new Set(req.orgMemberIds)];
    const knownOrgMemberIds = await ownerRepo.organizationMemberIdsInOrganization(orgMemberIds);
    if (knownOrgMemberIds.length !== orgMemberIds.length) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'One of the submitted members is not part of this organization',
        },
      };
    }

    await ownerRepo.replaceOwners({
      federatedGraphId: federatedGraph.id,
      resourceKind,
      resource: req.resource,
      groupIds,
      orgMemberIds,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'federated_graph.owners_updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: `${federatedGraph.name} ${resourceKind} ${req.resource}`,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    sendGovernanceUpdated(opts, {
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      actorId: authContext.userId,
      reason: 'ownership',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
