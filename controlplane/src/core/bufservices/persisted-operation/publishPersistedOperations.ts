import crypto from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PublishPersistedOperationsRequest,
  PublishPersistedOperationsResponse,
  PublishedOperation,
  PublishedOperationStatus,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DocumentNode, buildASTSchema as graphQLBuildASTSchema, parse, validate } from 'graphql';
import { PublishedOperationData, UpdatedPersistedOperation } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, extractOperationNames, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

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
    let clientId: string;
    try {
      clientId = await operationsRepo.registerClient(req.clientName, userId);
    } catch (e: any) {
      const message = e instanceof Error ? e.message : e.toString();
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Could not register client "${req.clientName}": ${message}`,
        },
        operations: [],
      };
    }
    const operations: PublishedOperation[] = [];
    const updatedOperations: UpdatedPersistedOperation[] = [];
    // Retrieve the operations that have already been published
    const operationsResult = await operationsRepo.getPersistedOperations(clientId);
    const operationsByOperationId = new Map(
      operationsResult.map((op) => [op.operationId, { hash: op.hash, operationNames: op.operationNames }]),
    );
    for (const operation of req.operations) {
      const operationId = operation.id;
      const operationHash = crypto.createHash('sha256').update(operation.contents).digest('hex');
      const prev = operationsByOperationId.get(operationId);
      if (prev !== undefined && prev.hash !== operationHash) {
        // We're trying to update an operation with the same ID but different hash
        operations.push(
          new PublishedOperation({
            id: operationId,
            hash: prev.hash,
            status: PublishedOperationStatus.CONFLICT,
            operationNames: prev.operationNames,
          }),
        );
        continue;
      }
      const operationNames = extractOperationNames(operation.contents);
      operationsByOperationId.set(operationId, { hash: operationHash, operationNames });
      const path = `${organizationId}/${federatedGraph.id}/operations/${req.clientName}/${operationId}.json`;
      updatedOperations.push({
        operationId,
        hash: operationHash,
        filePath: path,
        contents: operation.contents,
        operationNames,
      });

      // New operation
      let status: PublishedOperationStatus;
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
            response: {
              code: EnumStatusCode.ERR,
              details: `Could not store operation contents for ${operationId} at ${path}`,
            },
            operations: [],
          };
        }

        status = PublishedOperationStatus.CREATED;
      } else {
        status = PublishedOperationStatus.UP_TO_DATE;
      }
      operations.push(
        new PublishedOperation({
          id: operationId,
          hash: operationHash,
          status,
          operationNames,
        }),
      );
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
