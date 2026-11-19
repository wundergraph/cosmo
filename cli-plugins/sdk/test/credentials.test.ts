import { describe, expect, test } from 'vitest';
import { createCredentials } from '../src/index.js';

const request = { audience: 'hub', gitlabTokenVariable: 'HUB_ID_TOKEN' };

describe('createCredentials', () => {
  test('GitHub Actions: requests an OIDC token for the audience', async () => {
    const urls: string[] = [];
    const credentials = createCredentials({
      env: {
        GITHUB_ACTIONS: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?api-version=2.0',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token',
      },
      loginToken: () => Promise.resolve('login'),
      fetchImpl: (input, init) => {
        urls.push(`${String(input)} ${new Headers(init?.headers).get('authorization')}`);
        return Promise.resolve(Response.json({ value: 'gh-oidc' }));
      },
    });

    expect(await credentials.resolveBearer(request)).toEqual({
      success: true,
      data: { token: 'gh-oidc', kind: 'ci-oidc' },
    });
    expect(urls).toEqual(['https://token.example/req?api-version=2.0&audience=hub bearer req-token']);
  });

  test('GitLab CI: reads the configured id_tokens variable', async () => {
    const credentials = createCredentials({
      env: { GITLAB_CI: 'true', HUB_ID_TOKEN: 'gl-oidc' },
      loginToken: () => Promise.resolve(undefined),
    });

    expect(await credentials.resolveBearer(request)).toEqual({
      success: true,
      data: { token: 'gl-oidc', kind: 'ci-oidc' },
    });
  });

  test('locally falls back to the wgc auth login token', async () => {
    const credentials = createCredentials({ env: {}, loginToken: () => Promise.resolve('login') });

    expect(await credentials.resolveBearer(request)).toEqual({
      success: true,
      data: { token: 'login', kind: 'login' },
    });
  });

  test('a GitHub job without id-token permission says how to grant it', async () => {
    const credentials = createCredentials({
      env: { GITHUB_ACTIONS: 'true' },
      loginToken: () => Promise.resolve(undefined),
    });

    const result = await credentials.resolveBearer(request);

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.errors[0].message).toBe(
      'No OIDC token is available. Grant the job `permissions: id-token: write`.',
    );
  });
});
