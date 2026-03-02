import crypto from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import pLimit from 'p-limit';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PublishedOperation,
  PublishedOperationStatus,
  PublishPersistedOperationsRequest,
  PublishPersistedOperationsResponse,
  PersistedOperation,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildASTSchema as graphQLBuildASTSchema, DocumentNode, parse, validate } from 'graphql';
import { PublishedOperationData, UpdatedPersistedOperation } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
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

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const clientId = await operationsRepo.registerClient(req.clientName, userId);

    const operations: PublishedOperation[] = [];
    const updatedOperations: UpdatedPersistedOperation[] = [];
    // Retrieve the operations that have already been published
    const operationsResult = await operationsRepo.getPersistedOperations(clientId);
    const operationsByOperationId = new Map(
      operationsResult.map((op) => [op.operationId, { hash: op.hash, operationNames: op.operationNames }]),
    );

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

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations,
    };
  });
}
