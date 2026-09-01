import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { type AxiosInstance, create as createHttpClient } from 'axios';
import axiosRetry, { exponentialDelay, isNetworkError, isRetryableError } from 'axios-retry';
import {
  type GenerateQueryResponse,
  GenerateQueryResponseSchema,
  SatisfiedOperationType,
} from '@wundergraph/cosmo-connect/dist/ai/v1/ai_pb';
import { create } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import * as z from 'zod';
import { traced } from '../tracing.js';
import * as schema from '../../db/schema.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { retryWithBackoff } from '../util/timers.js';

const validationSchema = z.object({
  version: z.string().uuid(),
  prompt: z.string().trim().min(1),
});

const indexResponseSchema = z.object({
  index: z.object({
    indexId: z.string().trim().min(1),
    status: z.enum(['INDEX_STATUS_INDEXING', 'INDEX_STATUS_READY', 'INDEX_STATUS_FAILED']),
    lastError: z.string().optional(),
  }),
});

const ptqQuerySchema = z.object({
  description: z.string().optional(),
  document: z.string().min(1),
  operationName: z.string().min(1),
  operationType: z.enum(['OPERATION_TYPE_QUERY', 'OPERATION_TYPE_MUTATION', 'OPERATION_TYPE_SUBSCRIPTION']),
  variablesSchema: z.string().optional(),
});

const ptqUnsatisfiedSchema = z.object({ reason: z.string() });

const ptqResponseSchema = z.object({
  query: ptqQuerySchema.optional(),
  unsatisfied: z.array(ptqUnsatisfiedSchema).optional(),
});

type PtQResponse = z.infer<typeof ptqResponseSchema>;
type IndexStatusResponse = z.infer<typeof indexResponseSchema>['index'];

class IndexStatusIndexingError extends Error {
  constructor(index: IndexStatusResponse) {
    super(`Prompt to Query index generation failed${index.lastError ? `: ${index.lastError}` : ''}`);
  }
}

class UnableToParseIndexStatusError extends Error {
  constructor() {
    super('It was not possible to parse the response returned by the Prompt to Query index service');
  }
}

