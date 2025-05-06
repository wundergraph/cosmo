import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AddSubgraphMemberRequest,
  AddSubgraphMemberResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function addSubgraphMember(
  opts: RouterOptions,
  req: AddSubgraphMemberRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<AddSubgraphMemberResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<AddSubgraphMemberResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const userRepo = new UserRepository(logger, opts.db);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    await opts.keycloakClient.authenticateClient();

    // check if the user to be added exists
    const keycloakUser = await opts.keycloakClient.client.users.find({
      max: 1,
      email: req.userEmail,
      realm: opts.keycloakRealm,
      exact: true,
    });
    if (keycloakUser.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User with email ${req.userEmail} not found`,
        },
      };
    }

    const keycloakUserID = keycloakUser[0].id;
    const user = await userRepo.byId(keycloakUserID!);
    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User ${req.userEmail} not found`,
        },
      };
    }

    // check if the user is the member of the org
    const isMember = await orgRepo.isMemberOf({ organizationId: authContext.organizationId, userId: user.id });
    if (!isMember) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `User with email ${req.userEmail} is not a member of the organization.`,
        },
      };
    }

    // check if the subgraph exists
    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph ${req.subgraphName} not found`,
        },
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    await subgraphRepo.addSubgraphMember({ subgraphId: subgraph.id, userId: user.id });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'subgraph_member.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'user',
      auditableDisplayName: user.email,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      targetDisplayName: subgraph.name,
      targetId: subgraph.id,
      targetType: 'subgraph',
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: subgraph.namespaceId,
      targetNamespaceDisplayName: subgraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
