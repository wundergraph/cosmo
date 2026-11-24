import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import {
  CheckSubgraphSchemaResponseSchema,
  IsGitHubAppInstalledResponseSchema,
  PlatformService,
  PublishFederatedSubgraphResponseSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import CheckSchema from '../src/commands/subgraph/commands/check.js';
import PublishSchema from '../src/commands/subgraph/commands/publish.js';

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wgc-config-'));
  writeFileSync(join(dir, 'products.graphql'), 'type Query { products: [String] }\n');
  writeFileSync(
    join(dir, 'wundergraph.yaml'),
    [
      'graph: shop',
      'namespace: staging',
      'subgraphs:',
      '  - name: products',
      '    schema: { file: products.graphql }',
      '    routing_url: https://products.shop.dev/graphql',
      '  - name: reviews',
      `    schema: { command: "printf 'type Query { reviews: [String] }'" }`,
      '',
    ].join('\n'),
  );
  return dir;
};

type Sent = { subgraph: string; namespace: string; schema: string; routingUrl?: string };

const platform = (sent: Sent[], failing: string | undefined) =>
  createClient(
    PlatformService,
    createRouterTransport(({ service }) => {
      service(PlatformService, {
        checkSubgraphSchema: (request) => {
          sent.push({
            subgraph: request.subgraphName,
            namespace: request.namespace,
            schema: new TextDecoder().decode(request.schema),
          });
          return create(CheckSubgraphSchemaResponseSchema, {
            response: { code: EnumStatusCode.OK },
            breakingChanges:
              request.subgraphName === failing
                ? [{ changeType: 'FIELD_REMOVED', message: 'Field removed', isBreaking: true }]
                : [],
            operationUsageStats: { totalOperations: 1, safeOperations: 0, firstSeenAt: '', lastSeenAt: '' },
          });
        },
        publishFederatedSubgraph: (request) => {
          sent.push({
            subgraph: request.name,
            namespace: request.namespace ?? '',
            schema: request.schema ?? '',
            routingUrl: request.routingUrl,
          });
          return create(PublishFederatedSubgraphResponseSchema, { response: { code: EnumStatusCode.OK } });
        },
        isGitHubAppInstalled: () =>
          create(IsGitHubAppInstalledResponseSchema, { response: { code: EnumStatusCode.OK }, isInstalled: false }),
      });
    }),
  );

describe('subgraph check and publish --config', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('check checks every subgraph of wundergraph.yaml in its namespace, a command source by its output', async () => {
    const sent: Sent[] = [];
    const program = new Command();
    program.addCommand(CheckSchema({ client: { platform: platform(sent, undefined) } }));

    await program.parseAsync(['check', '--config', join(repo(), 'wundergraph.yaml')], { from: 'user' });

    expect(sent).toEqual([
      { subgraph: 'products', namespace: 'staging', schema: 'type Query { products: [String] }\n' },
      { subgraph: 'reviews', namespace: 'staging', schema: 'type Query { reviews: [String] }' },
    ]);
    expect(process.exitCode).toBe(0);
  });

  test('a failing subgraph fails the run after every subgraph was checked', async () => {
    const sent: Sent[] = [];
    const program = new Command();
    program.addCommand(CheckSchema({ client: { platform: platform(sent, 'products') } }));

    await program.parseAsync(['check', '--config', join(repo(), 'wundergraph.yaml')], { from: 'user' });

    expect(sent.map((request) => request.subgraph)).toEqual(['products', 'reviews']);
    expect(process.exitCode).toBe(1);
  });

  test('a name with --config checks only that subgraph of the file', async () => {
    const sent: Sent[] = [];
    const program = new Command();
    program.addCommand(CheckSchema({ client: { platform: platform(sent, undefined) } }));

    await program.parseAsync(['check', 'reviews', '--config', join(repo(), 'wundergraph.yaml')], { from: 'user' });

    expect(sent.map((request) => request.subgraph)).toEqual(['reviews']);
  });

  test('publish publishes every subgraph with its routing_url', async () => {
    const sent: Sent[] = [];
    const program = new Command();
    program.addCommand(PublishSchema({ client: { platform: platform(sent, undefined) } }));

    await program.parseAsync(['publish', '--config', join(repo(), 'wundergraph.yaml')], { from: 'user' });

    expect(sent).toEqual([
      {
        subgraph: 'products',
        namespace: 'staging',
        schema: 'type Query { products: [String] }\n',
        routingUrl: 'https://products.shop.dev/graphql',
      },
      { subgraph: 'reviews', namespace: 'staging', schema: 'type Query { reviews: [String] }', routingUrl: undefined },
    ]);
    expect(process.exitCode).toBe(0);
  });
});
