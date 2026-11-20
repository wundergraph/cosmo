import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createCredentials, createHubClient, errorMessage } from '@wundergraph/wgc-plugin-sdk';
import { instanceGuard } from '../src/core/client/client.js';
import { createInstanceRegistry, tokenInstance } from '../src/core/instances.js';

const hubJsons: Record<string, object> = {
  'http://localhost:4400': {
    instance: 'orbstack',
    apiUrl: 'http://localhost:4400',
    mcpUrl: 'http://localhost:4400/mcp',
    appUrl: 'http://localhost:4400',
    studioUrl: 'http://localhost:4430',
    cosmoApiUrl: 'http://localhost:4431',
    cdnUrl: 'http://localhost:4487',
  },
  'https://hub.moonshot.example': {
    instance: 'moonshot',
    apiUrl: 'https://hub.moonshot.example',
    mcpUrl: 'https://hub.moonshot.example/mcp',
    appUrl: 'https://app.moonshot.example',
    studioUrl: 'https://studio.moonshot.example',
    cosmoApiUrl: 'https://cosmo.moonshot.example',
    cdnUrl: 'https://cdn.moonshot.example',
  },
};

/** Serves each Hub's hub.json and an MCP endpoint, and records every request with its bearer. */
const fakeNetwork = (overrides: Record<string, object> = {}) => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    requests.push(`${url.href} ${new Headers(init?.headers).get('authorization') ?? '-'}`);
    if (url.pathname === '/.well-known/hub.json') {
      const body = overrides[url.origin] ?? hubJsons[url.origin];
      return Promise.resolve(body ? Response.json(body) : new Response('not found', { status: 404 }));
    }
    const message = JSON.parse(String(init?.body));
    if (message.method === 'notifications/initialized') {
      return Promise.resolve(new Response(null, { status: 202 }));
    }
    const result = message.method === 'tools/call' ? { content: [], structuredContent: { ok: true } } : {};
    return Promise.resolve(Response.json({ jsonrpc: '2.0', id: message.id, result }));
  };
  return { requests, fetchImpl };
};

const setup = (overrides: Record<string, object> = {}) => {
  const network = fakeNetwork(overrides);
  const cacheFile = join(mkdtempSync(join(tmpdir(), 'wgc-instances-')), 'hub-instances.json');
  const registry = createInstanceRegistry({
    hubUrls: ['http://localhost:4400', 'https://hub.moonshot.example'],
    cacheFile,
    fetchImpl: network.fetchImpl,
  });
  const callHub = (hubUrl: string, token: string) => {
    const credentials = createCredentials({
      env: {},
      loginToken: () => Promise.resolve(token),
      authorizeTarget: registry.authorize,
    });
    return createHubClient({
      baseUrl: hubUrl,
      clientVersion: '1.0.0',
      fetchImpl: network.fetchImpl,
      bearer: (target) => credentials.resolveBearer({ audience: 'hub', gitlabTokenVariable: 'HUB_ID_TOKEN' }, target),
    }).callTool('list_sandboxes', {}, z.object({ ok: z.boolean() }));
  };
  return { ...network, cacheFile, registry, callHub };
};

const failureMessage = (result: { success: true } | { success: false; errors: Error[] }): string =>
  result.success ? 'succeeded' : errorMessage(result);

