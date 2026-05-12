import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { MoveGraphRequest, MoveGraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';

export function moveFederatedGraph(
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

    return opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);
      const orgWebhooks = new OrganizationWebhookService(
        tx,
        authContext.organizationId,
        opts.logger,
        opts.billingDefaultPlanId,
        opts.webhookProxyUrl,
      );
      const auditLogRepo = new AuditLogRepository(tx);
      const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);

      const graph = await fedGraphRepo.byName(req.name, req.namespace, {
        supportsFederation: true,
      });
      if (!graph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Federated graph '${req.name}' not found`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      if (graph.contract?.id) {
        return {
          response: {
            code: EnumStatusCode.ERR,
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
            details: `A federated graph '${req.name}' already exists in the namespace ${req.newNamespace}`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: graph.targetId,
          targetType: 'federatedGraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });

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

      // Does not call `composeAndDeployFederatedGraph` by design
      await fedGraphRepo.move({
        targetId: graph.targetId,
        newNamespaceId: newNamespace.id,
        updatedBy: authContext.userId,
        federatedGraph: graph,
      });

      const movedGraphs = [graph];

      const contracts = await contractRepo.bySourceFederatedGraphId(graph.id);
      for (const contract of contracts) {
        const contractGraph = await fedGraphRepo.byId(contract.downstreamFederatedGraphId);
        if (!contractGraph) {
          continue;
        }

        // Does not call `composeAndDeployFederatedGraph` by design
        await fedGraphRepo.move({
          targetId: contractGraph.targetId,
          newNamespaceId: newNamespace.id,
          updatedBy: authContext.userId,
          federatedGraph: contractGraph,
        });

        movedGraphs.push(contractGraph);
      }

      const movedFederatedGraph = await fedGraphRepo.byId(graph.id);
      if (!movedFederatedGraph) {
        throw new Error('Federated graph not found');
      }

      const compositionService = new CompositionService(
        tx,
        authContext.organizationId,
        logger,
        { cdnBaseUrl: opts.cdnBaseUrl, webhookJWTSecret: opts.admissionWebhookJWTSecret },
        opts.blobStorage,
        opts.chClient,
        opts.webhookProxyUrl,
        req.disableResolvabilityValidation,
      );

      // Only call `composeAndDeployFederatedGraph` after all contracts have been moved
      const { compositionErrors, deploymentErrors, compositionWarnings } =
        await compositionService.composeAndDeployFederatedGraph({
          actorId: authContext.userId,
          federatedGraph: movedFederatedGraph,
        });

      for (const movedGraph of movedGraphs) {
        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'federated_graph.moved',
          action: 'moved',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: movedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: newNamespace.id,
          targetNamespaceDisplayName: newNamespace.name,
        });

        // Skip webhook since we do not deploy contracts on composition errors
        if (movedGraph.contract && compositionErrors.length > 0) {
          continue;
        }

        orgWebhooks.send(
          {
            eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
            payload: {
              federated_graph: {
                id: movedGraph.id,
                name: movedGraph.name,
                namespace: movedGraph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
              actor_id: authContext.userId,
            },
          },
          authContext.userId,
        );
      }

      return {
        response: {
          code:
            compositionErrors.length > 0
              ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
              : deploymentErrors.length > 0
                ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
                : EnumStatusCode.OK,
        },
        compositionErrors,
        deploymentErrors,
        compositionWarnings,
      };
    });
  });
}