@traced
export class PromptToQueryService {
  readonly #httpClient: AxiosInstance;

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private logger: FastifyBaseLogger,
    private serviceAddress: string | undefined,
    private organizationId: string,
    private defaultBillingPlanId: string | undefined,
  ) {
    this.#httpClient = createHttpClient({
      baseURL: serviceAddress,
      decompress: true,
      timeout: 60_000,
    });

    axiosRetry(this.#httpClient, {
      retries: 3,
      retryCondition: (err) => isNetworkError(err) || isRetryableError(err),
      retryDelay: (retryCount, error) => {
        return exponentialDelay(retryCount, error, 1000);
      },
      shouldResetTimeout: true,
    });
  }

  async generateQuery(
    federatedGraphId: string,
    version: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<GenerateQueryResponse> {
    if (!this.serviceAddress) {
      // The feature doesn't seem to be configured correctly
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR,
          details: 'The Prompt to Query service have not been configured',
        },
      });
    }

    // Ensure that the provided parameters are valid
    const parsed = validationSchema.safeParse({ version, prompt });
    if (!parsed.success) {
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
        },
      });
    }

    // Ensure that the feature has been enabled for the organization
    const orgRepo = new OrganizationRepository(this.logger, this.db, this.defaultBillingPlanId);
    const ptqFeature = await orgRepo.getFeature({ organizationId: this.organizationId, featureId: 'prompt-to-query' });
    if (!ptqFeature?.enabled) {
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: 'Prompt to Query not available with your current plan',
        },
      });
    }

    const federatedGraphRepository = new FederatedGraphRepository(this.logger, this.db, this.organizationId);
    const federatedGraph = await federatedGraphRepository.byId(federatedGraphId);
    if (!federatedGraph) {
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Federated graph not found',
        },
      });
    }

    const schemaVersion = await federatedGraphRepository.getSdlBasedOnSchemaVersion({
      targetId: federatedGraph.targetId,
      schemaVersionId: parsed.data.version,
    });
    if (!schemaVersion?.sdl) {
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Schema version not found for this federated graph',
        },
      });
    }

    // Invoke the `prompt to query` service
    try {
      const indexId = await this.ensureIndex(schemaVersion.sdl, signal);
      const response = await this.#httpClient('/yoko.v1.YokoService/PromptToQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          indexId,
          prompt: parsed.data.prompt,
        }),
        signal,
      });

      const parsedResponse = ptqResponseSchema.safeParse(response.data);
      return parsedResponse.success
        ? PromptToQueryService.handleServiceResponse(parsedResponse.data)
        : create(GenerateQueryResponseSchema, {
            response: {
              code: EnumStatusCode.ERR,
              details: 'It was not possible to parse the response returned by the Prompt to Query service',
            },
          });
    } catch (e) {
      this.logger.error(e, 'Failed to execute Prompt to Query due an unexpected error');
    }

    // Catchall
    return create(GenerateQueryResponseSchema, {
      response: {
        code: EnumStatusCode.ERR,
        details: 'Failed to generate query from the provided prompt',
      },
    });
  }

  async indexSchema(schema: string | undefined) {
    if (!this.serviceAddress) {
      // The feature doesn't seem to be configured correctly
      return;
    }

    // Ensure that the feature has been enabled for the organization
    const orgRepo = new OrganizationRepository(this.logger, this.db, this.defaultBillingPlanId);
    const ptqFeature = await orgRepo.getFeature({ organizationId: this.organizationId, featureId: 'prompt-to-query' });
    if (!ptqFeature?.enabled || !schema) {
      return;
    }

    // Fire and forget the schema indexation
    this.#httpClient('/yoko.v1.YokoService/EnsureIndex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ sdl: schema }),
    }).catch((e) => this.logger.error(e, 'Failed to index schema due an unexpected error'));
  }

  private async ensureIndex(schemaSDL: string, signal?: AbortSignal): Promise<string> {
    const response = await this.#httpClient('/yoko.v1.YokoService/EnsureIndex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ sdl: schemaSDL }),
      signal,
    });

    let index = PromptToQueryService.parseIndexResponse(response.data);
    if (index.status === 'INDEX_STATUS_INDEXING') {
      // Re-fetch the index status every second, if after 180 attempts (roughly 3 minutes) the indexing is still in
      // progress, instead of waiting indefinitely, we'll just bail and let the client decide if they want to attempt
      // the request again.
      // We do it this way to prevent process hogging
      index = await retryWithBackoff<IndexStatusResponse>(
        async (abortSignal) => {
          const response = await this.#httpClient('/yoko.v1.YokoService/EnsureIndex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ sdl: schemaSDL }),
            signal: abortSignal,
          });

          const result = PromptToQueryService.parseIndexResponse(response.data);
          if (result?.status === 'INDEX_STATUS_INDEXING') {
            throw new IndexStatusIndexingError(index);
          }

          return result;
        },
        {
          attempts: 180,
          baseInterval: 1000,
          maxInterval: 1000,
          jitter: true,
          signal,
          shouldRetry: (err) => err instanceof IndexStatusIndexingError || err instanceof UnableToParseIndexStatusError,
        },
      );
    }

    return index.indexId;
  }

  private static parseIndexResponse(response: unknown): IndexStatusResponse {
    const parsed = indexResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new UnableToParseIndexStatusError();
    }

    return parsed.data.index;
  }

  private static getOperationType(type: z.infer<typeof ptqQuerySchema>['operationType']): SatisfiedOperationType {
    switch (type) {
      case 'OPERATION_TYPE_QUERY': {
        return SatisfiedOperationType.QUERY;
      }
      case 'OPERATION_TYPE_MUTATION': {
        return SatisfiedOperationType.MUTATION;
      }
      case 'OPERATION_TYPE_SUBSCRIPTION': {
        return SatisfiedOperationType.SUBSCRIPTION;
      }
    }

    return SatisfiedOperationType.QUERY;
  }

  private static handleServiceResponse(response: PtQResponse): GenerateQueryResponse {
    if (!response.query) {
      let failureDetails = 'It was not possible to generate a query from the provided prompt';
      if (response.unsatisfied?.length) {
        failureDetails += ':';
        for (const { reason } of response.unsatisfied) {
          failureDetails += `\n - ${reason}`;
        }
      }

      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR,
          details: failureDetails,
        },
      });
    }

    const generated = response.query;
    return create(GenerateQueryResponseSchema, {
      response: { code: EnumStatusCode.OK },
      query: {
        description: generated.description,
        document: generated.document,
        operationName: generated.operationName,
        operationType: PromptToQueryService.getOperationType(generated.operationType),
        variablesSchema: generated.variablesSchema,
      },
    });
  }
}
