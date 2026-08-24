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
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';

const validationSchema = z.object({
  schemaSha: z.string().regex(/^sha256:[\da-f]{64}$/i),
  prompt: z.string().trim().min(1),
});

const ptqQuerySchema = z.object({
  description: z.string().optional(),
  document: z.string().min(1),
  operationName: z.string().min(1),
  operationType: z.union([z.literal('query'), z.literal('mutation'), z.literal('subscription')]),
  variablesSchema: z.string().optional(),
});

const ptqUnsatisfiedSchema = z.object({ reason: z.string() });

const ptqResponseSchema = z.object({
  resolution: z.object({
    queries: z.array(ptqQuerySchema).optional(),
    unsatisfied: z.array(ptqUnsatisfiedSchema).optional(),
  }),
});

type PtQResponse = z.infer<typeof ptqResponseSchema>;

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

  async generateQuery(schemaSha: string, prompt: string): Promise<GenerateQueryResponse> {
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
    const parsed = validationSchema.safeParse({ schemaSha, prompt });
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

    // Invoke the `prompt to query` service
    try {
      const response = await this.#httpClient('/yoko.v1.YokoService/GenerateQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          indexId: parsed.data.schemaSha,
          prompt: parsed.data.prompt,
        }),
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

  private static getOperationType(type: z.infer<typeof ptqQuerySchema>['operationType']): SatisfiedOperationType {
    switch (type) {
      case 'query': {
        return SatisfiedOperationType.QUERY;
      }
      case 'mutation': {
        return SatisfiedOperationType.MUTATION;
      }
      case 'subscription': {
        return SatisfiedOperationType.SUBSCRIPTION;
      }
    }

    return SatisfiedOperationType.QUERY;
  }

  private static handleServiceResponse(response: PtQResponse): GenerateQueryResponse {
    const { resolution } = response;
    if (!resolution?.queries?.length) {
      const { unsatisfied } = resolution;
      let failureDetails = 'It was not possible to generate a query from the provided prompt';
      if (unsatisfied?.length) {
        failureDetails += ':';
        for (const { reason } of unsatisfied) {
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

    const generated = resolution.queries[0];
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
