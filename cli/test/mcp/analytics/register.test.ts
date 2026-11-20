import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { registerAnalyticsTool } from '../../../src/commands/mcp/analytics/context.js';
import { fakeContext } from './fake-context.js';

describe('registerAnalyticsTool', () => {
  test('marks the tool read-only and idempotent', () => {
    const { ctx, tools } = fakeContext({});

    registerAnalyticsTool(ctx, 'demo', { title: 'Demo', description: 'd', inputSchema: {} }, () =>
      Promise.resolve({ content: [] }),
    );

    expect(tools.get('demo')!.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test('turns a thrown error into an error result instead of crashing', async () => {
    const { ctx, tools } = fakeContext({});
    registerAnalyticsTool(ctx, 'demo', { title: 'Demo', description: 'd', inputSchema: { x: z.string() } }, () =>
      Promise.reject(new Error('ClickHouse is down')),
    );

    const result = await tools.get('demo')!.handler({ x: 'a' });

    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'ClickHouse is down' }] });
  });

  test('passes the auth headers to the handler', async () => {
    const { ctx, tools } = fakeContext({});
    let seen: Record<string, string> | undefined;
    registerAnalyticsTool(ctx, 'demo', { title: 'Demo', description: 'd', inputSchema: {} }, (_input, headers) => {
      seen = headers;
      return Promise.resolve({ content: [] });
    });

    await tools.get('demo')!.handler({});

    expect(seen).toEqual({ authorization: 'Bearer test', 'x-cosmo-client': 'wgc-mcp/test' });
  });
});
