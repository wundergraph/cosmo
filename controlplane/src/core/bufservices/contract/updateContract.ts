import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
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

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesn't have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    if (req.includeTags.length > 0 && req.excludeTags.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'The "excludeTags" and "includeTags" options are currently mutually exclusive. Both options have been provided, but one of the options must be empty or unset.',
        },
        compositionErrors: [],
        deploymentErrors: [],
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
      };
    }

    if (!graph.contract?.id) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The graph is not a contract`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    const updatedContractDetails = await contractRepo.update({
      id: graph.contract.id,
      excludeTags: req.excludeTags,
      includeTags: req.includeTags,
      actorId: authContext.userId,
    });

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];

    const composition = await fedGraphRepo.composeAndDeployGraphs({
      federatedGraphs: [
        {
          ...graph,
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
    });

    compositionErrors.push(...composition.compositionErrors);
    deploymentErrors.push(...composition.deploymentErrors);

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'federated_graph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: graph.name,
      actorDisplayName: authContext.userDisplayName,
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
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        compositionErrors: [],
        deploymentErrors,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      deploymentErrors,
      compositionErrors,
    };
  });
}
