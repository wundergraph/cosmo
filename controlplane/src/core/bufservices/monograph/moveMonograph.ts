import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { MoveGraphRequest, MoveGraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { TargetRepository } from '../../repositories/TargetRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function moveMonograph(
  opts: RouterOptions,
  req: MoveGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<MoveGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const targetRepo = new TargetRepository(opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);

    const graph = await fedGraphRepo.byName(req.name, req.namespace, {
      supportsFederation: false,
    });

    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Monograph '${req.name}' not found`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (graph.contract?.id) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Contract graphs cannot be moved individually. They will automatically be moved with the source graph.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const exists = await fedGraphRepo.exists(req.name, req.newNamespace);
    if (exists) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `A graph '${req.name}' already exists in the namespace ${req.newNamespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: graph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const movedGraphs = [graph];
    const targetIdsToMove = [graph.targetId];

    // Get all contracts that need to be moved along with the source graph.
    // Then pass all the target ids to the move function below
    const contracts = await contractRepo.bySourceFederatedGraphId(graph.id);
    for (const contract of contracts) {
      const contractGraph = await fedGraphRepo.byId(contract.downstreamFederatedGraphId);
      if (!contractGraph) {
        continue;
      }

      movedGraphs.push(contractGraph);
      targetIdsToMove.push(contractGraph.targetId);
    }

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: graph.targetId,
    });

    if (subgraphs.length > 0) {
      targetIdsToMove.push(subgraphs[0].targetId);
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: subgraphs[0].targetId,
          targetType: 'subgraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });
    }

    const newNamespace = await namespaceRepo.byName(req.newNamespace);
    if (!newNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.newNamespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    await targetRepo.moveWithoutRecomposition({
      targetIds: targetIdsToMove,
      newNamespaceId: newNamespace.id,
    });

    for (const movedGraph of movedGraphs) {
      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'monograph.moved',
        action: 'moved',
        actorId: authContext.userId,
        auditableType: 'monograph',
        auditableDisplayName: movedGraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: newNamespace.id,
        targetNamespaceDisplayName: newNamespace.name,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
      deploymentErrors: [],
      compositionWarnings: [],
    };
  });
}
