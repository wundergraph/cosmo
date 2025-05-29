import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  PublishMonographRequest,
  PublishMonographResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildSchema } from '../../composition/composition.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function publishMonograph(
  opts: RouterOptions,
  req: PublishMonographRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PublishMonographResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PublishMonographResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );
    const auditLogRepo = new AuditLogRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    req.namespace = req.namespace || DefaultNamespace;

    const graph = await federatedGraphRepo.byName(req.name, req.namespace, {
      supportsFederation: false,
    });
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The graph ${req.name} was not found in namespace ${req.namespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    const subgraphSchemaSDL = req.schema;

    let isV2Graph: boolean | undefined;

    try {
      // Here we check if the schema is valid as a subgraph SDL
      const result = buildSchema(subgraphSchemaSDL, true, graph.routerCompatibilityVersion);
      if (!result.success) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
            details: result.errors.map((e) => e.toString()).join('\n'),
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      isV2Graph = result.isVersionTwo;
    } catch (e: any) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
          details: e.message,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: graph.targetId,
    });

    if (subgraphs.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find any subgraphs in the monograph ${req.name}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraphs[0].targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const { compositionErrors, updatedFederatedGraphs, deploymentErrors, compositionWarnings } =
      await subgraphRepo.update(
        {
          targetId: subgraphs[0].targetId,
          labels: [],
          unsetLabels: false,
          schemaSDL: subgraphSchemaSDL,
          updatedBy: authContext.userId,
          namespaceId: namespace.id,
          isV2Graph,
        },
        opts.blobStorage,
        {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        opts.chClient!,
      );

    for (const graph of updatedFederatedGraphs) {
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
          payload: {
            monograph: {
              id: graph.id,
              name: graph.name,
              namespace: graph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            actor_id: authContext.userId,
          },
        },
        authContext.userId,
      );
    }

    if (
      opts.openaiApiKey &&
      // Avoid calling OpenAI API if the schema is too big.
      // Best effort approach. This way of counting tokens is not accurate.
      subgraphSchemaSDL.length <= 10_000
    ) {
      const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
      const feature = await orgRepo.getFeature({
        organizationId: authContext.organizationId,
        featureId: 'ai',
      });

      if (feature?.enabled) {
        try {
          await opts.queues.readmeQueue.addJob({
            organizationId: authContext.organizationId,
            targetId: subgraphs[0].targetId,
            type: 'subgraph',
          });
        } catch (e) {
          logger.error(e, `Error adding job to subgraph readme queue`);
          // Swallow error because this is not critical
        }
      }
    }

    if (compositionErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
        },
        compositionErrors,
        deploymentErrors: [],
        compositionWarnings,
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        compositionErrors: [],
        deploymentErrors,
        compositionWarnings,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
      deploymentErrors: [],
      compositionWarnings,
    };
  });
}