describe('Hub instance tokens', () => {
  test('a wg_ token names its instance; other tokens name none', () => {
    expect(tokenInstance('wg_orbstack_pat_s3cr_et')).toBe('orbstack');
    expect(tokenInstance('wg_moonshot_api_x')).toBe('moonshot');
    expect(tokenInstance('wg_orbstack')).toBeUndefined();
    expect(tokenInstance('eyJhbGciOiJSUzI1NiJ9.e30.sig')).toBeUndefined();
  });

  test('sends a token to the URLs of its own instance', async () => {
    const { callHub, requests } = setup();

    const result = await callHub('http://localhost:4400', 'wg_orbstack_pat_s3cret');

    expect(result).toEqual({ success: true, data: { ok: true } });
    expect(requests).toEqual([
      'http://localhost:4400/.well-known/hub.json -',
      'https://hub.moonshot.example/.well-known/hub.json -',
      'http://localhost:4400/mcp Bearer wg_orbstack_pat_s3cret',
      'http://localhost:4400/mcp Bearer wg_orbstack_pat_s3cret',
      'http://localhost:4400/mcp Bearer wg_orbstack_pat_s3cret',
    ]);
  });

  test("refuses to send a token to another instance's Hub, naming both", async () => {
    const { callHub, requests } = setup();

    const result = await callHub('https://hub.moonshot.example', 'wg_orbstack_pat_s3cret');

    expect(failureMessage(result)).toBe(
      'The token is for Hub instance "orbstack", but https://hub.moonshot.example belongs to instance "moonshot". Known instances: moonshot, orbstack.',
    );
    expect(requests).toEqual([
      'http://localhost:4400/.well-known/hub.json -',
      'https://hub.moonshot.example/.well-known/hub.json -',
    ]);
  });

  test('refuses a token for an instance no known Hub serves', async () => {
    const { callHub, requests } = setup();

    const result = await callHub('http://localhost:4400', 'wg_gke_pat_s3cret');

    expect(failureMessage(result)).toBe(
      'The token is for Hub instance "gke", which no known Hub serves. Known instances: moonshot, orbstack.',
    );
    expect(requests.filter((request) => request.includes('/mcp'))).toEqual([]);
  });

  test('a later run reads the instances from the cache without fetching hub.json', async () => {
    const first = setup();
    await first.callHub('http://localhost:4400', 'wg_orbstack_pat_s3cret');
    const network = fakeNetwork();
    const second = createInstanceRegistry({
      hubUrls: ['http://localhost:4400', 'https://hub.moonshot.example'],
      cacheFile: first.cacheFile,
      fetchImpl: network.fetchImpl,
    });

    const allowed = await second.authorize('wg_moonshot_pat_s3cret', new URL('https://cdn.moonshot.example/x'));

    expect(allowed).toEqual({ success: true, data: undefined });
    expect(network.requests).toEqual([]);
    expect(Object.keys(JSON.parse(readFileSync(first.cacheFile, 'utf8')))).toEqual(['orbstack', 'moonshot']);
  });

  test('sends a token without the wg_ prefix anywhere, without reading hub.json', async () => {
    const { callHub, requests } = setup();

    const result = await callHub('https://hub.elsewhere.example', 'eyJhbGciOiJSUzI1NiJ9.e30.sig');

    expect(result).toEqual({ success: true, data: { ok: true } });
    expect(requests[0]).toBe('https://hub.elsewhere.example/mcp Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig');
    expect(requests.some((request) => request.includes('hub.json'))).toBe(false);
  });

  test('ignores a hub.json whose URLs are not http(s)', async () => {
    const { registry, cacheFile } = setup({
      'http://localhost:4400': { ...hubJsons['http://localhost:4400'], cdnUrl: 'ftp://localhost:4487' },
      'https://hub.moonshot.example': { ...hubJsons['https://hub.moonshot.example'], mcpUrl: 'javascript:alert(1)' },
    });

    const result = await registry.authorize('wg_orbstack_pat_s3cret', new URL('http://localhost:4400/mcp'));

    expect(failureMessage(result)).toBe(
      'The token is for Hub instance "orbstack", which no known Hub serves. Known instances: none.',
    );
    expect(existsSync(cacheFile)).toBe(false);
  });

  test('a control plane call with a token for another instance never reaches the server', async () => {
    const { registry } = setup();
    const received: string[] = [];
    const platform = (baseUrl: string) =>
      createClient(
        PlatformService,
        createRouterTransport(
          ({ service }) => {
            service(PlatformService, {
              getClients: (_request, context) => {
                received.push(context.requestHeader.get('authorization') ?? '-');
                return {};
              },
            });
          },
          { transport: { baseUrl, interceptors: [instanceGuard(registry)] } },
        ),
      );
    const headers = { authorization: 'Bearer wg_orbstack_pat_s3cret' };

    await platform('http://localhost:4431').getClients({}, { headers });
    const refused = platform('https://cosmo.moonshot.example').getClients({}, { headers });

    await expect(refused).rejects.toThrow(
      'The token is for Hub instance "orbstack", but https://cosmo.moonshot.example belongs to instance "moonshot". Known instances: moonshot, orbstack.',
    );
    expect(received).toEqual(['Bearer wg_orbstack_pat_s3cret']);
  });
});
