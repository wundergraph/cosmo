import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RemoveSubgraphMemberRequest,
  RemoveSubgraphMemberResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function removeSubgraphMember(
  opts: RouterOptions,
  req: RemoveSubgraphMemberRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RemoveSubgraphMemberResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RemoveSubgraphMemberResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

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

    const member = (await subgraphRepo.getSubgraphMembers(subgraph.id)).find(
      (sm) => sm.subgraphMemberId === req.subgraphMemberId,
    );

    if (!member) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The person is already not a member of the subgraph`,
        },
      };
    }

    await subgraphRepo.removeSubgraphMember({ subgraphId: subgraph.id, subgraphMemberId: req.subgraphMemberId });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'subgraph_member.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableType: 'user',
      auditableDisplayName: member.email,
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
