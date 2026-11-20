import { describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  OperationsFetchBasedOn,
  type GetFieldUsageRequest,
  type GetOperationsRequest,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { registerListOperationsTool } from '../../../src/commands/mcp/analytics/tools/list-operations.js';
import { registerGetOperationTool } from '../../../src/commands/mcp/analytics/tools/get-operation.js';
import { registerGetFieldUsageTool } from '../../../src/commands/mcp/analytics/tools/get-field-usage.js';
import { fakeContext } from './fake-context.js';

const okResponse = { response: { code: EnumStatusCode.OK } };

describe('list_operations', () => {
  test('sorts by the requested metric and reports deprecated-field usage', async () => {
    let request: GetOperationsRequest | undefined;
    const { ctx, tools } = fakeContext({
      getOperations: (req) => {
        request = req;
        return { ...okResponse, operations: [] };
      },
    });
    registerListOperationsTool(ctx);

    await tools.get('list_operations')!.handler({ graph: 'shop', namespace: 'default', sortBy: 'latency' });

    expect(request?.fetchBasedOn).toBe(OperationsFetchBasedOn.LATENCY);
    expect(request?.includeHasDeprecatedFields).toBe(true);
    expect(request?.limit).toBe(20);
  });

  test('caps the page size at 1000', async () => {
    let request: GetOperationsRequest | undefined;
    const { ctx, tools } = fakeContext({
      getOperations: (req) => {
        request = req;
        return { ...okResponse, operations: [] };
      },
    });
    registerListOperationsTool(ctx);

    await tools.get('list_operations')!.handler({ graph: 'shop', namespace: 'default', limit: 5000 });

    expect(request?.limit).toBe(1000);
  });
});

describe('get_operation', () => {
  test('combines the document, clients, deprecated fields and metrics in one result', async () => {
    const calls: string[] = [];
    const { ctx, tools } = fakeContext({
      getOperationContent: () => {
        calls.push('content');
        return { ...okResponse, operationContent: 'query A { a }' };
      },
      getOperationClients: () => {
        calls.push('clients');
        return { ...okResponse, clients: [{ name: 'web', version: '1.0', requestCount: BigInt(3) }] };
      },
      getOperationDeprecatedFields: () => {
        calls.push('deprecated');
        return { ...okResponse, deprecatedFields: [] };
      },
      getGraphMetrics: (req) => {
        calls.push(`metrics:${req.filters.map((f) => `${f.field}=${f.value}`).join(',')}`);
        return { ...okResponse, requests: { value: '3', top: [], series: [] } };
      },
    });
    registerGetOperationTool(ctx);

    const result = await tools.get('get_operation')!.handler({ graph: 'shop', namespace: 'default', hash: '123' });
    const data = (result.structuredContent as any).data;

    expect(calls.sort()).toEqual(['clients', 'content', 'deprecated', 'metrics:operationHash=123']);
    expect(data.content).toBe('query A { a }');
    expect(data.clients).toEqual([{ name: 'web', version: '1.0', requestCount: '3', lastUsed: '' }]);
  });
});

describe('get_field_usage', () => {
  test('asks for argument usage when kind is argument', async () => {
    let request: GetFieldUsageRequest | undefined;
    const { ctx, tools } = fakeContext({
      getFieldUsage: (req) => {
        request = req;
        return { ...okResponse, clients: [], requestSeries: [] };
      },
    });
    registerGetFieldUsageTool(ctx);

    await tools.get('get_field_usage')!.handler({
      graph: 'shop',
      namespace: 'default',
      type: 'Query',
      field: 'id',
      kind: 'argument',
    });

    expect(request?.isArgument).toBe(true);
    expect(request?.isInput).toBe(false);
    expect(request?.typename).toBe('Query');
    expect(request?.field).toBe('id');
  });

  test('reads only the window the plan retains, and says it cut the window', async () => {
    let request: GetFieldUsageRequest | undefined;
    const { ctx, tools } = fakeContext({
      getFieldUsage: (req) => {
        request = req;
        return { ...okResponse, clients: [], requestSeries: [] };
      },
      getAnalyticsCapabilities: () => ({
        ...okResponse,
        retention: [{ family: 'schema_usage', planDays: 7, storageTtlDays: 90, effectiveDays: 7 }],
      }),
    });
    registerGetFieldUsageTool(ctx);

    const result = await tools.get('get_field_usage')!.handler({
      graph: 'shop',
      namespace: 'default',
      type: 'Query',
      field: 'id',
      range: '30d',
    });

    expect(request?.range).toBe(168);
    const meta = (result.structuredContent as any).meta;
    expect([meta.window, meta.warnings]).toEqual([
      { range: 168 },
      ["Window clamped to 7 days by your plan's analytics retention."],
    ]);
  });
});
