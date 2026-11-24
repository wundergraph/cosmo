import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createHubClient, ok, toFailure } from '../src/index.js';

type Call = { url: string; method: string; body: string; auth: string | null; session: string | null };

const fakeHub = (toolResult: object) => {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => Promise.resolve(respond(input, init));
  const respond = (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Response => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body);
    const message = JSON.parse(body);
    calls.push({
      url: String(input),
      method: message.method ?? 'POST',
      body,
      auth: headers.get('authorization'),
      session: headers.get('mcp-session-id'),
    });
    if (message.method === 'initialize') {
      return Response.json({ jsonrpc: '2.0', id: message.id, result: {} }, { headers: { 'mcp-session-id': 's-1' } });
    }
    if (message.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (message.method === 'tools/call') {
      return new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: toolResult })}\n\n`,
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    }
    return Response.json({ accepted: true, compositionErrors: [] });
  };
  return { calls, fetchImpl };
};

const client = (fetchImpl: typeof fetch) =>
  createHubClient({
    baseUrl: 'https://hub.example',
    bearer: () => Promise.resolve(ok({ token: 't0k', kind: 'login' as const })),
    clientVersion: '1.0.0',
    fetchImpl,
  });

const sandboxes = z.object({ sandboxes: z.array(z.object({ name: z.string() })) });

describe('createHubClient', () => {
  test('initializes once, then calls tools in the same session with the bearer', async () => {
    const hub = fakeHub({ content: [], structuredContent: { sandboxes: [{ name: 'checkout' }] } });
    const hubClient = client(hub.fetchImpl);

    const first = await hubClient.callTool('list_sandboxes', { schema: 'shop' }, sandboxes);
    await hubClient.callTool('list_sandboxes', { schema: 'shop' }, sandboxes);

    expect(first).toEqual({ success: true, data: { sandboxes: [{ name: 'checkout' }] } });
    expect(hub.calls.map((call) => [call.url, call.method, call.session, call.auth])).toEqual([
      ['https://hub.example/mcp', 'initialize', null, 'Bearer t0k'],
      ['https://hub.example/mcp', 'notifications/initialized', 's-1', 'Bearer t0k'],
      ['https://hub.example/mcp', 'tools/call', 's-1', 'Bearer t0k'],
      ['https://hub.example/mcp', 'tools/call', 's-1', 'Bearer t0k'],
    ]);
    expect(JSON.parse(hub.calls[2].body).params).toEqual({ name: 'list_sandboxes', arguments: { schema: 'shop' } });
  });

  test('falls back to JSON in the text content when there is no structured content', async () => {
    const hub = fakeHub({ content: [{ type: 'text', text: '{"sandboxes":[{"name":"a"}]}' }] });

    expect(await client(hub.fetchImpl).callTool('list_sandboxes', {}, sandboxes)).toEqual({
      success: true,
      data: { sandboxes: [{ name: 'a' }] },
    });
  });

  test('surfaces a tool error with its message', async () => {
    const hub = fakeHub({ content: [{ type: 'text', text: 'sandbox not found' }], isError: true });

    const result = await client(hub.fetchImpl).callTool('get_sandbox', {}, sandboxes);

    expect(result.success ? '' : result.errors[0].message).toBe('sandbox not found');
  });

  test('a coded tool error becomes a failure with its kind, fix and Hub page', async () => {
    const hub = fakeHub({
      content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED: wildcard host' }],
      structuredContent: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Allowing a wildcard host lets sandbox code reach any matching host.',
        remediation: "Re-run with --confirm '*.amazonaws.com', or approve it in Hub:",
        approval_url: 'https://hub.example/acme/graph/shop/sandboxes/sb_3fd1/approvals/apr_51',
      },
      isError: true,
    });

    const result = await client(hub.fetchImpl).callTool('update_egress_allowlist', {}, sandboxes);

    expect(result.success ? undefined : toFailure(result)).toEqual({
      kind: 'confirmation',
      code: 'CONFIRMATION_REQUIRED',
      message: 'Allowing a wildcard host lets sandbox code reach any matching host.',
      remediation:
        "Re-run with --confirm '*.amazonaws.com', or approve it in Hub:\nhttps://hub.example/acme/graph/shop/sandboxes/sb_3fd1/approvals/apr_51",
      url: 'https://hub.example/acme/graph/shop/sandboxes/sb_3fd1/approvals/apr_51',
    });
  });

  test('rejects a result that does not match the expected shape', async () => {
    const hub = fakeHub({ content: [], structuredContent: { sandboxes: 'nope' } });

    const result = await client(hub.fetchImpl).callTool('list_sandboxes', {}, sandboxes);

    expect(result.success).toBe(false);
  });

  test('a 401 from Hub tells a local user to sign in again', async () => {
    const result = await client(() =>
      Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 })),
    ).callTool('list_sandboxes', {}, sandboxes);

    expect(result.success ? undefined : toFailure(result)).toEqual({
      kind: 'unauthenticated',
      message: 'Hub rejected the sign-in token.',
      remediation: 'Run `wgc auth login` again.',
      next: ['wgc auth login'],
    });
  });

  test('pushSchema posts to /ci/schema-push', async () => {
    const hub = fakeHub({});
    const request = {
      sandboxYaml: 'schema: shop\n',
      subgraphs: [{ name: 'a', sdl: 'type Query { a: Int }' }],
      sha: 'abc',
    };

    const result = await client(hub.fetchImpl).pushSchema(
      request,
      z.object({ accepted: z.boolean(), compositionErrors: z.array(z.string()) }),
    );

    expect(result).toEqual({ success: true, data: { accepted: true, compositionErrors: [] } });
    expect(hub.calls[0].url).toBe('https://hub.example/ci/schema-push');
    expect(JSON.parse(hub.calls[0].body)).toEqual(request);
  });

  test('postJson posts to a plain Hub endpoint and reads its answer', async () => {
    const hub = fakeHub({});

    const result = await client(hub.fetchImpl).postJson(
      'ci/subgraph-check',
      { subgraph: 'products', namespace: 'default' },
      z.object({ accepted: z.boolean(), compositionErrors: z.array(z.string()) }),
    );

    expect(result).toEqual({ success: true, data: { accepted: true, compositionErrors: [] } });
    expect(hub.calls[0].url).toBe('https://hub.example/ci/subgraph-check');
    expect(JSON.parse(hub.calls[0].body)).toEqual({ subgraph: 'products', namespace: 'default' });
  });
});
