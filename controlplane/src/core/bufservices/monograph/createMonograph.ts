import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateMonographRequest,
  CreateMonographResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl, joinLabel } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  createRandomInternalLabel,
  enrichLogger,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getLogger,
  handleError,
  isValidGraphName,
} from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createMonograph(
  opts: RouterOptions,
  req: CreateMonographRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateMonographResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateMonographResponse>>(ctx, logger, async () => {
    return await opts.db.transaction(async (tx) => {
      req.namespace = req.namespace || DefaultNamespace;

      const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
      logger = enrichLogger(ctx, logger, authContext);

      const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);
      const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);

      if (authContext.organizationDeactivated) {
        throw new UnauthorizedError();
      }

      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Could not find namespace ${req.namespace}`,
          },
        };
      }

      // check whether the user is authorized to perform the action
      if (!authContext.rbac.canCreateFederatedGraph(namespace)) {
        throw new UnauthorizedError();
      }

      if (await fedGraphRepo.exists(req.name, req.namespace)) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `Graph '${req.name}' already exists in the namespace`,
          },
        };
      }

      if (await subgraphRepo.exists(req.name, req.namespace)) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `The subgraph ${req.name} being created for the monograph already exists in the namespace`,
          },
        };
      }

      if (!isValidUrl(req.routingUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Routing URL is not a valid URL`,
          },
        };
      }

      if (!isValidUrl(req.graphUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Graph URL is not a valid URL`,
          },
        };
      }

      if (!isValidGraphName(req.name)) {
        return {
          response: {
            code: EnumStatusCode.ERR_INVALID_NAME,
            details: `The name of the monograph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }

      const count = await fedGraphRepo.count();

      const feature = await orgRepo.getFeature({
        organizationId: authContext.organizationId,
        featureId: 'federated-graphs',
      });

      const limit = feature?.limit === -1 ? undefined : feature?.limit;

      if (limit && count >= limit) {
        return {
          response: {
            code: EnumStatusCode.ERR_LIMIT_REACHED,
            details: `The organization reached the limit of federated graphs and monographs`,
          },
        };
      }

      const label = createRandomInternalLabel();

      const labelMatchers = [joinLabel(label)];

      const subgraph = await subgraphRepo.create({
        name: req.name,
        namespace: req.namespace,
        namespaceId: namespace.id,
        createdBy: authContext.userId,
        labels: [label],
        routingUrl: req.graphUrl,
        isEventDrivenGraph: false,
        readme: req.readme,
        subscriptionUrl: req.subscriptionUrl,
        subscriptionProtocol:
          req.subscriptionProtocol === undefined ? undefined : formatSubscriptionProtocol(req.subscriptionProtocol),
        websocketSubprotocol:
          req.websocketSubprotocol === undefined ? undefined : formatWebsocketSubprotocol(req.websocketSubprotocol),
      });

      if (!subgraph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Could not create monograph`,
          },
        };
      }

      const graph = await fedGraphRepo.create({
        name: req.name,
        createdBy: authContext.userId,
        labelMatchers,
        routingUrl: req.routingUrl,
        readme: req.readme,
        namespace: req.namespace,
        namespaceId: namespace.id,
        admissionWebhookURL: req.admissionWebhookURL,
        admissionWebhookSecret: req.admissionWebhookSecret,
        supportsFederation: false,
      });

      if (!graph) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Could not create monograph`,
          },
        };
      }

      await fedGraphRepo.createGraphCryptoKeyPairs({
        federatedGraphId: graph.id,
        organizationId: authContext.organizationId,
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'monograph.created',
        action: 'created',
        actorId: authContext.userId,
        auditableType: 'monograph',
        auditableDisplayName: graph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: graph.namespaceId,
        targetNamespaceDisplayName: graph.namespace,
      });

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
