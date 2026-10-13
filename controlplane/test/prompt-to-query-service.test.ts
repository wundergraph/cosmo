import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '@connectrpc/connect';
import {
  EnsureSchemaResponseSchema,
  PromptToQueryService as PtQService,
  SchemaStatus,
  GetSchemaResponseSchema,
  ResolveResponseSchema,
  OperationType,
} from '@wundergraph/cosmo-connect/dist/yoko/v1/prompt_to_query_pb';
import { create } from '@bufbuild/protobuf';
import { FederatedGraphRepository } from '../src/core/repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { PromptToQueryService } from '../src/core/services/PromptToQueryService.js';
import type { FederatedGraphDTO } from '../src/types/index.js';
import * as schema from '../src/db/schema.js';

const schemaVersion = '00000000-0000-4000-8000-000000000001';
const schemaId = `sha256:${'a'.repeat(64)}`;

const createMockService = (overrides: Partial<Client<typeof PtQService>> = {}) => {
  return new PromptToQueryService(
    {} as PostgresJsDatabase<typeof schema>,
    pino({ level: 'silent' }),
    {
      ensureSchema: vi.fn(() =>
        Promise.resolve(
          create(EnsureSchemaResponseSchema, {
            schema: {
              schemaId,
              status: SchemaStatus.READY,
            },
          }),
        ),
      ),
      getSchema: vi.fn(() =>
        Promise.resolve(
          create(GetSchemaResponseSchema, {
            schema: {
              schemaId,
              status: SchemaStatus.READY,
            },
          }),
        ),
      ),
      listSchemas: vi.fn(),
      deleteSchema: vi.fn(),
      resolve: vi.fn(),
      ...overrides,
    } as unknown as Client<typeof PtQService>,
    'organization-id',
    undefined,
  );
};

describe('PromptToQueryService', () => {
  const mockServer = setupServer();

  beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    mockServer.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => mockServer.close());

  test('waits for the schema index before generating a query', async () => {
    const schemaSDL = 'type Query { employees: [String!]! }';
    const requests: ('ensure' | 'get' | 'prompt')[] = [];

    const service = createMockService({
      ensureSchema(req) {
        requests.push('ensure');
        expect(req.sdl).toEqual(schemaSDL);
        return Promise.resolve(
          create(EnsureSchemaResponseSchema, {
            schema: {
              schemaId,
              status: SchemaStatus.INDEXING,
            },
          }),
        );
      },
      getSchema(req) {
        requests.push('get');
        expect(req.schemaId).toEqual(schemaId);
        return Promise.resolve(
          create(GetSchemaResponseSchema, {
            schema: {
              schemaId,
              status: SchemaStatus.READY,
            },
          }),
        );
      },
      resolve(req) {
        requests.push('prompt');
        expect(req.schemaId).toBe(schemaId);
        expect(req.prompt).toEqual('List all employees');
        return Promise.resolve(
          create(ResolveResponseSchema, {
            query: {
              description: 'Lists employees',
              document: 'query ListEmployees { employees }',
              operationName: 'ListEmployees',
              operationType: OperationType.QUERY,
              variablesSchema: '{}',
            },
          }),
        );
      },
    });

    vi.spyOn(OrganizationRepository.prototype, 'getFeature').mockResolvedValue({
      id: 'prompt-to-query',
      enabled: true,
    });
    vi.spyOn(FederatedGraphRepository.prototype, 'byId').mockResolvedValue({
      targetId: 'target-id',
    } as FederatedGraphDTO);
    vi.spyOn(FederatedGraphRepository.prototype, 'getSdlBasedOnSchemaVersion').mockResolvedValue({
      sdl: schemaSDL,
      clientSchema: null,
    });

    vi.spyOn(OrganizationRepository.prototype, 'isFeatureTermsAccepted').mockResolvedValueOnce(true);

    const response = await service.generateQuery('federated-graph-id', schemaVersion, 'List all employees');

    expect(requests).toEqual(['ensure', 'get', 'prompt']);
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.query?.operationName).toBe('ListEmployees');
  });

  test('does not call the service when the organization feature is disabled', async () => {
    vi.spyOn(OrganizationRepository.prototype, 'getFeature').mockResolvedValue({
      id: 'prompt-to-query',
      enabled: false,
    });

    const service = createMockService();
    const response = await service.generateQuery('federated-graph-id', schemaVersion, 'List all employees');

    expect(response.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
  });

  test('indexes composed schemas only when the organization feature is enabled', async () => {
    let ensureIndexRequests = 0;
    const service = createMockService({
      ensureSchema() {
        ensureIndexRequests++;
        return Promise.resolve(
          create(EnsureSchemaResponseSchema, {
            schema: {
              schemaId,
              status: SchemaStatus.INDEXING,
            },
          }),
        );
      },
    });

    const feature = vi.spyOn(OrganizationRepository.prototype, 'getFeature');
    feature.mockResolvedValueOnce({ id: 'prompt-to-query', enabled: false });

    const isFeatureTermsAccepted = vi.spyOn(OrganizationRepository.prototype, 'isFeatureTermsAccepted');
    isFeatureTermsAccepted.mockResolvedValueOnce(true);

    await service.indexSchema('type Query { disabled: Boolean! }');
    expect(ensureIndexRequests).toBe(0);

    feature.mockResolvedValueOnce({ id: 'prompt-to-query', enabled: true });
    await service.indexSchema('type Query { enabled: Boolean! }');
    await vi.waitFor(() => expect(ensureIndexRequests).toBe(1));
  });
});
