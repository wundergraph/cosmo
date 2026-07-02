import { readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import FetchCommand from '../../../src/commands/graph/federated-graph/commands/fetch.js';
import { Client } from '../../../src/core/client/client.js';
import {
  FIXTURES_DIR_PATH,
  ROUTER_SDL,
  CLIENT_SDL,
  mockFetchRouterConfig,
  mockGenerateRouterToken,
} from '../../router/utils.js';

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

describe('federated-graph fetch command tests', () => {
  afterEach(vi.clearAllMocks);

  test('that router config matches expected snapshot when config splitting is disabled', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport(false)),
    };

    global.fetch = vi.fn(mockFetchRouterConfig);

    let outputDir = join(tmpdir(), 'federated-graph-fetch');
    if (existsSync(outputDir)) {
      await rm(outputDir, { recursive: true });
    }

    const program = new Command();

    program.addCommand(FetchCommand({ client }));
    await program.parseAsync(['fetch', 'fake-graph', '-o', outputDir], {
      from: 'user',
    });

    outputDir = join(outputDir, 'fake-graph-default');
    expect(existsSync(outputDir)).toBe(true);
    expect(existsSync(join(outputDir, 'cosmo-composition.yaml'))).toBe(true);
    expect(existsSync(join(outputDir, 'supergraph'))).toBe(true);
    expect(existsSync(join(outputDir, 'supergraph', 'cosmoConfig.json'))).toBe(true);

    // The output file must match the expected snapshot
    const content = await readFile(join(outputDir, 'supergraph', 'cosmoConfig.json'), 'utf8');
    await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', `router-config.json.snap`));
  });

  test('that router config matches expected snapshot when config splitting is enabled ', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport(true)),
    };

    global.fetch = vi.fn(mockFetchRouterConfig);

    let outputDir = join(tmpdir(), 'federated-graph-fetch-split');
    if (existsSync(outputDir)) {
      await rm(outputDir, { recursive: true });
    }

    const program = new Command();

    program.addCommand(FetchCommand({ client }));
    await program.parseAsync(['fetch', 'fake-graph', '-o', outputDir], {
      from: 'user',
    });

    outputDir = join(outputDir, 'fake-graph-default');
    expect(existsSync(outputDir)).toBe(true);
    expect(existsSync(join(outputDir, 'cosmo-composition.yaml'))).toBe(true);
    expect(existsSync(join(outputDir, 'cosmo-mapper.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'supergraph'))).toBe(true);
    expect(existsSync(join(outputDir, 'supergraph', 'cosmoConfig.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags', 'my-feature-flag.json'))).toBe(true);

    // All output files should match the snapshots
    await expectSplitOutputMatchSnapshot(join(outputDir, 'supergraph', 'cosmoConfig.json'), 'router-config.json');
    await expectSplitOutputMatchSnapshot(join(outputDir, 'cosmo-mapper.json'), 'mapper.json');
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
