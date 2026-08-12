import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateFederatedSubgraphsRequest,
  CreateFederatedSubgraphsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { type AddAuditLogInput, AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
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
  validateSubgraphRouting,
} from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';

/**
 * CreateFederatedSubgraphs creates multiple subgraphs in a single request. Every subgraph is validated before anything
 * is written, and the writes share one transaction, so the request either creates all of the subgraphs or none of
 * them. Creating a subgraph does not trigger a composition (a subgraph has no schema until it is published), so this
 * is purely a batched write; publish the schemas afterwards with PublishFederatedSubgraphs.
 */
export function createFederatedSubgraphs(
  opts: RouterOptions,
  req: CreateFederatedSubgraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateFederatedSubgraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateFederatedSubgraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

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
        createdSubgraphNames: [],
      };
    }

    if (!authContext.rbac.canCreateSubGraph(namespace)) {
      throw new UnauthorizedError();
    }

    const requestedSubgraphs = req.subgraphs;

    if (requestedSubgraphs.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `At least one subgraph must be provided.`,
        },
        createdSubgraphNames: [],
      };
    }

    // Reject duplicate names within the request to avoid ambiguous, non-deterministic writes.
    const seenNames = new Set<string>();
    const duplicateNames = new Set<string>();
    for (const subgraph of requestedSubgraphs) {
      if (seenNames.has(subgraph.name)) {
        duplicateNames.add(subgraph.name);
      }
      seenNames.add(subgraph.name);
    }
    if (duplicateNames.size > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The following subgraphs were provided more than once: ${[...duplicateNames].join(', ')}`,
        },
        createdSubgraphNames: [],
      };
    }

    // Validate every subgraph before writing any of them, so a bad one never leaves a partially created batch behind.
    type ValidatedSubgraph = {
      labelError?: string;
      nameError?: string;
      configError?: string;
      subgraphToCreate?: Parameters<SubgraphRepository['create']>[0][number];
    };

    const validatedSubgraphs = requestedSubgraphs.map((subgraph): ValidatedSubgraph => {
      if (!isValidLabels(subgraph.labels)) {
        return { labelError: `Subgraph "${subgraph.name}": one or more labels were found to be invalid` };
      }

      if (!isValidGraphName(subgraph.name)) {
        return {
          nameError: `Subgraph "${subgraph.name}": the name is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
        };
      }

      const routingViolation = validateSubgraphRouting({
        isEventDrivenGraph: subgraph.isEventDrivenGraph || false,
        routingUrl: subgraph.routingUrl,
        subscriptionUrl: subgraph.subscriptionUrl,
        subscriptionProtocol: subgraph.subscriptionProtocol,
        websocketSubprotocol: subgraph.websocketSubprotocol,
        routingUrlRequirement: 'required',
      });

      if (routingViolation) {
        return { configError: `Subgraph "${subgraph.name}": ${routingViolation}` };
      }

      return {
        subgraphToCreate: {
          name: subgraph.name,
          namespace: req.namespace,
          namespaceId: namespace.id,
          createdBy: authContext.userId,
          labels: subgraph.labels,
          routingUrl: subgraph.routingUrl || '',
          isEventDrivenGraph: subgraph.isEventDrivenGraph || false,
          readme: subgraph.readme,
          subscriptionUrl: subgraph.subscriptionUrl,
          subscriptionProtocol:
            subgraph.subscriptionProtocol === undefined
              ? undefined
              : formatSubscriptionProtocol(subgraph.subscriptionProtocol),
          websocketSubprotocol:
            subgraph.websocketSubprotocol === undefined
              ? undefined
              : formatWebsocketSubprotocol(subgraph.websocketSubprotocol),
          type: 'standard',
        },
      };
    });

    const labelErrors = validatedSubgraphs.flatMap((validated) => validated.labelError ?? []);
    const nameErrors = validatedSubgraphs.flatMap((validated) => validated.nameError ?? []);
    const configErrors = validatedSubgraphs.flatMap((validated) => validated.configError ?? []);
    const subgraphsToCreate = validatedSubgraphs.flatMap((validated) => validated.subgraphToCreate ?? []);

    if (labelErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_LABELS,
          details: labelErrors.join('\n'),
        },
        createdSubgraphNames: [],
      };
    }

    if (nameErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_NAME,
          details: nameErrors.join('\n'),
        },
        createdSubgraphNames: [],
      };
    }

    if (configErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: configErrors.join('\n'),
        },
        createdSubgraphNames: [],
      };
    }

    const existingSubgraphs = await subgraphRepo.getSubgraphsByNames(
      requestedSubgraphs.map((subgraph) => subgraph.name),
      namespace.id,
    );

    if (existingSubgraphs.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details:
            `The following subgraphs already exist in the namespace "${req.namespace}": ` +
            `${existingSubgraphs.map((subgraph) => subgraph.name).join(', ')}`,
        },
        createdSubgraphNames: [],
      };
    }

    const createdSubgraphs = await opts.db.transaction(async (tx) => {
      const txSubgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const txAuditLogRepo = new AuditLogRepository(tx);

      const subgraphs = await txSubgraphRepo.create(subgraphsToCreate);

      await txAuditLogRepo.addAuditLog(
        ...subgraphs.map(
          (subgraph): AddAuditLogInput => ({
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
          }),
        ),
      );

      return subgraphs;
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      createdSubgraphNames: createdSubgraphs.map((subgraph) => subgraph.name),
    };
  });
}
