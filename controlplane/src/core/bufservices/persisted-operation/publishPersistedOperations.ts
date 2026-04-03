import crypto from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import pLimit from 'p-limit';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PersistedOperation,
  PublishedOperation,
  PublishedOperationStatus,
  PublishPersistedOperationsRequest,
  PublishPersistedOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildASTSchema as graphQLBuildASTSchema, DocumentNode, GraphQLSchema, parse, validate } from 'graphql';
import { PublishedOperationData, UpdatedPersistedOperation } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { MAX_MANIFEST_OPERATIONS, OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, extractOperationNames, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { createBlobStoragePath } from './utils.js';

const MAX_PERSISTED_OPERATIONS = 100;
const PARALLEL_PERSISTED_OPERATIONS_LIMIT = 25;

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
    // Validate all operations against the base graph first.
    // Only fetch feature flag schemas if any operation fails base validation.
    const baseGraphSchema = graphQLBuildASTSchema(parse(schema.schema));

    // Track which schemas each operation is valid on (for manifest filtering).
    const operationValidity = new Map<string, { validOnBaseGraph: boolean; validOnFeatureFlagIds: string[] }>();

    const baseFailedOperations: { operation: (typeof req.operations)[number]; ast: DocumentNode; error: string }[] = [];

    for (const operation of req.operations) {
      let opAST: DocumentNode;
      try {
        opAST = parse(operation.contents);
      } catch (e: any) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Operation ${operation.id} (${operation.contents}) is not valid: ${e}`,
          },
          operations: [],
        };
      }

      const errors = validate(baseGraphSchema, opAST, undefined, { maxErrors: 1 });
      if (errors.length === 0) {
        operationValidity.set(operation.id, { validOnBaseGraph: true, validOnFeatureFlagIds: [] });
      } else {
        baseFailedOperations.push({
          operation,
          ast: opAST,
          error: errors.map((e) => e.toString()).join(', '),
        });
      }
    }

    // If all operations are valid on the base graph, skip FF schema lookup entirely.
    if (baseFailedOperations.length > 0 && schema.schemaVersionId) {
      const ffSchemas = await federatedGraphRepo.getFeatureFlagSchemaVersions({
        baseSchemaVersionId: schema.schemaVersionId,
      });

      const ffValidationSchemas: { name: string; id: string; schema: GraphQLSchema }[] = [];
      for (const ff of ffSchemas) {
        if (!ff.schemaSDL || !ff.featureFlagName || !ff.featureFlagId) {
          continue;
        }
        try {
          ffValidationSchemas.push({
            name: `feature flag "${ff.featureFlagName}"`,
            id: ff.featureFlagId,
            schema: graphQLBuildASTSchema(parse(ff.schemaSDL)),
          });
        } catch {
          // Skip FF schemas that fail to parse — don't block PO upload
        }
      }

      // Check each base-failed operation against FF schemas
      for (const { operation, ast, error: baseError } of baseFailedOperations) {
        const validFfIds: string[] = [];
        for (const s of ffValidationSchemas) {
          const errors = validate(s.schema, ast, undefined, { maxErrors: 1 });
          if (errors.length === 0) {
            validFfIds.push(s.id);
          }
        }

        if (validFfIds.length === 0) {
          const schemaNames = ['base graph', ...ffValidationSchemas.map((s) => s.name)].join(', ');
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Operation ${operation.id} ("${operation.contents}") is not valid on any schema (checked: ${schemaNames}): ${baseError}`,
            },
            operations: [],
          };
        }

        operationValidity.set(operation.id, { validOnBaseGraph: false, validOnFeatureFlagIds: validFfIds });
      }
    } else if (baseFailedOperations.length > 0) {
      // No FF schemas to check — report the base graph error
      const { operation, error } = baseFailedOperations[0];
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Operation ${operation.id} ("${operation.contents}") is not valid: ${error}`,
        },
        operations: [],
      };
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
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
    const existingHashes = new Set(allExistingOperations.map((op) => op.hash));
    const newOperationCount = req.operations.filter((op) => {
      const hash = crypto.createHash('sha256').update(op.contents).digest('hex');
      return !existingHashes.has(hash);
    }).length;

    if (allExistingOperations.length + newOperationCount > MAX_MANIFEST_OPERATIONS) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Operation limit exceeded: adding ${newOperationCount} new operations would bring the total to ${allExistingOperations.length + newOperationCount}, which exceeds the maximum of ${MAX_MANIFEST_OPERATIONS} operations per graph. Delete unused operations before publishing new ones.`,
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
      if (prev !== undefined && prev.hash !== operationHash) {
        // We're trying to update an operation with the same ID but different hash
        return {
          publishedOperation: new PublishedOperation({
            id: operationId,
            hash: prev.hash,
            status: PublishedOperationStatus.CONFLICT,
            operationNames: prev.operationNames,
          }),
          updatedOp: null,
          error: null,
        };
      }
      const operationNames = extractOperationNames(operation.contents);
      const clientName = encodeURIComponent(req.clientName);
      const path = createBlobStoragePath({
        organizationId,
        fedGraphId: federatedGraph.id,
        clientName,
        operationId,
      });
      const validity = operationValidity.get(operationId) ?? { validOnBaseGraph: true, validOnFeatureFlagIds: [] };
      const updatedOp: UpdatedPersistedOperation = {
        operationId,
        hash: operationHash,
        filePath: path,
        contents: operation.contents,
        operationNames,
        validOnBaseGraph: validity.validOnBaseGraph,
        validOnFeatureFlagIds: validity.validOnFeatureFlagIds,
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
          publishedOperation: new PublishedOperation({
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
        publishedOperation: new PublishedOperation({
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
    const results = await Promise.all(req.operations.map((op) => limit(() => processOperation(op))));

    const firstError = results.find((r) => r.error !== null);
    if (firstError?.error) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Could not store operation contents for ${firstError.error.operationId} at ${firstError.error.path}`,
        },
        operations: [],
      };
    }

    for (const r of results) {
      operations.push(r.publishedOperation!);
      if (r.updatedOp !== null) {
        updatedOperations.push(r.updatedOp);
      }
    }

    await operationsRepo.updatePersistedOperations(clientId, userId, updatedOperations);

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
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations,
    };
  });
}
