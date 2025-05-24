import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  SetGraphRouterCompatibilityVersionRequest,
  SetGraphRouterCompatibilityVersionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ROUTER_COMPATIBILITY_VERSIONS, SupportedRouterCompatibilityVersion } from '@wundergraph/composition';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function setGraphRouterCompatibilityVersion(
  opts: RouterOptions,
  req: SetGraphRouterCompatibilityVersionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<SetGraphRouterCompatibilityVersionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<SetGraphRouterCompatibilityVersionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Graph "${req.name}" in namespace "${req.namespace}" not found.`,
        },
        previousVersion: '-1',
        newVersion: '-1',
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      };
    }

    const version = req.version as SupportedRouterCompatibilityVersion;
    if (!ROUTER_COMPATIBILITY_VERSIONS.has(version)) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: `Invalid router compatibility version "${req.version}".`,
        },
        previousVersion: federatedGraph.routerCompatibilityVersion,
        newVersion: federatedGraph.routerCompatibilityVersion,
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: federatedGraph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    if (federatedGraph.routerCompatibilityVersion === version) {
      return {
        response: {
          code: EnumStatusCode.OK,
          details: `The router compatibility version is already set to "${req.version}".`,
        },
        previousVersion: federatedGraph.routerCompatibilityVersion,
        newVersion: version,
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      };
    }

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: true,
    });

    // If there are no subgraphs, we don't need to compose anything
    // and avoid producing a version with a composition error
    if (subgraphs.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
          details: `The router compatibility version was set to "${req.version}" successfully.`,
        },
        previousVersion: federatedGraph.routerCompatibilityVersion,
        newVersion: version,
        compositionErrors: [],
        compositionWarnings: [],
        deploymentErrors: [],
      };
    }

    await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);

      await fedGraphRepo.updateRouterCompatibilityVersion(federatedGraph.id, version);

      const auditLogRepo = new AuditLogRepository(opts.db);

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: `${federatedGraph.supportsFederation ? 'federated_graph' : 'monograph'}.updated`,
        action: 'updated',
        actorId: authContext.userId,
        auditableType: `${federatedGraph.supportsFederation ? 'federated_graph' : 'monograph'}`,
        auditableDisplayName: federatedGraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: federatedGraph.namespaceId,
        targetNamespaceDisplayName: federatedGraph.namespace,
      });

      const composition = await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs: [federatedGraph],
        actorId: authContext.userId,
        blobStorage: opts.blobStorage,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        chClient: opts.chClient!,
      });

      if (composition.compositionErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
          },
          previousVersion: federatedGraph.routerCompatibilityVersion,
          newVersion: federatedGraph.routerCompatibilityVersion,
          compositionErrors: composition.compositionErrors,
          compositionWarnings: composition.compositionWarnings,
          deploymentErrors: composition.deploymentErrors,
        };
      }

      if (composition.deploymentErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
          },
          previousVersion: federatedGraph.routerCompatibilityVersion,
          newVersion: federatedGraph.routerCompatibilityVersion,
          compositionErrors: composition.compositionErrors,
          compositionWarnings: composition.compositionWarnings,
          deploymentErrors: composition.deploymentErrors,
        };
      }
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      previousVersion: federatedGraph.routerCompatibilityVersion,
      newVersion: version,
      compositionErrors: [],
      compositionWarnings: [],
      deploymentErrors: [],
    };
  });
}
