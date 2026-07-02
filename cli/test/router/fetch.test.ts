import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import FetchCommand from '../../src/commands/router/commands/fetch.js';
import { Client } from '../../src/core/client/client.js';
import { FIXTURES_DIR_PATH, ROUTER_SDL, CLIENT_SDL, mockFetchRouterConfig, mockGenerateRouterToken } from './utils.js';

export const mockPlatformTransport = (splitConfigsEnabled: boolean) =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      getFederatedGraphSDLByName(_) {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: ROUTER_SDL,
          clientSchema: CLIENT_SDL,
        };
      },
      getSubgraphSDLFromLatestComposition(_) {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
      getFederatedGraphByName(_) {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          federatedGraph: {
            id: 'id',
            name: 'name',
            composition: {
              compositionId: 'compositionId',
              compositionVersionId: 'compositionVersionId',
            },
          },
        };
      },
      generateRouterToken(ctx) {
        return mockGenerateRouterToken(splitConfigsEnabled, ctx);
      },
    });
  });

describe('router fetch command tests', () => {
  afterEach(vi.clearAllMocks);

  test('that router config matches expected snapshot when config splitting is disabled', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport(false)),
    };

    global.fetch = vi.fn(mockFetchRouterConfig);

    const outputDir = join(tmpdir(), 'router-fetch');
    const outputFile = join(outputDir, 'latest.json');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const program = new Command();

    program.addCommand(FetchCommand({ client }));
    await program.parseAsync(['fetch', 'fake-graph', '-o', outputFile], {
      from: 'user',
    });

    expect(existsSync(outputFile)).toBe(true);

    // The output file must match the expected snapshot
    const content = await readFile(outputFile, 'utf8');
    await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', `router-config.json.snap`));
  });

  test('that router config matches expected snapshot when config splitting is enabled ', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport(true)),
    };

    global.fetch = vi.fn(mockFetchRouterConfig);

    const outputDir = join(tmpdir(), 'router-fetch-split');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir);
    }

    const program = new Command();

    program.addCommand(FetchCommand({ client }));
    await program.parseAsync(['fetch', 'fake-graph', '-o', outputDir], {
      from: 'user',
    });

    expect(existsSync(outputDir)).toBe(true);
    expect(existsSync(join(outputDir, 'mapper.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'latest.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags', 'my-feature-flag.json'))).toBe(true);

    // All output files should match the snapshots
    await expectSplitOutputMatchSnapshot(join(outputDir, 'latest.json'), 'router-config.json');
    await expectSplitOutputMatchSnapshot(join(outputDir, 'mapper.json'), 'mapper.json');
    await expectSplitOutputMatchSnapshot(
      join(outputDir, 'feature-flags', 'my-feature-flag.json'),
      join('feature-flags', 'my-feature-flag.json'),
    );
  });
});

async function expectSplitOutputMatchSnapshot(file: string, name: string) {
  const content = await readFile(file, 'utf8');
  await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', 'split-config', `${name}.snap`));
}
