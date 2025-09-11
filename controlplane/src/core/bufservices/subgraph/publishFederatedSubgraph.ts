import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  PublishFederatedSubgraphRequest,
  PublishFederatedSubgraphResponse,
  SubgraphType,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { buildSchema } from '../../composition/composition.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { PluginRepository } from '../../repositories/PluginRepository.js';
import { ProposalRepository } from '../../repositories/ProposalRepository.js';
import { SchemaGraphPruningRepository } from '../../repositories/SchemaGraphPruningRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  convertToSubgraphType,
  enrichLogger,
  formatSubgraphType,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getFederatedGraphRouterCompatibilityVersion,
  getLogger,
  handleError,
  isValidGraphName,
  isValidLabels,
  isValidPluginVersion,
  newCompositionOptions,
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
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const schemaGraphPruningRepo = new SchemaGraphPruningRepository(opts.db);
    const proposalRepo = new ProposalRepository(opts.db);
    const pluginRepo = new PluginRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    req.namespace = req.namespace || DefaultNamespace;
    req.type = req.type || SubgraphType.STANDARD;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const subgraphSchemaSDL = req.schema;
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
    let subgraph = await subgraphRepo.byName(req.name, req.namespace);
    let isEventDrivenGraph = false;
    let isV2Graph: boolean | undefined;

    let routerCompatibilityVersion: string | undefined;
    try {
      const federatedGraphs = subgraph
        ? await fedGraphRepo.bySubgraphLabels({ labels: subgraph.labels, namespaceId: namespace.id })
        : [];
      routerCompatibilityVersion = getFederatedGraphRouterCompatibilityVersion(federatedGraphs);
      /*
       * If there are any federated graphs for which the subgraph is a constituent, the subgraph will be validated
       * against the first router compatibility version encountered.
       * If no federated graphs have yet been created, the subgraph will be validated against the latest router
       * compatibility version.
       */
      // Here we check if the schema is valid as a subgraph SDL
      const result = buildSchema(subgraphSchemaSDL, true, routerCompatibilityVersion);
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
      isEventDrivenGraph = result.isEventDrivenGraph || false;
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

    let proposalMatchMessage: string | undefined;
    let matchedEntity:
      | {
          proposalId: string;
          proposalSubgraphId: string;
        }
      | undefined;

    // if the subgraph is a feature subgraph, we don't need to check for proposal matches for now.
    if (namespace.enableProposals && !subgraph?.isFeatureSubgraph) {
      const proposalConfig = await proposalRepo.getProposalConfig({ namespaceId: namespace.id });
      if (proposalConfig) {
        const match = await proposalRepo.matchSchemaWithProposal({
          subgraphName: req.name,
          namespaceId: namespace.id,
          schemaSDL: subgraphSchemaSDL,
          routerCompatibilityVersion,
          isDeleted: false,
        });
        if (!match) {
          const message = `The subgraph ${req.name}'s schema does not match to this subgraph's schema in any approved proposal.`;
          if (proposalConfig.publishSeverityLevel === 'warn') {
            proposalMatchMessage = message;
          } else {
            return {
              response: {
                code: EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL,
                details: message,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
              proposalMatchMessage: message,
            };
          }
        }
        matchedEntity = match;
      }
    }

    const routingUrl = req.routingUrl || '';
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

      if (req.type !== undefined && subgraph.type !== formatSubgraphType(req.type)) {
        const subgraphTypeMessages: Record<string, string> = {
          grpc_plugin: `Subgraph ${subgraph.name} is a plugin. Please use the 'wgc router plugin publish' command to publish the plugin.`,
          grpc_service: `Subgraph ${subgraph.name} is a grpc service. Please use the 'wgc grpc-service publish' command to publish the grpc service.`,
        };

        const errorMessage =
          subgraphTypeMessages[subgraph.type] ||
          `Subgraph ${subgraph.name} is not of type ${formatSubgraphType(req.type)}.`;

        return {
          response: {
            code: EnumStatusCode.ERR,
            details: errorMessage,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
          proposalMatchMessage,
        };
      }

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
          proposalMatchMessage,
        };
      }
    } else {
      if (!authContext.rbac.canCreateSubGraph(namespace)) {
        throw new UnauthorizedError();
      }

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
              proposalMatchMessage,
            };
          }
          if (baseSubgraph.isFeatureSubgraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Base subgraph "${req.baseSubgraphName}" is a feature subgraph. Feature subgraphs cannot have feature subgraphs as their base.`,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
              proposalMatchMessage,
            };
          }
          baseSubgraphID = baseSubgraph.id;
          req.type = convertToSubgraphType(baseSubgraph.type);

          if (baseSubgraph.type === 'grpc_plugin') {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Cannot create a feature subgraph with a plugin base subgraph using this command. Since the base subgraph "${req.baseSubgraphName}" is a plugin, please use the 'wgc feature-subgraph create' command to create the feature subgraph first, then publish it using the 'wgc router plugin publish' command.`,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
              proposalMatchMessage,
            };
          }

          if (baseSubgraph.type === 'grpc_service') {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Cannot create a feature subgraph with a grpc service base subgraph using this command. Since the base subgraph "${req.baseSubgraphName}" is a grpc service, please use the 'wgc feature-subgraph create' command to create the feature subgraph first, then publish it using the 'wgc grpc-service publish' command.`,
              },
              compositionErrors: [],
              deploymentErrors: [],
              compositionWarnings: [],
              proposalMatchMessage,
            };
          }
        } else {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Feature Subgraph ${req.name} not found. If intended to create and publish, please pass the name of the base subgraph with --subgraph option.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
            proposalMatchMessage,
          };
        }

        // check whether the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: baseSubgraphID,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });
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
          proposalMatchMessage,
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
            proposalMatchMessage,
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
            proposalMatchMessage,
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
            proposalMatchMessage,
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
            proposalMatchMessage,
          };
        }
      } else if (req.type !== SubgraphType.GRPC_PLUGIN) {
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
            proposalMatchMessage,
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
            proposalMatchMessage,
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
          proposalMatchMessage,
        };
      }

      if (req.type === SubgraphType.GRPC_PLUGIN) {
        const count = await pluginRepo.count({ namespaceId: namespace.id });
        const feature = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'plugins',
        });
        const limit = feature?.limit === -1 ? 0 : feature?.limit ?? 0;
        if (count >= limit) {
          return {
            response: {
              code: EnumStatusCode.ERR_LIMIT_REACHED,
              details: `The organization reached the limit of plugins`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
            proposalMatchMessage,
          };
        }
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
        type: formatSubgraphType(req.type),
      });

      if (!subgraph) {
        throw new Error(`Subgraph '${req.name}' could not be created`);
      }

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'subgraph.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'subgraph',
        auditableDisplayName: subgraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: subgraph.namespaceId,
        targetNamespaceDisplayName: subgraph.namespace,
      });
    }

    if (req.type === SubgraphType.GRPC_PLUGIN || req.type === SubgraphType.GRPC_SERVICE) {
      if (!req.proto) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `The proto is required for plugin and grpc subgraphs.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
          proposalMatchMessage,
        };
      }

      if (req.type === SubgraphType.GRPC_PLUGIN) {
        if (!req.proto.version || !req.proto.platforms || req.proto.platforms.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The version and platforms are required for plugin subgraphs.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
            proposalMatchMessage,
          };
        }

        if (!isValidPluginVersion(req.proto.version)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The version must be in the format v1, v2, etc.`,
            },
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
            proposalMatchMessage,
          };
        }
      }

      if (!req.proto.schema || !req.proto.mappings || !req.proto.lock) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `The schema, mappings, and lock are required for plugin and grpc subgraphs.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
          proposalMatchMessage,
        };
      }
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
          proto:
            subgraph.type === 'grpc_plugin'
              ? {
                  schema: req.proto?.schema || '',
                  mappings: req.proto?.mappings || '',
                  lock: req.proto?.lock || '',
                  pluginData: {
                    platforms: req.proto?.platforms || [],
                    version: req.proto?.version || '',
                  },
                }
              : subgraph.type === 'grpc_service'
                ? {
                    schema: req.proto?.schema || '',
                    mappings: req.proto?.mappings || '',
                    lock: req.proto?.lock || '',
                  }
                : undefined,
        },
        opts.blobStorage,
        {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        opts.chClient!,
        newCompositionOptions(req.disableResolvabilityValidation),
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

    // if this subgraph is part of a proposal, mark the proposal subgraph as published
    // and if all proposal subgraphs are published, update the proposal state to PUBLISHED
    if (matchedEntity) {
      const { allSubgraphsPublished } = await proposalRepo.markProposalSubgraphAsPublished({
        proposalSubgraphId: matchedEntity.proposalSubgraphId,
        proposalId: matchedEntity.proposalId,
      });
      if (allSubgraphsPublished) {
        const proposal = await proposalRepo.ById(matchedEntity.proposalId);
        if (proposal) {
          const federatedGraph = await fedGraphRepo.byId(proposal.proposal.federatedGraphId);
          if (federatedGraph) {
            orgWebhooks.send(
              {
                eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED,
                payload: {
                  federated_graph: {
                    id: federatedGraph.id,
                    name: federatedGraph.name,
                    namespace: federatedGraph.namespace,
                  },
                  organization: {
                    id: authContext.organizationId,
                    slug: authContext.organizationSlug,
                  },
                  proposal: {
                    id: proposal.proposal.id,
                    name: proposal.proposal.name,
                    namespace: req.namespace,
                    state: 'PUBLISHED',
                  },
                  actor_id: authContext.userId,
                },
              },
              authContext.userId,
            );
          }
        }
      }
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
        proposalMatchMessage,
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
        proposalMatchMessage,
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
      proposalMatchMessage,
    };
  });
}
