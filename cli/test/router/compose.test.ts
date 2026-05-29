import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { resolve } from 'pathe';
import ComposeCommand from '../../src/commands/router/commands/compose.js';
import { Client } from '../../src/core/client/client.js';
import { FIXTURES_DIR_PATH } from './utils.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('router compose command tests', () => {
  test('that generated router config matches expected snapshot when config splitting is disabled', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const outputDir = join(tmpdir(), 'router-compose');
    const outputFile = join(outputDir, 'router-config.json');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir);
    }

    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    await program.parseAsync(['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputFile], {
      from: 'user',
    });

    expect(existsSync(outputFile)).toBe(true);

    // The output file must match the expected snapshot
    const content = await readFile(outputFile, 'utf8');
    await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', `router-config.json.snap`));
  });

  test('that generated router config matches expected snapshot when config splitting is enabled ', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const outputDir = join(tmpdir(), 'router-compose-split');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir);
    }

    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    await program.parseAsync(
      ['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputDir, '--split-configs-enabled'],
      {
        from: 'user',
      },
    );

    expect(existsSync(outputDir)).toBe(true);
    expect(existsSync(join(outputDir, 'router-config.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'mapper.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags', 'my-feature-flag.json'))).toBe(true);

    // All output files should match the snapshots
    await expectSplitOutputMatchSnapshot(outputDir, 'router-config.json');
    await expectSplitOutputMatchSnapshot(outputDir, 'mapper.json');
    await expectSplitOutputMatchSnapshot(outputDir, join('feature-flags', 'my-feature-flag.json'));
  });
});

async function expectSplitOutputMatchSnapshot(outputDir: string, name: string) {
  const content = await readFile(join(outputDir, name), 'utf8');
  await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', 'split-config', `${name}.snap`));
}
