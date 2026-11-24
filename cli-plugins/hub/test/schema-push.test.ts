import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FakeHub, runWgc, startFakeHub, tempRepo } from './harness.js';

const wundergraphYaml = `graph: shop
subgraphs:
  - name: products
    schema: { file: products.graphql }
  - name: reviews
    schema: { command: "printf 'type Query { reviews: [String] }'" }
    routing_url: https://reviews.example.com/graphql
mocks:
  Product:   # kept exactly as written
    - { id: "1", name: "Lamp", price: 12.50 }
    - { id: "2", name: 'Desk' }
  Review: { body: "Great", rating: 5 }
`;

const minimalYaml = 'graph: shop\nsubgraphs:\n  - name: a\n    schema: { file: a.graphql }\n';

const pushed = {
  target: 'sandbox',
  sandboxName: 'pr-42',
  endpointUrl: 'https://hub.example/s/pr-42/graphql',
  hubUrl: 'https://hub.example/shop/sandboxes/pr-42',
  passed: 3,
  failed: 0,
};

let hub: FakeHub | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await hub?.close();
  hub = undefined;
});

describe('wgc hub schema push', () => {
  test('reads schema files, runs schema commands and posts them with the raw wundergraph.yaml', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'wundergraph.yaml': wundergraphYaml,
      'products.graphql': 'type Query { products: [String] }\n',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--sha', 'abc123def4567890', '--json'],
      { hubUrl: hub.url },
    );

    expect(run.exitCode).toBe(0);
    expect(hub.requests).toEqual([
      {
        path: '/ci/schema-push',
        authorization: 'Bearer login-token',
        body: {
          sandboxYaml: wundergraphYaml,
          subgraphs: [
            { name: 'products', sdl: 'type Query { products: [String] }\n' },
            { name: 'reviews', sdl: 'type Query { reviews: [String] }' },
          ],
          sha: 'abc123def4567890',
        },
      },
    ]);
    expect(run.progress()).toEqual([
      'read products: Reading products.graphql',
      "generate reviews: Running printf 'type Query { reviews: [String] }'",
      'upload shop: Uploading 2 subgraphs at abc123def456',
      'collections pr-42: Collections: 3 passed, 0 failed',
    ]);
    expect(run.json()).toEqual({ ok: true, data: { sha: 'abc123def4567890', ...pushed } });
  });

  test('authenticates with the GitHub Actions OIDC token for the audience in HUB_OIDC_AUDIENCE', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'wundergraph.yaml': minimalYaml,
      'a.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
        caller: 'ci',
        env: {
          HUB_OIDC_AUDIENCE: 'hub-staging',
          GITHUB_ACTIONS: 'true',
          ACTIONS_ID_TOKEN_REQUEST_URL: `${hub.url}/oidc`,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-token',
        },
        loginToken: '',
      },
    );

    expect(run.exitCode).toBe(0);
    expect(hub.requests.map((request) => [request.path, request.authorization])).toEqual([
      ['/oidc?audience=hub-staging', 'bearer runner-token'],
      ['/ci/schema-push', 'Bearer github-oidc-token'],
    ]);
  });

  test('authenticates with the GitLab id_tokens entry and takes the sha from CI_COMMIT_SHA', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'wundergraph.yaml': minimalYaml,
      'a.graphql': 'type Query { a: Int }',
    });
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('CI_COMMIT_SHA', 'gitlab-sha');

    const run = await runWgc(['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--json'], {
      hubUrl: hub.url,
      caller: 'ci',
      env: { GITLAB_CI: 'true', HUB_ID_TOKEN: 'gitlab-oidc-token' },
      loginToken: '',
    });

    expect(run.exitCode).toBe(0);
    expect(hub.requests.map((request) => [request.authorization, request.body.sha])).toEqual([
      ['Bearer gitlab-oidc-token', 'gitlab-sha'],
    ]);
  });

  test('exits non-zero when collection operations fail in the sandbox', async () => {
    hub = await startFakeHub({ schemaPush: { ...pushed, passed: 2, failed: 1 } });
    const dir = await tempRepo({
      'wundergraph.yaml': minimalYaml,
      'a.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
      },
    );

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'COLLECTIONS_FAILED',
        message: '1 collection operation(s) failed in sandbox pr-42',
        input: 'wundergraph.yaml',
        remediation: 'Open the sandbox in Hub to see which operations failed.',
      },
      url: 'https://hub.example/shop/sandboxes/pr-42',
    });
  });

  test('reports the schema a push to the default branch updated', async () => {
    hub = await startFakeHub({ schemaPush: { target: 'schema', graphSlug: 'shop' } });
    const dir = await tempRepo({
      'wundergraph.yaml': minimalYaml,
      'a.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--sha', 'abc', '--json'],
      { hubUrl: hub.url },
    );

    expect(run.exitCode).toBe(0);
    expect(run.json()).toEqual({ ok: true, data: { sha: 'abc', target: 'schema', graphSlug: 'shop' } });
  });

  test('fails before uploading when a schema command exits non-zero', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'wundergraph.yaml': 'graph: shop\nsubgraphs:\n  - name: a\n    schema: { command: "echo broken >&2; exit 3" }\n',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'wundergraph.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
      },
    );

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'Subgraph a: `echo broken >&2; exit 3` exited with 3.\nbroken',
        input: 'echo broken >&2; exit 3',
        remediation: 'Fix the `schema.command` in wundergraph.yaml so it prints the SDL and exits 0.',
      },
    });
    expect(hub.requests).toEqual([]);
  });
});
