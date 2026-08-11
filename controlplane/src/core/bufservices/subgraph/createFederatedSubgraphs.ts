import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateFederatedSubgraphsRequest,
  CreateFederatedSubgraphsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
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
 * CreateFederatedSubgraphs creates multiple subgraphs in a single request. Every entry is validated before anything
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

    const requestedEntries = req.subgraphs;

    if (requestedEntries.length === 0) {
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
        createdSubgraphNames: [],
      };
    }

    // Validate every entry before writing any of them, so a bad entry never leaves a partially created batch behind.
    const labelErrors: string[] = [];
    const nameErrors: string[] = [];
    const configErrors: string[] = [];
    const items: Parameters<SubgraphRepository['create']>[0][] = [];

    for (const entry of requestedEntries) {
      if (!isValidLabels(entry.labels)) {
        labelErrors.push(`Subgraph "${entry.name}": one or more labels were found to be invalid`);
        continue;
      }

      if (!isValidGraphName(entry.name)) {
        nameErrors.push(
          `Subgraph "${entry.name}": the name is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.`,
        );
        continue;
      }

      const routingViolation = validateSubgraphRouting({
        isEventDrivenGraph: entry.isEventDrivenGraph || false,
        routingUrl: entry.routingUrl,
        subscriptionUrl: entry.subscriptionUrl,
        subscriptionProtocol: entry.subscriptionProtocol,
        websocketSubprotocol: entry.websocketSubprotocol,
        routingUrlRequirement: 'required',
      });

      if (routingViolation) {
        configErrors.push(`Subgraph "${entry.name}": ${routingViolation}`);
        continue;
      }

      items.push({
        name: entry.name,
        namespace: req.namespace,
        namespaceId: namespace.id,
        createdBy: authContext.userId,
        labels: entry.labels,
        routingUrl: entry.routingUrl || '',
        isEventDrivenGraph: entry.isEventDrivenGraph || false,
        readme: entry.readme,
        subscriptionUrl: entry.subscriptionUrl,
        subscriptionProtocol:
          entry.subscriptionProtocol === undefined ? undefined : formatSubscriptionProtocol(entry.subscriptionProtocol),
        websocketSubprotocol:
          entry.websocketSubprotocol === undefined ? undefined : formatWebsocketSubprotocol(entry.websocketSubprotocol),
        type: 'standard',
      });
    }

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
      requestedEntries.map((entry) => entry.name),
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
      const subgraphNames: string[] = [];

      for (const item of items) {
        const subgraph = await txSubgraphRepo.create(item);
        if (!subgraph) {
          throw new Error(`The subgraph "${item.name}" could not be created.`);
        }

        await txAuditLogRepo.addAuditLog({
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

        subgraphNames.push(subgraph.name);
      }

      return subgraphNames;
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      createdSubgraphNames: createdSubgraphs,
    };
  });
}
