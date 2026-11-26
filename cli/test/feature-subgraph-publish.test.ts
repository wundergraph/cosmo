import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PlatformService,
  type PublishFederatedSubgraphRequest,
  SubgraphType,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import PublishFeatureSubgraph from '../src/commands/feature-subgraph/commands/publish.js';
import { Client } from '../src/core/client/client.js';

async function runPublish(args: string[]): Promise<PublishFederatedSubgraphRequest[]> {
  const requests: PublishFederatedSubgraphRequest[] = [];
  const client: Client = {
    platform: createClient(
      PlatformService,
      createRouterTransport(({ service }) => {
        service(PlatformService, {
          publishFederatedSubgraph: (request) => {
            requests.push(request);
            return { response: { code: EnumStatusCode.OK } };
          },
        });
      }),
    ),
  };
  const program = new Command();
  program.addCommand(PublishFeatureSubgraph({ client }));
  await program.parseAsync(['publish', ...args], { from: 'user' });
  return requests;
}

describe('feature-subgraph publish', () => {
  test('publishes a gRPC feature subgraph with the proto files from its generated folder', async (testContext) => {
    const dir = mkdtempSync(join(tmpdir(), 'fsg-grpc-'));
    testContext.onTestFinished(() => rmSync(dir, { recursive: true }));
    const schemaPath = join(dir, 'carrier.graphql');
    const generatedDir = join(dir, 'generated');
    writeFileSync(schemaPath, 'type Query { carrier: String }');
    mkdirSync(generatedDir);
    writeFileSync(join(generatedDir, 'service.proto'), 'syntax = "proto3";');
    writeFileSync(join(generatedDir, 'mapping.json'), '{"version":1}');
    writeFileSync(join(generatedDir, 'service.proto.lock.json'), '{"version":"1.0.0"}');

    const requests = await runPublish([
      'carrier-override',
      '--schema',
      schemaPath,
      '--generated',
      generatedDir,
      '--subgraph',
      'carrier',
      '--routing-url',
      'dns:///carrier-override:4011',
    ]);

    expect(
      requests.map(({ name, baseSubgraphName, isFeatureSubgraph, type, schema, routingUrl, proto }) => ({
        name,
        baseSubgraphName,
        isFeatureSubgraph,
        type,
        schema,
        routingUrl,
        proto: { schema: proto?.schema, mappings: proto?.mappings, lock: proto?.lock },
      })),
    ).toEqual([
      {
        name: 'carrier-override',
        baseSubgraphName: 'carrier',
        isFeatureSubgraph: true,
        type: SubgraphType.GRPC_SERVICE,
        schema: 'type Query { carrier: String }',
        routingUrl: 'dns:///carrier-override:4011',
        proto: { schema: 'syntax = "proto3";', mappings: '{"version":1}', lock: '{"version":"1.0.0"}' },
      },
    ]);
  });

  test('publishes a GraphQL feature subgraph without proto files', async (testContext) => {
    const dir = mkdtempSync(join(tmpdir(), 'fsg-standard-'));
    testContext.onTestFinished(() => rmSync(dir, { recursive: true }));
    const schemaPath = join(dir, 'products.graphql');
    writeFileSync(schemaPath, 'type Query { products: String }');

    const requests = await runPublish(['products-override', '--schema', schemaPath]);

    expect(requests.map(({ name, type, proto }) => ({ name, type, proto }))).toEqual([
      { name: 'products-override', type: SubgraphType.STANDARD, proto: undefined },
    ]);
  });
});
