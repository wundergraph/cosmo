import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  PublishFederatedSubgraphsRequest,
  PublishFederatedSubgraphsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { maxRowLimitForChecks } from '../../constants.js';
import { buildSchema } from '../../composition/composition.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository, UpdateSubgraphSchemaData } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { SubgraphDTO } from '../../../types/index.js';
import {
  clamp,
  enrichLogger,
  getFederatedGraphRouterCompatibilityVersion,
  getLogger,
  handleError,
} from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { CompositionService } from '../../services/CompositionService.js';

/**
 * PublishFederatedSubgraphs publishes the schemas of multiple existing subgraphs (and feature subgraphs) in a single
 * request. Every subgraph must already exist. All schema versions are written first; then the union of affected
 * federated graphs (and their contracts / feature flags) is composed exactly once each, rather than once per
 * subgraph. This dramatically reduces the number of compositions when publishing many subgraphs at once.
 */
export function publishFederatedSubgraphs(
  opts: RouterOptions,
  req: PublishFederatedSubgraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PublishFederatedSubgraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PublishFederatedSubgraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
      opts.webhookProxyUrl,
    );
    const auditLogRepo = new AuditLogRepository(opts.db);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

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
        updatedSubgraphNames: [],
      };
    }

    // Combine regular subgraphs and feature subgraphs into a single ordered list, remembering which section each
    // entry came from so we can validate that the resolved subgraph is of the expected kind.
    const requestedEntries: { name: string; schema: string; isFeatureSubgraph: boolean }[] = [
      ...req.subgraphs.map((s) => ({ name: s.name, schema: s.schema, isFeatureSubgraph: false })),
      ...req.featureSubgraphs.map((s) => ({ name: s.name, schema: s.schema, isFeatureSubgraph: true })),
    ];

    if (requestedEntries.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `At least one subgraph or feature subgraph must be provided.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // Reject duplicate names within the request to avoid ambiguous, non-deterministic writes.
    const seenNames = new Set<string>();
    const duplicateNames = new Set<string>();
    for (const entry of requestedEntries) {
      if (seenNames.has(entry.name)) {
        duplicateNames.add(entry.name);
      }
      seenNames.add(entry.name);
    }
    if (duplicateNames.size > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The following subgraphs were provided more than once: ${[...duplicateNames].join(', ')}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // Resolve every requested subgraph; all of them must already exist.
    const resolved: { subgraph: SubgraphDTO; schema: string }[] = [];
    const notFound: string[] = [];
    const typeErrors: string[] = [];
    for (const entry of requestedEntries) {
      const subgraph = await subgraphRepo.byName(entry.name, req.namespace);
      if (!subgraph) {
        notFound.push(entry.name);
        continue;
      }

      if (subgraph.type === 'grpc_plugin') {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is a plugin. Please use the 'wgc router plugin publish' command to publish it.`,
        );
        continue;
      }
      if (subgraph.type === 'grpc_service') {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is a grpc service. Please use the 'wgc grpc-service publish' command to publish it.`,
        );
        continue;
      }

      if (entry.isFeatureSubgraph && !subgraph.isFeatureSubgraph) {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is not a feature subgraph. Move it to the "subgraphs" section of the config.`,
        );
        continue;
      }
      if (!entry.isFeatureSubgraph && subgraph.isFeatureSubgraph) {
        typeErrors.push(
          `Subgraph "${subgraph.name}" is a feature subgraph. Move it to the "featureSubgraphs" section of the config.`,
        );
        continue;
      }

      resolved.push({ subgraph, schema: entry.schema });
    }

    if (notFound.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The following subgraphs do not exist in the namespace "${req.namespace}": ${notFound.join(', ')}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    if (typeErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: typeErrors.join('\n'),
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    // The user must be authorized to publish each of the subgraphs.
    for (const { subgraph } of resolved) {
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: subgraph.targetId,
          targetType: 'subgraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });
    }

    // Validate every schema as a subgraph SDL before writing anything.
    const schemaErrors: string[] = [];
    const items: (UpdateSubgraphSchemaData & { name: string })[] = [];
    for (const { subgraph, schema } of resolved) {
      const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
        labels: subgraph.labels,
        namespaceId: namespace.id,
      });
      const routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion(federatedGraphs);

      let isEventDrivenGraph = false;
      let isV2Graph: boolean | undefined;
      try {
        const result = buildSchema(schema, true, routerCompatibilityVersion);
        if (!result.success) {
          schemaErrors.push(`Subgraph "${subgraph.name}": ${result.errors.map((e) => e.toString()).join('; ')}`);
          continue;
        }
        isEventDrivenGraph = result.isEventDrivenGraph || false;
        isV2Graph = result.isVersionTwo;
      } catch (e: any) {
        schemaErrors.push(`Subgraph "${subgraph.name}": ${e.message}`);
        continue;
      }

      // The subgraph already exists, so the stored EDG flag is the source of truth.
      if (subgraph.isEventDrivenGraph !== isEventDrivenGraph) {
        schemaErrors.push(
          subgraph.isEventDrivenGraph
            ? `Subgraph "${subgraph.name}" was originally created as an Event-Driven Graph (EDG) and cannot be published with a regular subgraph schema.`
            : `Subgraph "${subgraph.name}" was originally created as a regular subgraph and cannot be published with an Event-Driven Graph (EDG) schema.`,
        );
        continue;
      }

      items.push({
        name: subgraph.name,
        targetId: subgraph.targetId,
        labels: subgraph.labels,
        unsetLabels: false,
        schemaSDL: schema,
        updatedBy: authContext.userId,
        namespaceId: namespace.id,
        isV2Graph,
      });
    }

    if (schemaErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
          details: schemaErrors.join('\n'),
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        updatedSubgraphNames: [],
      };
    }

    const { compositionErrors, compositionWarnings, deploymentErrors, updatedFederatedGraphs, changedSubgraphNames } =
      await opts.db.transaction((tx) => {
        const subgraphRepoTx = new SubgraphRepository(logger, tx, authContext.organizationId);
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

        return subgraphRepoTx.batchUpdate(items, compositionService);
      });

    // Send a schema-updated webhook for each federated graph that was recomposed.
    for (const graph of updatedFederatedGraphs) {
      const hasErrors =
        compositionErrors.some((error) => error.federatedGraphName === graph.name) ||
        deploymentErrors.some((error) => error.federatedGraphName === graph.name);
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: graph.id,
              name: graph.name,
              namespace: graph.namespace,
              composedSchemaVersionId: graph.composedSchemaVersionId,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: hasErrors,
            actor_id: authContext.userId,
          },
        },
        authContext.userId,
      );
    }

    // Audit log per subgraph that actually changed.
    const changedSet = new Set(changedSubgraphNames);
    for (const { subgraph } of resolved) {
      if (!changedSet.has(subgraph.name)) {
        continue;
      }
      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.updated' : 'subgraph.updated',
        action: 'updated',
        actorId: authContext.userId,
        auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
        auditableDisplayName: subgraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: subgraph.namespaceId,
        targetNamespaceDisplayName: subgraph.namespace,
      });
    }

    const boundedLimit = req.limit === undefined ? maxRowLimitForChecks : clamp(req.limit, 1, maxRowLimitForChecks);

    const counts = {
      compositionErrors: compositionErrors.length,
      compositionWarnings: compositionWarnings.length,
      deploymentErrors: deploymentErrors.length,
    };

    return {
      response: {
        code:
          compositionErrors.length > 0
            ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
            : deploymentErrors.length > 0
              ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
              : EnumStatusCode.OK,
      },
      deploymentErrors: deploymentErrors.slice(0, boundedLimit),
      compositionErrors: compositionErrors.slice(0, boundedLimit),
      compositionWarnings: compositionWarnings.slice(0, boundedLimit),
      counts,
      updatedSubgraphNames: changedSubgraphNames,
    };
  });
}
