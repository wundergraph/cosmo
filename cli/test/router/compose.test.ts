import { readFileSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { beforeEach, afterEach, describe, expect, onTestFinished, test, vi, type MockInstance } from 'vitest';
import { type PartialMessage } from '@bufbuild/protobuf';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { CheckSubgraphSchemaResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { resolve } from 'pathe';
import { config } from '../../src/core/config.js';
import ComposeCommand from '../../src/commands/router/commands/compose.js';
import { Client } from '../../src/core/client/client.js';

const FIXTURES_DIR_PATH = resolve('./test/fixtures');

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('router compose command', () => {
  test('that generated router config matches expected snapshot when config splitting is disabled', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const outputFile = join(tmpdir(), 'router-config.json');
    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    program.parse(['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputFile], {
      from: 'user',
    });

    // The output file must match the expected snapshot
    const content = readFileSync(outputFile, 'utf8');
    await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', `router-config.json.snap`));
  });

  test('that generated router config matches expected snapshot when config splitting is enabled ', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const outputDir = join(tmpdir(), 'router-config-split');
    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    program.parse(
      ['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputDir, '--split-configs-enabled'],
      {
        from: 'user',
      },
    );

    // All output files should match the snapshots
    await expectSplitOutputMatchSnapshot(outputDir, 'router-config.json');
    await expectSplitOutputMatchSnapshot(outputDir, 'router-config-mapper.json');
    await expectSplitOutputMatchSnapshot(outputDir, join('feature-flags', 'my-feature-flag.json'));
  });
});

function expectSplitOutputMatchSnapshot(outputDir: string, name: string) {
  const content = readFileSync(join(outputDir, name), 'utf8');
  return expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', 'split-config', `${name}.snap`));
}
