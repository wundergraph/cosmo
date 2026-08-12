import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { PromptToQueryService } from '../src/core/services/PromptToQueryService.js';
import * as schema from '../src/db/schema.js';

describe('PromptToQueryService', () => {
  const yokoURL = 'http://yoko.test';
  const mockServer = setupServer();

  beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    mockServer.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => mockServer.close());

  test('uses the index ID returned by EnsureIndex to generate the query', async () => {
    const schemaSDL = 'type Query { employees: [String!]! }';
    let ensureIndexRequest: unknown;
    let generateQueryRequest: unknown;

    mockServer.use(
      http.post(`${yokoURL}/yoko.v1.YokoService/EnsureIndex`, async ({ request }) => {
        ensureIndexRequest = await request.json();
        return HttpResponse.json({ indexId: 'opaque-yoko-index-id' });
      }),
      http.post(`${yokoURL}/yoko.v1.YokoService/GenerateQuery`, async ({ request }) => {
        generateQueryRequest = await request.json();
        return HttpResponse.json({
          resolution: {
            queries: [
              {
                description: 'Lists employees',
                document: 'query ListEmployees { employees }',
                operationName: 'ListEmployees',
                operationType: 'query',
                variablesSchema: '{}',
              },
            ],
            unsatisfied: [],
          },
        });
      }),
    );
    vi.spyOn(OrganizationRepository.prototype, 'getFeature').mockResolvedValue({
      id: 'prompt-to-query',
      enabled: true,
    });

    const service = new PromptToQueryService(
      {} as PostgresJsDatabase<typeof schema>,
      pino(),
      yokoURL,
      'organization-id',
      undefined,
    );
    const response = await service.generateQuery(schemaSDL, 'List all employees');

    expect(ensureIndexRequest).toEqual({ sdl: schemaSDL });
    expect(generateQueryRequest).toEqual({
      indexId: 'opaque-yoko-index-id',
      prompt: 'List all employees',
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.query?.operationName).toBe('ListEmployees');
  });
});
