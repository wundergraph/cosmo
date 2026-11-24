import { afterEach, describe, expect, test } from 'vitest';
import { FakeHub, githubActionsEnv, hubHooks, runWgc, startFakeHub, tempRepo } from './harness.js';

let hub: FakeHub | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

const sandboxAnswer = (passed: number, failed: number) => ({
  pullRequest: { number: 12, url: 'https://github.com/acme/shop/pull/12' },
  sandbox: {
    name: 'pr-shop-12',
    endpointUrl: 'https://pr-shop-12.sandbox.example/graphql',
    hubUrl: 'https://hub.example/acme/graph/shop?view=pr-shop-12',
    passed,
    failed,
    problem: null,
  },
});

const checkRun = async (env: (url: string) => NodeJS.ProcessEnv, passed = true) => {
  const dir = await tempRepo({ 'products.graphql': 'type Query { products: [String] }\n' });
  const { after, context } = hubHooks({ hubUrl: hub!.url, env: env(hub!.url) });
  const [hook] = after['subgraph check'];
  return await hook({
    command: 'subgraph check',
    context,
    input: { subgraph: 'products', namespace: 'staging', schemaPath: `${dir}/products.graphql`, delete: false },
    result: {
      passed,
      checkUrl: 'https://cosmo.example/acme/staging/graph/shop/checks/c1',
      problems: passed ? [] : ['breaking change: Field "Query.products" was removed'],
    },
  });
};

describe('the hub plugin hooking wgc subgraph check', () => {
  test('in CI it sends the checked SDL and Cosmo verdict with the job token and passes with the sandbox', async () => {
    hub = await startFakeHub({ ci: { '/ci/subgraph-check': { status: 200, body: sandboxAnswer(3, 0) } } });

    const contribution = await checkRun(githubActionsEnv, false);

    expect(contribution).toEqual({
      verdict: 'passed',
      summary: 'sandbox pr-shop-12 is up to date, 3 of 3 operations passed',
      details: [
        'pull request #12: https://github.com/acme/shop/pull/12',
        'endpoint: https://pr-shop-12.sandbox.example/graphql',
      ],
      url: 'https://hub.example/acme/graph/shop?view=pr-shop-12',
      data: {
        pullRequest: { number: 12, url: 'https://github.com/acme/shop/pull/12' },
        sandbox: {
          name: 'pr-shop-12',
          endpointUrl: 'https://pr-shop-12.sandbox.example/graphql',
          passed: 3,
          failed: 0,
        },
        problem: null,
      },
    });
    const sent = hub.requests.filter((request) => request.path === '/ci/subgraph-check');
    expect(sent).toEqual([
      {
        path: '/ci/subgraph-check',
        authorization: 'Bearer github-oidc-token',
        body: {
          subgraph: 'products',
          namespace: 'staging',
          sdl: 'type Query { products: [String] }\n',
          cosmo: {
            ok: false,
            url: 'https://cosmo.example/acme/staging/graph/shop/checks/c1',
            problems: ['breaking change: Field "Query.products" was removed'],
          },
        },
      },
    ]);
  });

  test('failed operations in the sandbox fail the check', async () => {
    hub = await startFakeHub({ ci: { '/ci/subgraph-check': { status: 200, body: sandboxAnswer(2, 1) } } });

    const contribution = await checkRun(githubActionsEnv);

    expect(contribution).toMatchObject({
      verdict: 'failed',
      summary: '1 of 3 operations failed in sandbox pr-shop-12',
    });
  });

  test('a run on no pull request adds a note and passes', async () => {
    hub = await startFakeHub({ ci: { '/ci/subgraph-check': { status: 200, body: { pullRequest: null } } } });

    const contribution = await checkRun(githubActionsEnv);

    expect(contribution).toEqual({
      verdict: 'info',
      summary: 'this run belongs to no pull request, so no sandbox was updated',
    });
  });

  test('Hub refusing the run fails the check with Hub’s reason', async () => {
    hub = await startFakeHub({
      ci: { '/ci/subgraph-check': { status: 409, body: { error: 'acme/shop is connected to no graph' } } },
    });

    const contribution = await checkRun(githubActionsEnv);

    expect(contribution).toEqual({
      verdict: 'failed',
      summary: 'Hub answered HTTP 409: acme/shop is connected to no graph',
    });
  });

  test('outside CI it adds nothing and asks Hub for nothing', async () => {
    hub = await startFakeHub({});

    const contribution = await checkRun(() => ({}));

    expect(contribution).toBeUndefined();
    expect(hub.requests).toEqual([]);
  });
});

const publish = (hubUrl: string, published: boolean) => {
  const { after, context } = hubHooks({ hubUrl, env: githubActionsEnv(hubUrl) });
  const [hook] = after['subgraph publish'];
  return hook({
    command: 'subgraph publish',
    context,
    input: { subgraph: 'products', namespace: 'staging', schemaPath: 'products.graphql', routingUrl: undefined },
    result: { published, changed: true, compositionErrors: [] },
  });
};

describe('the hub plugin hooking wgc subgraph publish', () => {
  test('in CI Hub follows the published subgraph', async () => {
    hub = await startFakeHub({
      ci: {
        '/ci/subgraph-publish': {
          status: 200,
          body: { graph: { slug: 'shop', hubUrl: 'https://hub.example/acme/graph/shop' }, inSync: true },
        },
      },
    });

    const contribution = await publish(hub.url, true);

    expect(contribution).toEqual({
      verdict: 'passed',
      summary: 'shop in Hub has this schema',
      url: 'https://hub.example/acme/graph/shop',
      data: { graph: { slug: 'shop', hubUrl: 'https://hub.example/acme/graph/shop' }, inSync: true },
    });
    expect(hub.requests.filter((request) => request.path === '/ci/subgraph-publish')).toEqual([
      {
        path: '/ci/subgraph-publish',
        authorization: 'Bearer github-oidc-token',
        body: { subgraph: 'products', namespace: 'staging' },
      },
    ]);
  });

  test('Hub not taking the schema fails the publish', async () => {
    hub = await startFakeHub({
      ci: {
        '/ci/subgraph-publish': {
          status: 200,
          body: { graph: { slug: 'shop', hubUrl: 'https://hub.example/acme/graph/shop' }, inSync: false },
        },
      },
    });

    expect(await publish(hub.url, true)).toMatchObject({
      verdict: 'failed',
      summary: "shop in Hub did not take the published schema; Cosmo's schema webhook has not reached Hub",
    });
  });

  test('a publish Cosmo refused tells Hub nothing', async () => {
    hub = await startFakeHub({});

    expect(await publish(hub.url, false)).toBeUndefined();
    expect(hub.requests).toEqual([]);
  });
});

describe('wgc hub schema push', () => {
  test('is gone', async () => {
    await expect(runWgc(['hub', 'schema', 'push'])).rejects.toMatchObject({ code: 'commander.unknownCommand' });
  });
});
