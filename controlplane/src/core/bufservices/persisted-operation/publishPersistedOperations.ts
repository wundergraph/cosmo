import crypto from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import pLimit from 'p-limit';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

import {
  PublishedOperationSchema,
  PublishedOperationStatus,
  PublishPersistedOperationsRequest,
  PublishPersistedOperationsResponse,
  PersistedOperation,
  type PublishedOperation,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

import { buildASTSchema as graphQLBuildASTSchema, DocumentNode, parse, validate } from 'graphql';
import { PlainMessage, PublishedOperationData, UpdatedPersistedOperation } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, extractOperationNames, getLogger, handleError } from '../../util.js';
import { PublicError, UnauthorizedError } from '../../errors/errors.js';
import { createBlobStoragePath } from './utils.js';

const MAX_PERSISTED_OPERATIONS = 100;
const PARALLEL_PERSISTED_OPERATIONS_LIMIT = 25;
// Fallback used when no `persisted-operations` limit is configured for the organization's plan.
const DEFAULT_MAX_MANIFEST_OPERATIONS = 3000;

export function publishPersistedOperations(
  opts: RouterOptions,
  req: PublishPersistedOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PublishPersistedOperationsResponse>> {
  /**
   * Receives a federated graph name and a list of persisted operation contents.
   * First, it validates that the graph exists and all the operations are valid,
   * then it stores them. Additionally, if the provided client name for registering
   * the operations has never been seen before, we create an entry in the database
   * with it.
   */
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PublishPersistedOperationsResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    if (req.operations.length > MAX_PERSISTED_OPERATIONS) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Payload Too Large: max ${MAX_PERSISTED_OPERATIONS} operations per request`,
        },
        operations: [],
      };
    }

    for (const operation of req.operations) {
      if (operation.id.length < 1 || operation.id.length > 250 || /[^A-Za-z0-9_-]/.test(operation.id)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Operation ID must contain 1–250 ASCII letters, digits, underscores, or hyphens',
          },
          operations: [],
        };
      }
    }

    const userId = authContext.userId;
    if (!userId) {
      return {
        response: {
          code: EnumStatusCode.ERROR_NOT_AUTHENTICATED,
          details: `User not found in the authentication context`,
        },
        operations: [],
      };
    }

    req.clientName = req.clientName ? req.clientName.trim() : '';

    if (!req.clientName) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Client name is required`,
        },
        operations: [],
      };
    }

    // Validate client name. Min length is 3 and max length is 255.
    if (req.clientName.length < 3 || req.clientName.length > 255) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Client name must be between 3 and 255 characters`,
        },
        operations: [],
      };
    }

    const organizationId = authContext.organizationId;
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, organizationId);

    // Validate everything before we update any data
    const federatedGraph = await federatedGraphRepo.byName(req.fedGraphName, req.namespace);
    if (federatedGraph === undefined) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        operations: [],
      };
    }

    const schema = await federatedGraphRepo.getLatestValidSchemaVersion({
      targetId: federatedGraph.targetId,
    });
    if (!schema?.schema) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Schema for '${req.fedGraphName}' does not exist`,
        },
        operations: [],
      };
    }
    const graphAST = parse(schema.schema);
    const graphSchema = graphQLBuildASTSchema(graphAST);
    for (const operation of req.operations) {
      const contents = operation.contents;
      let opAST: DocumentNode;
      try {
        opAST = parse(operation.contents);
      } catch (e: any) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Operation ${operation.id} (${contents}) is not valid: ${e}`,
          },
          operations: [],
        };
      }
      const errors = validate(graphSchema, opAST, undefined, { maxErrors: 1 });
      if (errors.length > 0) {
        const errorDetails = errors.map((e) => `${e.toString()}`).join(', ');
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Operation ${operation.id} ("${contents}") is not valid: ${errorDetails}`,
          },
          operations: [],
        };
      }
    }

    return opts.db.transaction(async (tx) => {
      const operationsRepo = new OperationsRepository(tx as typeof opts.db, federatedGraph.id);
      if (!(await operationsRepo.lockPersistedOperations())) {
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Federated graph '${req.fedGraphName}' does not exist`);
      }
      const clientId = await operationsRepo.registerClient(req.clientName, userId);

      const operations: PublishedOperation[] = [];
      const updatedOperations: UpdatedPersistedOperation[] = [];
      // Retrieve the operations that have already been published
      const operationsResult = await operationsRepo.getPersistedOperations(clientId);
      const operationsByOperationId = new Map(
        operationsResult.map((op) => [op.operationId, { hash: op.hash, operationNames: op.operationNames }]),
      );

      // Check if adding new operations would exceed the manifest limit
      const allExistingOperations = await operationsRepo.getAllPersistedOperationsForGraph();
      // Include legacy registrations without stored contents in conflict checks.
      const graphIdentities = await operationsRepo.getPersistedOperationIdentitiesForGraph();
      const identitiesById = new Map<string, Array<{ hash: string; operationNames: string[] }>>();
      for (const op of graphIdentities) {
        const identities = identitiesById.get(op.operationId) ?? [];
        identities.push({ hash: op.hash, operationNames: op.operationNames ?? [] });
        identitiesById.set(op.operationId, identities);
      }
      const existingHashes = new Set(allExistingOperations.map((op) => op.hash));
      const newOperationCount = req.operations.filter((op) => {
        const hash = crypto.createHash('sha256').update(op.contents).digest('hex');
        return !existingHashes.has(hash);
      }).length;

      const orgRepo = new OrganizationRepository(logger, tx as typeof opts.db, opts.billingDefaultPlanId);
      const operationsFeature = await orgRepo.getFeature({
        organizationId,
        featureId: 'persisted-operations',
      });
      const maxManifestOperations = operationsFeature?.limit ?? DEFAULT_MAX_MANIFEST_OPERATIONS;

      if (allExistingOperations.length + newOperationCount > maxManifestOperations) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Operation limit exceeded: adding ${newOperationCount} new operations would bring the total to ${allExistingOperations.length + newOperationCount}, which exceeds the maximum of ${maxManifestOperations} operations per graph`,
          },
          operations: [],
        };
      }

      const processOperation = async (
        operation: PersistedOperation,
      ): Promise<{
        publishedOperation: PublishedOperation | null;
        updatedOp: UpdatedPersistedOperation | null;
        error: { operationId: string; path: string } | null;
      }> => {
        const operationId = operation.id;
        const operationHash = crypto.createHash('sha256').update(operation.contents).digest('hex');
        const prev = operationsByOperationId.get(operationId);
        const conflict = identitiesById.get(operationId)?.find((op) => op.hash !== operationHash);
        if (conflict) {
          // Operation IDs identify one body across all clients in the graph.
          return {
            publishedOperation: create(PublishedOperationSchema, {
              id: operationId,
              hash: conflict.hash,
              status: PublishedOperationStatus.CONFLICT,
              operationNames: conflict.operationNames,
            }),
            updatedOp: null,
            error: null,
          };
        }
        const operationNames = extractOperationNames(operation.contents);
        // Reserve before the first await, so conflicting entries in this batch
        // cannot race each other through the parallel upload workers.
        identitiesById.set(operationId, [{ hash: operationHash, operationNames }]);
        const clientName = encodeURIComponent(req.clientName);
        const path = createBlobStoragePath({
          organizationId,
          fedGraphId: federatedGraph.id,
          clientName,
          operationId,
        });
        const updatedOp: UpdatedPersistedOperation = {
          operationId,
          hash: operationHash,
          filePath: path,
          contents: operation.contents,
          operationNames,
        };

        if (prev === undefined) {
          const data: PublishedOperationData = {
            version: 1,
            body: operation.contents,
          };
          // Deprecated: Uploading individual operations to blob storage is deprecated.
          // The router now downloads all operations at once via the PQL manifest, avoiding
          // per-request CDN latency. This upload is kept for backward compatibility with older routers.
          try {
            await opts.blobStorage.putObject({
              key: path,
              body: Buffer.from(JSON.stringify(data), 'utf8'),
              contentType: 'application/json; charset=utf-8',
            });
          } catch (e) {
            logger.error(e, `Could not store operation contents for ${operationId} at ${path}`);
            return {
              publishedOperation: null,
              updatedOp: null,
              error: { operationId, path },
            };
          }
          return {
            publishedOperation: create(PublishedOperationSchema, {
              id: operationId,
              hash: operationHash,
              status: PublishedOperationStatus.CREATED,
              operationNames,
            }),
            updatedOp,
            error: null,
          };
        }

        return {
          publishedOperation: create(PublishedOperationSchema, {
            id: operationId,
            hash: operationHash,
            status: PublishedOperationStatus.UP_TO_DATE,
            operationNames,
          }),
          updatedOp,
          error: null,
        };
      };

      const limit = pLimit(PARALLEL_PERSISTED_OPERATIONS_LIMIT);
      // Keep the graph lock until every started upload has settled, even on failure.
      const settled = await Promise.allSettled(req.operations.map((op) => limit(() => processOperation(op))));
      const results = settled.map((result) => {
        if (result.status === 'rejected') {
          logger.error(result.reason, 'Failed to process persisted operation');
          throw new PublicError(EnumStatusCode.ERR, 'Failed to process persisted operation');
        }
        return result.value;
      });

      const firstError = results.find((r) => r.error !== null);
      if (firstError?.error) {
        throw new PublicError(
          EnumStatusCode.ERR,
          `Could not store operation contents for ${firstError.error.operationId} at ${firstError.error.path}`,
        );
      }

      for (const r of results) {
        operations.push(r.publishedOperation!);
        if (r.updatedOp !== null) {
          updatedOperations.push(r.updatedOp);
        }
      }

      // Identical duplicates in a batch share one database registration.
      const uniqueUpdates = [...new Map(updatedOperations.map((op) => [op.operationId, op])).values()];
      await operationsRepo.updatePersistedOperations(clientId, userId, uniqueUpdates);

      try {
        await operationsRepo.generateAndUploadManifest({
          organizationId,
          blobStorage: opts.blobStorage,
          logger,
        });
      } catch (e) {
        const error = e instanceof Error ? e : new Error('Unknown error');
        logger.error(error, 'Failed to regenerate PQL manifest after publishing persisted operations', {
          federatedGraphId: federatedGraph.id,
          organizationId,
        });
        throw new PublicError(EnumStatusCode.ERR, 'Failed to publish persisted operations manifest', error);
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        operations,
      };
    });
  });
}
