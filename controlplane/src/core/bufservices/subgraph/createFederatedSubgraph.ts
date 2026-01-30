import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateFederatedSubgraphRequest,
  CreateFederatedSubgraphResponse,
  SubgraphType,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  convertToSubgraphType,
  enrichLogger,
  formatSubgraphType,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getLogger,
  handleError,
  isValidGraphName,
  isValidGrpcNamingScheme,
  isValidLabels,
} from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { PluginRepository } from '../../repositories/PluginRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { DBSubgraphType } from '../../../db/models.js';

export function createFederatedSubgraph(
  opts: RouterOptions,
  req: CreateFederatedSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateFederatedSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateFederatedSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const pluginRepo = new PluginRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    req.namespace = req.namespace || DefaultNamespace;
    req.type = req.type || SubgraphType.STANDARD;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (!isValidLabels(req.labels)) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_LABELS,
          details: `One or more labels were found to be invalid`,
        },
        compositionErrors: [],
        admissionErrors: [],
      };
    }

    let baseSubgraphID = '';
    if (req.isFeatureSubgraph) {
      if (!req.baseSubgraphName) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `A feature subgraph requires a base subgraph.`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      const baseSubgraph = await subgraphRepo.byName(req.baseSubgraphName, req.namespace);
      if (!baseSubgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Base subgraph "${req.baseSubgraphName}" does not exist in the namespace "${req.namespace}".`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }

      if (baseSubgraph.isFeatureSubgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Base subgraph "${req.baseSubgraphName}" is a feature subgraph. Feature subgraphs cannot have feature subgraphs as their base.`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      baseSubgraphID = baseSubgraph.id;
      req.type = convertToSubgraphType(baseSubgraph.type);
    }

    /* Routing URL is now optional; if empty or undefined, set an empty string
     * The routing URL must be defined unless the subgraph is an Event-Driven Graph or a Plugin
     * */
    const routingUrl = req.routingUrl || '';
    if (req.isEventDrivenGraph) {
      if (req.routingUrl !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `An Event-Driven Graph must not define a routing URL`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      if (req.subscriptionUrl !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `An Event-Driven Graph must not define a subscription URL`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      if (req.subscriptionProtocol !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `An Event-Driven Graph must not define a subscription protocol`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      if (req.websocketSubprotocol !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `An Event-Driven Graph must not define a websocket subprotocol`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
    } else if (req.type !== SubgraphType.GRPC_PLUGIN) {
      if (!routingUrl) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `A non-Event-Driven Graph must define a routing URL`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      if (!isValidUrl(routingUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Routing URL "${routingUrl}" is not a valid URL`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      // For GRPC_SERVICE subgraphs, validate that routing URL follows gRPC naming scheme
      if (req.type === SubgraphType.GRPC_SERVICE && !isValidGrpcNamingScheme(routingUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details:
              `Routing URL must follow gRPC naming scheme. ` +
              `See https://grpc.io/docs/guides/custom-name-resolution/ for examples.`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
      if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Subscription URL "${req.subscriptionUrl}" is not a valid URL`,
          },
          compositionErrors: [],
          admissionErrors: [],
        };
      }
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        graphs: [],
      };
    }

    if (!authContext.rbac.canCreateSubGraph(namespace)) {
      throw new UnauthorizedError();
    }

    const existingSubgraph = await subgraphRepo.byName(req.name, req.namespace);
    if (existingSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details:
            `A ${existingSubgraph.isFeatureSubgraph ? 'feature ' : ''}subgraph with the name` +
            ` "${req.name}" already exists in the namespace "${req.namespace}".`,
        },
        compositionErrors: [],
        admissionErrors: [],
      };
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
        };
      }
    }

    const subgraph = await subgraphRepo.create({
      name: req.name,
      namespace: req.namespace,
      namespaceId: namespace.id,
      createdBy: authContext.userId,
      labels: req.labels,
      routingUrl,
      isEventDrivenGraph: req.isEventDrivenGraph || false,
      readme: req.readme,
      subscriptionUrl: req.subscriptionUrl,
      subscriptionProtocol:
        req.subscriptionProtocol === undefined ? undefined : formatSubscriptionProtocol(req.subscriptionProtocol),
      websocketSubprotocol:
        req.websocketSubprotocol === undefined ? undefined : formatWebsocketSubprotocol(req.websocketSubprotocol),
      featureSubgraphOptions: req.isFeatureSubgraph
        ? {
            isFeatureSubgraph: req.isFeatureSubgraph || false,
            baseSubgraphID,
          }
        : undefined,
      type: formatSubgraphType(req.type),
    });

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The ${req.isFeatureSubgraph ? 'feature' : ''} subgraph "${req.name}" could not be created.`,
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: req.isFeatureSubgraph ? 'feature_subgraph.created' : 'subgraph.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: req.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
      auditableDisplayName: subgraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
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
