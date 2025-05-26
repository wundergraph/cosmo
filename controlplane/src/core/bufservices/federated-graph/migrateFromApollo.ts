import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName, PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  MigrateFromApolloRequest,
  MigrateFromApolloResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphApiKeyJwtPayload } from '../../../types/index.js';
import { audiences, signJwtHS256 } from '../../crypto/jwt.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import ApolloMigrator from '../../services/ApolloMigrator.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function migrateFromApollo(
  opts: RouterOptions,
  req: MigrateFromApolloRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<MigrateFromApolloResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<MigrateFromApolloResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const userRepo = new UserRepository(logger, opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );
    const auditLogRepo = new AuditLogRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    opts.platformWebhooks.send(PlatformEventName.APOLLO_MIGRATE_INIT, {
      actor_id: authContext.userId,
    });

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        token: '',
      };
    }

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
        token: '',
      };
    }

    const user = await userRepo.byId(authContext.userId || '');

    const apolloMigrator = new ApolloMigrator({
      apiKey: req.apiKey,
      organizationSlug: org.slug,
      variantName: req.variantName,
      logger,
      userEmail: user?.email || '',
      userId: user?.id || '',
    });

    const graph = await apolloMigrator.fetchGraphID();
    if (!graph.success) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Could not fetch the graph from Apollo. Please ensure that the API Key is valid.`,
        },
        token: '',
      };
    }

    const graphDetails = await apolloMigrator.fetchGraphDetails({ graphID: graph.id });

    if (!graphDetails.success) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: graphDetails.errorMessage,
        },
        token: '',
      };
    }

    if (await fedGraphRepo.exists(graph.name, req.namespace)) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Federated graph '${graph.name}' already exists.`,
        },
        token: '',
      };
    }

    for await (const subgraph of graphDetails.subgraphs) {
      if (await subgraphRepo.exists(subgraph.name, req.namespace)) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `Subgraph '${subgraph.name}' already exists`,
          },
          token: '',
        };
      }
    }

    await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);

      const federatedGraph = await apolloMigrator.migrateGraphFromApollo({
        fedGraph: {
          name: graph.name,
          routingURL: graphDetails.fedGraphRoutingURL || '',
        },
        subgraphs: graphDetails.subgraphs,
        organizationID: authContext.organizationId,
        db: tx,
        creatorUserId: authContext.userId,
        namespace: req.namespace,
        namespaceId: namespace.id,
      });

      await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs: [federatedGraph],
        actorId: authContext.userId,
        blobStorage: opts.blobStorage,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        chClient: opts.chClient!,
      });
    });

    const migratedGraph = await fedGraphRepo.byName(graph.name, req.namespace);
    if (!migratedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not complete the migration. Please try again.',
        },
        token: '',
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'federated_graph.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: migratedGraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: migratedGraph.namespaceId,
      targetNamespaceDisplayName: migratedGraph.namespace,
    });

    const subgraphs = await subgraphRepo.byGraphLabelMatchers({
      labelMatchers: migratedGraph.labelMatchers,
      namespaceId: migratedGraph.namespaceId,
    });
    for (const subgraph of subgraphs) {
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

    orgWebhooks.send(
      {
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        payload: {
          federated_graph: {
            id: migratedGraph.id,
            name: migratedGraph.name,
            namespace: migratedGraph.namespace,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: false,
          actor_id: authContext.userId,
        },
      },
      authContext.userId,
    );

    const tokenValue = await signJwtHS256<GraphApiKeyJwtPayload>({
      secret: opts.jwtSecret,
      token: {
        iss: authContext.userId,
        federated_graph_id: migratedGraph.id,
        aud: audiences.cosmoGraphKey, // to distinguish from other tokens
        organization_id: authContext.organizationId,
      },
    });

    const token = await fedGraphRepo.createToken({
      token: tokenValue,
      federatedGraphId: migratedGraph.id,
      tokenName: migratedGraph.name,
      organizationId: authContext.organizationId,
      createdBy: authContext.userId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_token.created',
      action: 'created',
      actorId: authContext.userId,
      targetId: migratedGraph.id,
      targetDisplayName: migratedGraph.name,
      targetType: 'federated_graph',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      auditableDisplayName: token.name,
      auditableType: 'graph_token',
      targetNamespaceId: migratedGraph.namespaceId,
      targetNamespaceDisplayName: migratedGraph.namespace,
    });

    opts.platformWebhooks.send(PlatformEventName.APOLLO_MIGRATE_SUCCESS, {
      federated_graph: {
        id: migratedGraph.id,
        name: migratedGraph.name,
      },
      actor_id: authContext.userId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      token: token.token,
    };
  });
}
