import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useCiIdentityForCosmo } from '../src/core/ci-oidc.js';
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

    const result = await useCiIdentityForCosmo({
      deploymentKind: 'cosmo-cloud',
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result).toEqual({ success: true, data: 'ci-oidc' });
    expect(config.apiKey).toBe('github-oidc-token-for-cosmo');
    expect(github.requests).toEqual([{ audience: 'cosmo', authorization: 'bearer request-token' }]);
  });

  test('requests the audience from COSMO_OIDC_AUDIENCE', async () => {
    const github = await startFakeGithubTokenEndpoint(200);
    server = github.server;

    await useCiIdentityForCosmo({
      deploymentKind: 'cosmo-cloud',
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

    const result = await useCiIdentityForCosmo({
      deploymentKind: 'cosmo-cloud',
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result).toEqual({ success: true, data: 'api-key' });
    expect(config.apiKey).toBe('cosmo_api_key');
    expect(github.requests).toEqual([]);
  });

  test('uses the GitLab COSMO_ID_TOKEN entry', async () => {
    const result = await useCiIdentityForCosmo({
      deploymentKind: 'cosmo-cloud',
      env: { GITLAB_CI: 'true', COSMO_ID_TOKEN: 'gitlab-oidc-token' },
    });

    expect(result).toEqual({ success: true, data: 'ci-oidc' });
    expect(config.apiKey).toBe('gitlab-oidc-token');
  });

  test('changes nothing outside CI', async () => {
    const result = await useCiIdentityForCosmo({ deploymentKind: 'cosmo-cloud', env: {} });

    expect(result).toEqual({ success: true, data: 'none' });
    expect(config.apiKey).toBeUndefined();
  });

  test('reports a refused GitHub token request', async () => {
    const github = await startFakeGithubTokenEndpoint(403);
    server = github.server;

    const result = await useCiIdentityForCosmo({
      deploymentKind: 'cosmo-cloud',
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: github.url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token' },
    });

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.errors[0].message).toBe(
      'GitHub Actions refused the OIDC token request (HTTP 403).',
    );
    expect(config.apiKey).toBeUndefined();
  });

  describe('in a Hub deployment', () => {
    const originalHubUrl = config.hubURL;
    const originalAudience = config.hubOidcAudience;

    beforeEach(() => {
      config.hubURL = 'https://hub.example';
      config.hubOidcAudience = 'wundergraph-hub';
    });

    afterEach(() => {
      config.hubURL = originalHubUrl;
      config.hubOidcAudience = originalAudience;
    });

    const githubJob = {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?api-version=2.0',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
    };

    test('uses the Cosmo access token Hub gives for the job token, never the job token itself', async () => {
      const requests: string[] = [];
      const result = await useCiIdentityForCosmo({
        deploymentKind: 'hub',
        env: githubJob,
        fetchImpl: (input, init) => {
          const url = new URL(String(input));
          requests.push(
            `${init?.method ?? 'GET'} ${url.origin}${url.pathname} ${url.searchParams.get('audience') ?? ''}`,
          );
          if (url.origin === 'https://token.example') {
            return Promise.resolve(Response.json({ value: 'github-oidc-token' }));
          }
          return Promise.resolve(
            Response.json(
              { token: 'cosmo_ci_scoped', expiresAt: '2026-11-24T10:10:00.000Z', namespace: 'prod' },
              { status: 201 },
            ),
          );
        },
      });

      expect(result).toEqual({ success: true, data: 'hub' });
      expect(config.apiKey).toBe('cosmo_ci_scoped');
      expect(requests).toEqual([
        'GET https://token.example/req wundergraph-hub',
        'POST https://hub.example/ci/cosmo-token ',
      ]);
    });

    test('reads the GitLab HUB_ID_TOKEN entry', async () => {
      let sentBearer: string | null = null;
      await useCiIdentityForCosmo({
        deploymentKind: 'hub',
        env: { GITLAB_CI: 'true', HUB_ID_TOKEN: 'gitlab-oidc-token' },
        fetchImpl: (_input, init) => {
          sentBearer = new Headers(init?.headers).get('authorization');
          return Promise.resolve(
            Response.json({ token: 'cosmo_ci_scoped', expiresAt: '2026-11-24T10:10:00.000Z', namespace: 'prod' }),
          );
        },
      });

      expect(sentBearer).toBe('Bearer gitlab-oidc-token');
      expect(config.apiKey).toBe('cosmo_ci_scoped');
    });

    test('reports why Hub refused the job and leaves no credential', async () => {
      const result = await useCiIdentityForCosmo({
        deploymentKind: 'hub',
        env: { GITLAB_CI: 'true', HUB_ID_TOKEN: 'gitlab-oidc-token' },
        fetchImpl: () =>
          Promise.resolve(Response.json({ error: 'The repository is not connected to a graph' }, { status: 403 })),
      });

      expect(result).toEqual({
        success: false,
        errors: [
          new Error(
            'Hub gave this CI job no Cosmo access token (HTTP 403): The repository is not connected to a graph',
          ),
        ],
      });
      expect(config.apiKey).toBeUndefined();
    });
  });
});
