import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FakeHub, runWgc, startFakeHub, tempRepo } from './harness.js';

const sandboxYaml = `schema: shop
subgraphs:
  - name: products
    schema: products.graphql
  - name: reviews
    generate: "printf 'type Query { reviews: [String] }'"
    url: https://reviews.example.com/graphql
mocks:
  Product:   # kept exactly as written
    - { id: "1", name: "Lamp", price: 12.50 }
    - { id: "2", name: 'Desk' }
  Review: { body: "Great", rating: 5 }
`;

const pushed = {
  sandbox: { name: 'pr-42', url: 'https://hub.example/shop/sandboxes/pr-42' },
  composition: { errors: [], warnings: ['Product.price is unused'] },
};

let hub: FakeHub | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await hub?.close();
  hub = undefined;
});

describe('wgc hub schema push', () => {
  test('reads schema files, runs generate commands and posts them with the raw sandbox.yaml', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'sandbox.yaml': sandboxYaml,
      'products.graphql': 'type Query { products: [String] }\n',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'sandbox.yaml'), '--sha', 'abc123def4567890', '--json'],
      { hubUrl: hub.url },
    );

    expect(run.exitCode).toBe(0);
    expect(hub.requests).toEqual([
      {
        path: '/ci/schema-push',
        authorization: 'Bearer login-token',
        body: {
          sandboxYaml,
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
      'compose pr-42: Composed with 0 error(s) and 1 warning(s)',
    ]);
    expect(run.json()).toEqual({ status: 'success', sha: 'abc123def4567890', ...pushed });
  });

  test('authenticates with the GitHub Actions OIDC token for the configured audience', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'sandbox.yaml': 'schema: shop\naudience: hub-staging\nsubgraphs:\n  - name: a\n    schema: a.graphql\n',
      'a.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'sandbox.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
        caller: 'ci',
        env: {
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
      'sandbox.yaml': 'schema: shop\nsubgraphs:\n  - name: a\n    schema: a.graphql\n',
      'a.graphql': 'type Query { a: Int }',
    });
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('CI_COMMIT_SHA', 'gitlab-sha');

    const run = await runWgc(['hub', 'schema', 'push', '--config', path.join(dir, 'sandbox.yaml'), '--json'], {
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

  test('exits non-zero with the composition errors', async () => {
    hub = await startFakeHub({
      schemaPush: {
        sandbox: { name: 'pr-42', url: 'https://hub.example/shop/sandboxes/pr-42' },
        composition: { errors: ['Field "Query.a" is defined in two subgraphs'], warnings: [] },
      },
    });
    const dir = await tempRepo({
      'sandbox.yaml': 'schema: shop\nsubgraphs:\n  - name: a\n    schema: a.graphql\n',
      'a.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'sandbox.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
      },
    );

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({
      status: 'error',
      error: {
        message: 'Composition failed for sandbox pr-42:\n  - Field "Query.a" is defined in two subgraphs',
        input: 'sandbox.yaml',
        fix: 'Fix the subgraph schemas and push again. Details: https://hub.example/shop/sandboxes/pr-42',
      },
    });
  });

  test('fails before uploading when a generate command exits non-zero', async () => {
    hub = await startFakeHub({ schemaPush: pushed });
    const dir = await tempRepo({
      'sandbox.yaml': 'schema: shop\nsubgraphs:\n  - name: a\n    generate: echo broken >&2; exit 3\n',
    });

    const run = await runWgc(
      ['hub', 'schema', 'push', '--config', path.join(dir, 'sandbox.yaml'), '--sha', 's', '--json'],
      {
        hubUrl: hub.url,
      },
    );

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({
      status: 'error',
      error: {
        message: 'Subgraph a: `echo broken >&2; exit 3` exited with 3.\nbroken',
        input: 'echo broken >&2; exit 3',
        fix: 'Fix the `generate` command in sandbox.yaml so it prints the SDL and exits 0.',
      },
    });
    expect(hub.requests).toEqual([]);
  });

  test('names every invalid sandbox.yaml path and how to fix it', async () => {
    const dir = await tempRepo({
      'sandbox.yaml': [
        'subgraphs:',
        '  - name: a',
        '    schema: a.graphql',
        '    generate: echo',
        '  - name: b',
        'router:',
        '  source: { tag: v1 }',
        '',
      ].join('\n'),
    });
    const configPath = path.join(dir, 'sandbox.yaml');

    const run = await runWgc(['hub', 'schema', 'push', '--config', configPath, '--sha', 's', '--json']);

    expect(run.exitCode).toBe(1);
    expect(run.json()).toEqual({
      status: 'error',
      error: {
        message: [
          `${configPath} is invalid:`,
          '  schema: set `schema` to the Hub schema slug, e.g. `schema: shop`',
          '  subgraphs[0]: set exactly one of `schema` (a path to an SDL file) or `generate` (a command that prints the SDL)',
          '  subgraphs[1]: set exactly one of `schema` (a path to an SDL file) or `generate` (a command that prints the SDL)',
          '  router.source: set exactly one of `release: <version>`, `rc: <tag>` or `commit: <sha>`',
        ].join('\n'),
        input: configPath,
        fix: `Edit ${configPath} at the paths above and rerun.`,
      },
    });
  });
});
