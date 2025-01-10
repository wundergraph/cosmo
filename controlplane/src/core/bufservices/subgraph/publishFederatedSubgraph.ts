import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  PublishFederatedSubgraphRequest,
  PublishFederatedSubgraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { buildSchema } from '../../composition/composition.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  enrichLogger,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getLogger,
  handleError,
  isValidGraphName,
  isValidLabels,
} from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function publishFederatedSubgraph(
  opts: RouterOptions,
  req: PublishFederatedSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PublishFederatedSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PublishFederatedSubgraphResponse>>(ctx, logger, async () => {
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
    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const subgraphSchemaSDL = req.schema;
    let isEventDrivenGraph = false;
    let isV2Graph: boolean | undefined;

    try {
      // Here we check if the schema is valid as a subgraph SDL
      const { errors, normalizationResult } = buildSchema(subgraphSchemaSDL);
      if (errors && errors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
            details: errors.map((e) => e.toString()).join('\n'),
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      isEventDrivenGraph = normalizationResult?.isEventDrivenGraph || false;
      isV2Graph = normalizationResult?.isVersionTwo;
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

    const routingUrl = req.routingUrl || '';
    let subgraph = await subgraphRepo.byName(req.name, req.namespace);
    let baseSubgraphID = '';

    /* If the subgraph exists, validate that no parameters were included.
     * Otherwise, validate the input and create the subgraph.
     */
    if (subgraph) {
      // check whether the user is authorized to perform the action
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: subgraph.targetId,
          targetType: 'subgraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });
      /* The subgraph already exists, so the database flag and the normalization result should match.
       * If he flags do not match, the database is the source of truth, so return an appropriate error.
       * */
      if (subgraph.isEventDrivenGraph !== isEventDrivenGraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: isEventDrivenGraph
              ? 'The subgraph was originally created as a regular subgraph.' +
                ' A regular subgraph cannot be retroactively changed into an Event-Driven Graph (EDG).' +
                ' Please create a new Event-Driven subgraph with the --edg flag.'
              : 'The subgraph was originally created as an Event-Driven Graph (EDG).' +
                ' An EDG cannot be retroactively changed into a regular subgraph.' +
                ' Please create a new regular subgraph.',
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
    } else {
      if (req.isFeatureSubgraph) {
        if (req.baseSubgraphName) {
          const baseSubgraph = await subgraphRepo.byName(req.baseSubgraphName, req.namespace);
          if (!baseSubgraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Base subgraph "${req.baseSubgraphName}" does not exist in the namespace "${req.namespace}".`,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
            };
          }
          baseSubgraphID = baseSubgraph.id;
        } else {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Feature Subgraph ${req.name} not found. If intended to create and publish, please pass the name of the base subgraph with --subgraph option.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
      }

      // Labels are not required but should be valid if included.
      if (!isValidLabels(req.labels)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_LABELS,
            details: `One or more labels were found to be invalid`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      if (isEventDrivenGraph) {
        if (req.routingUrl !== undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `An Event-Driven Graph must not define a routing URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
        if (req.subscriptionUrl !== undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `An Event-Driven Graph must not define a subscription URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
        if (req.subscriptionProtocol !== undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `An Event-Driven Graph must not define a subscription protocol`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
        if (req.websocketSubprotocol !== undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `An Event-Driven Graph must not define a websocket subprotocol.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
      } else {
        if (!isValidUrl(routingUrl)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: routingUrl
                ? `Routing URL "${routingUrl}" is not a valid URL.`
                : req.isFeatureSubgraph
                  ? `A valid, non-empty routing URL is required to create and publish a feature subgraph.`
                  : `A valid, non-empty routing URL is required to create and publish a non-Event-Driven subgraph.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }

        if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Subscription URL "${req.subscriptionUrl}" is not a valid URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
          };
        }
      }

      if (!isValidGraphName(req.name)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_NAME,
            details: `The name of the subgraph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      // Create the subgraph if it doesn't exist
      subgraph = await subgraphRepo.create({
        name: req.name,
        namespace: req.namespace,
        namespaceId: namespace.id,
        createdBy: authContext.userId,
        labels: req.labels,
        isEventDrivenGraph,
        routingUrl,
        subscriptionUrl: req.subscriptionUrl,
        subscriptionProtocol:
          req.subscriptionProtocol === undefined ? undefined : formatSubscriptionProtocol(req.subscriptionProtocol),
        websocketSubprotocol:
          req.websocketSubprotocol === undefined ? undefined : formatWebsocketSubprotocol(req.websocketSubprotocol),
        featureSubgraphOptions:
          req.isFeatureSubgraph && baseSubgraphID !== ''
            ? {
                isFeatureSubgraph: req.isFeatureSubgraph || false,
                baseSubgraphID,
              }
            : undefined,
      });

      if (!subgraph) {
        throw new Error(`Subgraph '${req.name}' could not be created`);
      }

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        auditAction: 'subgraph.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'subgraph',
        auditableDisplayName: subgraph.name,
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: subgraph.namespaceId,
        targetNamespaceDisplayName: subgraph.namespace,
      });
    }

    const { compositionErrors, updatedFederatedGraphs, deploymentErrors, subgraphChanged, compositionWarnings } =
      await subgraphRepo.update(
        {
          targetId: subgraph.targetId,
          labels: subgraph.labels,
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

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.updated' : 'subgraph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
      auditableDisplayName: subgraph.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: subgraph.namespaceId,
      targetNamespaceDisplayName: subgraph.namespace,
    });

    if (namespace.enableGraphPruning) {
      const graphPruningConfigs = await schemaGraphPruningRepo.getNamespaceGraphPruningConfig(namespace.id);
      await subgraphRepo.handleSubgraphFieldGracePeriods({
        subgraphId: subgraph.id,
        namespaceId: subgraph.namespaceId,
        schemaSDL: subgraph.schemaSDL,
        newSchemaSDL: req.schema,
        graphPruningConfigs,
      });
    }

    if (
      opts.openaiApiKey &&
      // Avoid calling OpenAI API if the schema is too big.
      // Best effort approach. This way of counting tokens is not accurate.
      subgraph.schemaSDL.length <= 10_000
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
            targetId: subgraph.targetId,
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
        compositionWarnings,
        deploymentErrors: [],
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
      hasChanged: subgraphChanged,
      compositionWarnings,
    };
  });
}
