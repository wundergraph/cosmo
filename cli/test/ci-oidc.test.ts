import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useCiOidcTokenForCosmo } from '../src/core/ci-oidc.js';
import { config } from '../src/core/config.js';

interface TokenRequest {
  audience: string | null;
  authorization: string | undefined;
}

const startFakeGithubTokenEndpoint = async (
  status: number,
): Promise<{ server: Server; url: string; requests: TokenRequest[] }> => {
  const requests: TokenRequest[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requests.push({ audience: url.searchParams.get('audience'), authorization: request.headers.authorization });
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: `github-oidc-token-for-${url.searchParams.get('audience')}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/token?api-version=2.0`, requests };
};

describe('CI OIDC for the control plane', () => {
  let server: Server | undefined;
  const originalApiKey = config.apiKey;

  beforeEach(() => {
    config.apiKey = undefined;
  });

  afterEach(async () => {
    config.apiKey = originalApiKey;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  test('uses the GitHub Actions OIDC token with audience cosmo as the API key', async () => {
    const github = await startFakeGithubTokenEndpoint(200);
    server = github.server;

    const result = await useCiOidcTokenForCosmo({
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result).toEqual({ success: true, data: 'ci-oidc' });
    expect(config.apiKey).toBe('github-oidc-token-for-cosmo');
    expect(github.requests).toEqual([{ audience: 'cosmo', authorization: 'bearer request-token' }]);
  });

  test('requests the audience from COSMO_OIDC_AUDIENCE', async () => {
    const github = await startFakeGithubTokenEndpoint(200);
    server = github.server;

    await useCiOidcTokenForCosmo({
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: github.url,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
        COSMO_OIDC_AUDIENCE: 'https://cosmo.example.com',
      },
    });

    expect(config.apiKey).toBe('github-oidc-token-for-https://cosmo.example.com');
  });

  test('keeps COSMO_API_KEY and asks GitHub for nothing', async () => {
    const github = await startFakeGithubTokenEndpoint(200);
    server = github.server;
    config.apiKey = 'cosmo_api_key';

    const result = await useCiOidcTokenForCosmo({
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result).toEqual({ success: true, data: 'api-key' });
    expect(config.apiKey).toBe('cosmo_api_key');
    expect(github.requests).toEqual([]);
  });

  test('uses the GitLab COSMO_ID_TOKEN entry', async () => {
    const result = await useCiOidcTokenForCosmo({ env: { GITLAB_CI: 'true', COSMO_ID_TOKEN: 'gitlab-oidc-token' } });

    expect(result).toEqual({ success: true, data: 'ci-oidc' });
    expect(config.apiKey).toBe('gitlab-oidc-token');
  });

  test('changes nothing outside CI', async () => {
    const result = await useCiOidcTokenForCosmo({ env: {} });

    expect(result).toEqual({ success: true, data: 'none' });
    expect(config.apiKey).toBeUndefined();
  });

  test('reports a refused GitHub token request', async () => {
    const github = await startFakeGithubTokenEndpoint(403);
    server = github.server;

    const result = await useCiOidcTokenForCosmo({
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.errors[0].message).toBe(
      'GitHub Actions refused the OIDC token request (HTTP 403).',
    );
    expect(config.apiKey).toBeUndefined();
  });
});
