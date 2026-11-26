import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  type PublishFederatedSubgraphRequest,
  SubgraphType,
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

const grpcRepo = (files: { lock: boolean }) => {
  const dir = mkdtempSync(join(tmpdir(), 'wgc-config-grpc-'));
  mkdirSync(join(dir, 'carrier', 'generated'), { recursive: true });
  writeFileSync(join(dir, 'carrier', 'schema.graphql'), 'type Query { carrier: String }\n');
  writeFileSync(join(dir, 'carrier', 'generated', 'service.proto'), 'syntax = "proto3";\n');
  writeFileSync(join(dir, 'carrier', 'generated', 'mapping.json'), '{"version":1}\n');
  if (files.lock) {
    writeFileSync(join(dir, 'carrier', 'generated', 'service.proto.lock.json'), '{"version":"1.0.0"}\n');
  }
  writeFileSync(
    join(dir, 'wundergraph.yaml'),
    [
      'graph: shop',
      'subgraphs:',
      '  - name: carrier',
      '    kind: grpc',
      '    schema: { file: carrier/schema.graphql }',
      '    proto: carrier/generated/service.proto',
      '    mapping: carrier/generated/mapping.json',
      '    routing_url: dns:///carrier:4011',
      '',
    ].join('\n'),
  );
  return dir;
};

const publishRequests = async (dir: string) => {
  const requests: PublishFederatedSubgraphRequest[] = [];
  const client = createClient(
    PlatformService,
    createRouterTransport(({ service }) => {
      service(PlatformService, {
        publishFederatedSubgraph: (request) => {
          requests.push(request);
          return create(PublishFederatedSubgraphResponseSchema, { response: { code: EnumStatusCode.OK } });
        },
      });
    }),
  );
  const program = new Command();
  program.addCommand(PublishSchema({ client: { platform: client } }));
  await program.parseAsync(['publish', '--config', join(dir, 'wundergraph.yaml')], { from: 'user' });
  return requests;
};

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

  describe('a kind: grpc subgraph', () => {
    test('publish sends it as a gRPC service with its proto, mapping and the lock beside the proto', async (testContext) => {
      const dir = grpcRepo({ lock: true });
      testContext.onTestFinished(() => rmSync(dir, { recursive: true }));

      const requests = await publishRequests(dir);

      expect(
        requests.map(({ name, schema, routingUrl, type, proto }) => ({
          name,
          schema,
          routingUrl,
          type,
          proto: { schema: proto?.schema, mappings: proto?.mappings, lock: proto?.lock },
        })),
      ).toEqual([
        {
          name: 'carrier',
          schema: 'type Query { carrier: String }\n',
          routingUrl: 'dns:///carrier:4011',
          type: SubgraphType.GRPC_SERVICE,
          proto: { schema: 'syntax = "proto3";\n', mappings: '{"version":1}\n', lock: '{"version":"1.0.0"}\n' },
        },
      ]);
      expect(process.exitCode).toBe(0);
    });

    test('publish fails for it without a request when the lock is not committed beside the proto', async (testContext) => {
      const dir = grpcRepo({ lock: false });
      testContext.onTestFinished(() => rmSync(dir, { recursive: true }));
      const errors = vi.spyOn(process.stderr, 'write');

      const requests = await publishRequests(dir);

      expect(requests).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errors.mock.calls.flat().join('\n')).toContain(
        `The proto lock file '${join(dir, 'carrier', 'generated', 'service.proto.lock.json')}' does not exist.`,
      );
    });
  });
});
