import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { FederatedGraphRepository } from '../src/core/repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { PromptToQueryService } from '../src/core/services/PromptToQueryService.js';
import type { FederatedGraphDTO } from '../src/types/index.js';
import * as schema from '../src/db/schema.js';

describe('PromptToQueryService', () => {
  const serviceURL = 'http://prompt-to-query.test';
  const schemaVersion = '00000000-0000-4000-8000-000000000001';
  const indexId = `sha256:${'a'.repeat(64)}`;
  const mockServer = setupServer();

  const createService = (configured = true) =>
    new PromptToQueryService(
      {} as PostgresJsDatabase<typeof schema>,
      pino({ level: 'silent' }),
      configured ? serviceURL : undefined,
      'organization-id',
      undefined,
    );

  beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    mockServer.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => mockServer.close());

  test('waits for the schema index before generating a query', async () => {
    const schemaSDL = 'type Query { employees: [String!]! }';
    const requests: string[] = [];
    let promptRequest: unknown;

    mockServer.use(
      http.post(`${serviceURL}/yoko.v1.YokoService/EnsureIndex`, async ({ request }) => {
        requests.push('ensure');
        expect(await request.json()).toEqual({ sdl: schemaSDL });
        return HttpResponse.json({ index: { indexId, status: 'INDEX_STATUS_INDEXING' } });
      }),
      http.post(`${serviceURL}/yoko.v1.YokoService/GetIndex`, async ({ request }) => {
        requests.push('get');
        expect(await request.json()).toEqual({ indexId });
        return HttpResponse.json({ index: { indexId, status: 'INDEX_STATUS_READY' } });
      }),
      http.post(`${serviceURL}/yoko.v1.YokoService/PromptToQuery`, async ({ request }) => {
        requests.push('prompt');
        promptRequest = await request.json();
        return HttpResponse.json({
          query: {
            description: 'Lists employees',
            document: 'query ListEmployees { employees }',
            operationName: 'ListEmployees',
            operationType: 'OPERATION_TYPE_QUERY',
            variablesSchema: '{}',
          },
          unsatisfied: [],
        });
      }),
    );
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

    const response = await createService().generateQuery('federated-graph-id', schemaVersion, 'List all employees');

    expect(requests).toEqual(['ensure', 'get', 'prompt']);
    expect(promptRequest).toEqual({ indexId, prompt: 'List all employees' });
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.query?.operationName).toBe('ListEmployees');
  });

  test('does not call the service when the organization feature is disabled', async () => {
    vi.spyOn(OrganizationRepository.prototype, 'getFeature').mockResolvedValue({
      id: 'prompt-to-query',
      enabled: false,
    });

    const response = await createService().generateQuery('federated-graph-id', schemaVersion, 'List all employees');

    expect(response.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
  });

  test('indexes composed schemas only when the organization feature is enabled', async () => {
    let ensureIndexRequests = 0;
    mockServer.use(
      http.post(`${serviceURL}/yoko.v1.YokoService/EnsureIndex`, () => {
        ensureIndexRequests++;
        return HttpResponse.json({ index: { indexId, status: 'INDEX_STATUS_INDEXING' } });
      }),
    );
    const feature = vi.spyOn(OrganizationRepository.prototype, 'getFeature');
    feature.mockResolvedValueOnce({ id: 'prompt-to-query', enabled: false });

    const service = createService();
    await service.indexSchema('type Query { disabled: Boolean! }');
    expect(ensureIndexRequests).toBe(0);

    feature.mockResolvedValueOnce({ id: 'prompt-to-query', enabled: true });
    await service.indexSchema('type Query { enabled: Boolean! }');
    await vi.waitFor(() => expect(ensureIndexRequests).toBe(1));
  });

  test('returns a structured error when the service is not configured', async () => {
    const feature = vi.spyOn(OrganizationRepository.prototype, 'getFeature');

    const response = await createService(false).generateQuery(
      'federated-graph-id',
      schemaVersion,
      'List all employees',
    );

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toContain('not been configured');
    expect(feature).not.toHaveBeenCalled();
  });
});
