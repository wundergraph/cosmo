import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import {
  type GenerateQueryResponse,
  GenerateQueryResponseSchema,
  SatisfiedOperationType,
} from '@wundergraph/cosmo-connect/dist/ai/v1/ai_pb';
import { create } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import * as z from 'zod';
import { Client, Code, ConnectError } from '@connectrpc/connect';
import {
  OperationType,
  PromptToQueryService as PtQService,
  ResolveResponse,
  Schema,
  SchemaStatus,
} from '@wundergraph/cosmo-connect/dist/yoko/v1/prompt_to_query_pb';
import { traced } from '../tracing.js';
import * as schema from '../../db/schema.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { retryWithBackoff } from '../util/timers.js';

const validationSchema = z.object({
  version: z.string().uuid(),
  prompt: z.string().trim().min(1),
});

class StillIndexingError extends Error {
  constructor(schema: Schema) {
    super(`Prompt to Query index generation failed${schema.lastError ? `: ${schema.lastError}` : ''}`);
  }
}

@traced
export class PromptToQueryService {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private logger: FastifyBaseLogger,
    private client: Client<typeof PtQService>,
    private organizationId: string,
    private defaultBillingPlanId: string | undefined,
  ) {}

  async generateQuery(
    federatedGraphId: string,
    version: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<GenerateQueryResponse> {
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

    // Ensure that the feature terms have been accepted for the organization
    if (!(await orgRepo.isFeatureTermsAccepted(this.organizationId, 'prompt-to-query'))) {
      return create(GenerateQueryResponseSchema, {
        response: {
          code: EnumStatusCode.ERR,
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
      const schemaId = await this.getSchemaId(schemaVersion.sdl, signal);
      if (!schemaId) {
        return create(GenerateQueryResponseSchema, {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: 'Schema not found',
          },
        });
      }

      return PromptToQueryService.createResponse(
        await this.client.resolve({ schemaId, prompt: parsed.data.prompt }, { signal }),
      );
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
    // Ensure that the feature has been enabled for the organization
    const orgRepo = new OrganizationRepository(this.logger, this.db, this.defaultBillingPlanId);
    const ptqFeature = await orgRepo.getFeature({ organizationId: this.organizationId, featureId: 'prompt-to-query' });
    if (!ptqFeature?.enabled || !schema) {
      return;
    }

    // Ensure that the feature terms have been accepted for the organization
    if (!(await orgRepo.isFeatureTermsAccepted(this.organizationId, 'prompt-to-query'))) {
      return;
    }

    // Fire and forget the schema indexation
    this.client
      .ensureSchema({ sdl: schema })
      .catch((e) => this.logger.error(e, 'Failed to index schema due an unexpected error'));
  }

  private async getSchemaId(schemaSDL: string, signal?: AbortSignal): Promise<string | undefined> {
    const resp = await this.client.ensureSchema({ sdl: schemaSDL }, { signal });

    let schemaId = resp.schema?.schemaId;
    const schemaStatus = resp.schema?.status;
    if (schemaStatus === SchemaStatus.INDEXING) {
      /**
       * Re-fetch the index status every second, if after 180 attempts (roughly 3 minutes) the indexing is still in
       * progress, instead of waiting indefinitely, we'll just bail and let the client decide if they want to attempt
       * the request again.
       *
       * We do it this way to prevent process hogging
       */
      schemaId = await retryWithBackoff(
        async (abortSignal) => {
          const schemaResp = await this.client.getSchema({ schemaId: resp.schema?.schemaId }, { signal: abortSignal });
          if (schemaResp.schema?.status === SchemaStatus.INDEXING) {
            throw new StillIndexingError(schemaResp.schema!);
          }

          return schemaResp.schema?.schemaId;
        },
        {
          attempts: 180,
          baseInterval: 1000,
          maxInterval: 1000,
          jitter: true,
          signal,
          shouldRetry: PromptToQueryService.isRetryableError,
        },
      );
    }

    return schemaId;
  }

  private static isRetryableError(error: unknown) {
    if (error instanceof StillIndexingError) {
      return true;
    }
    if (error instanceof ConnectError) {
      return error.code === Code.Unknown;
    }

    return false;
  }

  private static getOperationType(type: OperationType): SatisfiedOperationType {
    switch (type) {
      case OperationType.QUERY: {
        return SatisfiedOperationType.QUERY;
      }
      case OperationType.MUTATION: {
        return SatisfiedOperationType.MUTATION;
      }
      case OperationType.SUBSCRIPTION: {
        return SatisfiedOperationType.SUBSCRIPTION;
      }
    }

    return SatisfiedOperationType.QUERY;
  }

  private static createResponse(response: ResolveResponse): GenerateQueryResponse {
    if (!response.query) {
      let failureDetails = 'It was not possible to generate a query from the provided prompt';
      if (response.errors?.length) {
        failureDetails += ':';
        for (const err of response.errors) {
          failureDetails += `\n - ${err.message}`;
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
