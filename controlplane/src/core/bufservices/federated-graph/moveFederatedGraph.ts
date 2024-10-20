import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  DeploymentError,
  MoveGraphRequest,
  MoveGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function moveFederatedGraph(
  opts: RouterOptions,
  req: MoveGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<MoveGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);
      const orgWebhooks = new OrganizationWebhookService(
        tx,
        authContext.organizationId,
        opts.logger,
        opts.billingDefaultPlanId,
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
        };
      }

      const { compositionErrors, deploymentErrors } = await fedGraphRepo.move(
        {
          targetId: graph.targetId,
          newNamespaceId: newNamespace.id,
          updatedBy: authContext.userId,
          federatedGraph: graph,
        },
        opts.blobStorage,
        {
          cdnBaseUrl: opts.cdnBaseUrl,
          jwtSecret: opts.admissionWebhookJWTSecret,
        },
      );

      const allDeploymentErrors: PlainMessage<DeploymentError>[] = [];
      const allCompositionErrors: PlainMessage<CompositionError>[] = [];

      allCompositionErrors.push(...compositionErrors);
      allDeploymentErrors.push(...deploymentErrors);

      const movedGraphs = [graph];

      const contracts = await contractRepo.bySourceFederatedGraphId(graph.id);

      for (const contract of contracts) {
        const contractGraph = await fedGraphRepo.byId(contract.downstreamFederatedGraphId);
        if (!contractGraph) {
          continue;
        }

        const { compositionErrors: contractErrors, deploymentErrors: contractDeploymentErrors } =
          await fedGraphRepo.move(
            {
              targetId: contractGraph.targetId,
              newNamespaceId: newNamespace.id,
              updatedBy: authContext.userId,
              federatedGraph: contractGraph,
              skipDeployment: compositionErrors.length > 0,
            },
            opts.blobStorage,
            {
              cdnBaseUrl: opts.cdnBaseUrl,
              jwtSecret: opts.admissionWebhookJWTSecret,
            },
          );

        allCompositionErrors.push(...contractErrors);
        allDeploymentErrors.push(...contractDeploymentErrors);

        movedGraphs.push(contractGraph);
      }

      for (const movedGraph of movedGraphs) {
        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.moved',
          action: 'moved',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: movedGraph.name,
          actorDisplayName: authContext.userDisplayName,
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

      if (compositionErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
          },
          deploymentErrors: [],
          compositionErrors: allCompositionErrors,
        };
      }

      if (deploymentErrors?.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
          },
          deploymentErrors: allDeploymentErrors,
          compositionErrors: [],
        };
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    });
  });
}
