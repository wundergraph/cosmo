import { describe, expect, test } from 'vitest';
import { createCredentials, failure } from '../src/index.js';

const request = { audience: 'hub', gitlabTokenVariable: 'HUB_ID_TOKEN' };
const target = new URL('https://hub.example/mcp');

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

    expect(await credentials.resolveBearer(request, target)).toEqual({
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

    expect(await credentials.resolveBearer(request, target)).toEqual({
      success: true,
      data: { token: 'gl-oidc', kind: 'ci-oidc' },
    });
  });

  test('locally falls back to the wgc auth login token', async () => {
    const credentials = createCredentials({ env: {}, loginToken: () => Promise.resolve('login') });

    expect(await credentials.resolveBearer(request, target)).toEqual({
      success: true,
      data: { token: 'login', kind: 'login' },
    });
  });

  test('a GitHub job without id-token permission says how to grant it', async () => {
    const credentials = createCredentials({
      env: { GITHUB_ACTIONS: 'true' },
      loginToken: () => Promise.resolve(undefined),
    });

    const result = await credentials.resolveBearer(request, target);

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.errors[0].message).toBe(
      'No OIDC token is available. Grant the job `permissions: id-token: write`.',
    );
  });

  test('withholds the token when authorizeTarget refuses the target', async () => {
    const asked: string[] = [];
    const credentials = createCredentials({
      env: {},
      loginToken: () => Promise.resolve('wg_orbstack_pat_s3cret'),
      authorizeTarget: (token, to) => {
        asked.push(`${token} ${to.href}`);
        return Promise.resolve(failure('not this instance'));
      },
    });

    expect(await credentials.resolveBearer(request, target)).toEqual({
      success: false,
      errors: [new Error('not this instance')],
    });
    expect(asked).toEqual(['wg_orbstack_pat_s3cret https://hub.example/mcp']);
  });

  describe('cosmoToken', () => {
    const hubUrl = 'https://hub.example/';
    const githubJob = {
      GITHUB_ACTIONS: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example/req?api-version=2.0',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req-token',
    };

    test('in a CI job, trades the job token at Hub for a Cosmo access token', async () => {
      const calls: string[] = [];
      const credentials = createCredentials({
        env: githubJob,
        loginToken: () => Promise.resolve('login'),
        fetchImpl: (input, init) => {
          calls.push(`${init?.method ?? 'GET'} ${String(input)} ${new Headers(init?.headers).get('authorization')}`);
          if (String(input).startsWith('https://token.example/')) {
            return Promise.resolve(Response.json({ value: 'gh-oidc' }));
          }
          return Promise.resolve(
            Response.json(
              { token: 'cosmo_ci_abc', expiresAt: '2026-11-24T10:10:00.000Z', namespace: 'prod' },
              { status: 201 },
            ),
          );
        },
      });

      expect(await credentials.cosmoToken({ ...request, hubUrl })).toEqual({
        success: true,
        data: { token: 'cosmo_ci_abc', expiresAt: '2026-11-24T10:10:00.000Z', namespace: 'prod' },
      });
      expect(calls).toEqual([
        'GET https://token.example/req?api-version=2.0&audience=hub bearer req-token',
        'POST https://hub.example/ci/cosmo-token Bearer gh-oidc',
      ]);
    });

    test('outside a CI job, asks Hub for nothing', async () => {
      const credentials = createCredentials({
        env: {},
        loginToken: () => Promise.resolve('login'),
        fetchImpl: () => Promise.reject(new Error('no request expected')),
      });

      expect(await credentials.cosmoToken({ ...request, hubUrl })).toEqual({ success: true, data: undefined });
    });

    test('reports why Hub refused the job', async () => {
      const credentials = createCredentials({
        env: { GITLAB_CI: 'true', HUB_ID_TOKEN: 'gl-oidc' },
        loginToken: () => Promise.resolve(undefined),
        fetchImpl: () => Promise.resolve(Response.json({ error: 'CI identity token rejected' }, { status: 401 })),
      });

      expect(await credentials.cosmoToken({ ...request, hubUrl })).toEqual({
        success: false,
        errors: [new Error('Hub gave this CI job no Cosmo access token (HTTP 401): CI identity token rejected')],
      });
    });
  });
});
