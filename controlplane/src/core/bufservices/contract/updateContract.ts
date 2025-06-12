import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
  UpdateContractRequest,
  UpdateContractResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidSchemaTags } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateContract(
  opts: RouterOptions,
  req: UpdateContractRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateContractResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateContractResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    req.excludeTags = [...new Set(req.excludeTags)];
    req.includeTags = [...new Set(req.includeTags)];

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (req.includeTags.length > 0 && req.excludeTags.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            `The "exclude" and "include" options for tags are currently mutually exclusive.` +
            ` Both options have been provided, but one of the options must be empty or unset.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidSchemaTags(req.excludeTags)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Provided exclude tags are invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidSchemaTags(req.includeTags)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Provided include tags are invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const graph = await fedGraphRepo.byName(req.name, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find contract graph ${req.name} in namespace ${req.namespace}`,
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

    if (!graph.contract?.id) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The graph is not a contract`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const updatedContractDetails = await contractRepo.update({
      id: graph.contract.id,
      excludeTags: req.excludeTags,
      includeTags: req.includeTags,
      actorId: authContext.userId,
    });

    await fedGraphRepo.update({
      targetId: graph.targetId,
      // if the routingUrl is not provided, it will be set to an empty string.
      // As the routing url wont be updated in this case.
      routingUrl: req.routingUrl || '',
      updatedBy: authContext.userId,
      readme: req.readme,
      blobStorage: opts.blobStorage,
      namespaceId: graph.namespaceId,
      admissionWebhookURL: req.admissionWebhookUrl,
      admissionWebhookSecret: req.admissionWebhookSecret,
      admissionConfig: {
        cdnBaseUrl: opts.cdnBaseUrl,
        jwtSecret: opts.admissionWebhookJWTSecret,
      },
      labelMatchers: [],
      chClient: opts.chClient!,
    });

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    const composition = await fedGraphRepo.composeAndDeployGraphs({
      federatedGraphs: [
        {
          ...graph,
          routingUrl: req.routingUrl || graph.routingUrl,
          admissionWebhookURL: req.admissionWebhookUrl || graph.admissionWebhookURL,
          admissionWebhookSecret: req.admissionWebhookSecret || graph.admissionWebhookSecret,
          readme: req.readme || graph.readme,
          contract: {
            ...graph.contract,
            ...updatedContractDetails,
          },
        },
      ],
      actorId: authContext.userId,
      blobStorage: opts.blobStorage,
      admissionConfig: {
        cdnBaseUrl: opts.cdnBaseUrl,
        webhookJWTSecret: opts.admissionWebhookJWTSecret,
      },
      chClient: opts.chClient!,
    });

    compositionErrors.push(...composition.compositionErrors);
    deploymentErrors.push(...composition.deploymentErrors);
    compositionWarnings.push(...composition.compositionWarnings);

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'federated_graph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: graph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: graph.namespaceId,
      targetNamespaceDisplayName: graph.namespace,
    });

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
          errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
          actor_id: authContext.userId,
        },
      },
      authContext.userId,
    );

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
      deploymentErrors,
      compositionErrors,
      compositionWarnings,
    };
  });
}
