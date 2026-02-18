/* eslint-disable no-template-curly-in-string */
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import ComposeRouterConfig from '../src/commands/router/commands/compose.js';
import { Client } from '../src/core/client/client.js';

const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('router compose with env var interpolation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('expands env vars in routing_url', async (testContext) => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const tmpDir = join(tmpdir(), `compose-env-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    testContext.onTestFinished(() => {
      rmdirSync(tmpDir, { recursive: true });
    });

    writeFileSync(join(tmpDir, 'subgraph.graphql'), 'type Query { hello: String }');

    writeFileSync(
      join(tmpDir, 'graph.yaml'),
      `version: 1
subgraphs:
  - name: myservice
    routing_url: http://\${HOST}:\${PORT}/graphql
    schema:
      file: ./subgraph.graphql
`,
    );

    process.env.HOST = 'localhost';
    process.env.PORT = '4001';

    const outFile = join(tmpDir, 'router.json');
    const program = new Command();
    program.addCommand(ComposeRouterConfig({ client }));

    await program.parseAsync(['compose', '-i', join(tmpDir, 'graph.yaml'), '-o', outFile], { from: 'user' });

    expect(existsSync(outFile)).toBe(true);

    const config = JSON.parse(readFileSync(outFile, 'utf8'));
    const subgraph = config.subgraphs[0];
    expect(subgraph.routingUrl).toBe('http://localhost:4001/graphql');
  });
});
