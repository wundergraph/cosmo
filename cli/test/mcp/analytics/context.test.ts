import { createClient, createRouterTransport } from '@connectrpc/connect';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createAnalyticsToolContext, registerAnalyticsTool } from '../../../src/commands/mcp/analytics/context.js';
import { fakeContext } from './fake-context.js';

/** A tool context on a platform whose capabilities and whoAmI answer in turn from the given codes. */
function contextWith(codes: EnumStatusCode[]) {
  let now = new Date('2026-10-31T12:00:00Z');
  const calls = { capabilities: 0, whoAmI: 0 };
  const platform = createClient(
    PlatformService,
    createRouterTransport(({ service }) =>
      service(PlatformService, {
        getAnalyticsCapabilities: () => ({
          response: { code: codes[calls.capabilities++] ?? EnumStatusCode.OK },
          retention: [{ family: 'analytics', effectiveDays: 7 }],
        }),
        whoAmI: () => {
          calls.whoAmI++;
          return { response: { code: EnumStatusCode.OK }, organizationSlug: 'acme' };
        },
      }),
    ),
  );
  const ctx = createAnalyticsToolContext({
    server: {} as McpServer,
    platform,
    auth: { mode: 'user', getHeaders: () => Promise.resolve({ authorization: 'Bearer test' }) },
    webURL: 'https://cosmo.wundergraph.com',
    now: () => now,
  });
  const advance = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  return { ctx, calls, advance };
}

describe('createAnalyticsToolContext', () => {
  test('reads the capabilities once, and again after ten minutes', async () => {
    const { ctx, calls, advance } = contextWith([]);

    await ctx.getCapabilities();
    await ctx.getCapabilities();
    advance(11);
    const capabilities = await ctx.getCapabilities();

    expect(calls.capabilities).toBe(2);
    expect(capabilities.retention.map((r) => [r.family, r.effectiveDays])).toEqual([['analytics', 7]]);
  });

  test('reads the capabilities again when asked for fresh ones, and caches those', async () => {
    const { ctx, calls } = contextWith([]);

    await ctx.getCapabilities();
    await ctx.getCapabilities({ fresh: true });
    await ctx.getCapabilities();

    expect(calls.capabilities).toBe(2);
  });

  test('retries capabilities that failed instead of keeping the failure', async () => {
    const { ctx, calls } = contextWith([EnumStatusCode.ERR]);

    await expect(ctx.getCapabilities()).rejects.toThrow(new Error('Analytics context failed: unknown error'));
    await ctx.getCapabilities();

    expect(calls.capabilities).toBe(2);
  });

  test('reads the organization slug once', async () => {
    const { ctx, calls } = contextWith([]);

    expect([await ctx.getOrgSlug(), await ctx.getOrgSlug()]).toEqual(['acme', 'acme']);
    expect(calls.whoAmI).toBe(1);
  });
});

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
