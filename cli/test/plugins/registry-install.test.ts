import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Command } from 'commander';
import { execa } from 'execa';
import { join } from 'pathe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import PluginCommands from '../../src/commands/plugins/index.js';
import { runNpm } from '../../src/core/plugins/npm.js';
import { createMemoryStream, createTempDir } from './utils.js';

afterEach(() => {
  process.exitCode = undefined;
});

/** Packs a package with `files` into `outputDir/tarballName`. */
const packPackage = async (outputDir: string, tarballName: string, files: Record<string, string>) => {
  const directory = createTempDir();
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content);
  }
  const packed = await execa('npm', ['pack', '--pack-destination', outputDir], { cwd: directory });
  const packedName = packed.stdout.trim().split('\n').at(-1)!;
  await execa('mv', [join(outputDir, packedName), join(outputDir, tarballName)]);
};

const serveDirectory = async (directory: string) => {
  const requested: string[] = [];
  const server = createServer((request, response) => {
    requested.push(request.url ?? '');
    try {
      const body = readFileSync(join(directory, request.url ?? ''));
      response.writeHead(200, { 'content-type': 'application/gzip' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/cli`, requested, close: () => server.close() };
};

describe('wgc plugins install from WGC_PLUGIN_REGISTRY_URL', () => {
  test(
    'installs the plugin tarball with the SDK tarball from the same URL and no npm registry',
    {
      timeout: 120_000,
    },
    async () => {
      const tarballs = join(createTempDir(), 'cli');
      mkdirSync(tarballs);
      await packPackage(tarballs, 'wgc-plugin-sdk.tgz', {
        'package.json': JSON.stringify({
          name: '@wundergraph/wgc-plugin-sdk',
          version: '0.1.0',
          type: 'module',
          main: 'index.js',
        }),
        'index.js': 'export const definePlugin = (plugin) => plugin;\n',
      });
      await packPackage(tarballs, 'wgc-plugin-relay.tgz', {
        'package.json': JSON.stringify({
          name: '@acme/wgc-plugin-relay',
          version: '2.0.0',
          type: 'module',
          main: 'index.js',
          keywords: ['wgc-plugin'],
          dependencies: { '@wundergraph/wgc-plugin-sdk': '0.1.0' },
        }),
        'index.js':
          "import { definePlugin } from '@wundergraph/wgc-plugin-sdk';\nexport default definePlugin({ name: 'relay', description: 'Relays', register() {} });\n",
      });
      const server = await serveDirectory(join(tarballs, '..'));
      vi.stubEnv('npm_config_registry', 'http://127.0.0.1:9/');
      // npm asks the registry about the SDK, gets nothing and keeps the tarball; no retries keeps the test fast.
      vi.stubEnv('npm_config_fetch_retries', '0');

      const managedDir = join(createTempDir(), 'plugins');
      const stdout = createMemoryStream();
      const program = new Command('wgc');
      program.exitOverride();
      program.addCommand(
        PluginCommands({
          environment: { managedDir, workspaceRoot: undefined, runsFromSource: false, registryUrl: server.url },
          npm: runNpm,
          caller: 'script',
          stdout,
          stderr: createMemoryStream(),
        }),
      );

      try {
        await program.parseAsync(['node', 'wgc', 'plugins', 'install', 'relay']);
      } finally {
        server.close();
      }

      expect(JSON.parse(stdout.text())).toEqual({
        ok: true,
        data: {
          plugin: {
            name: 'relay',
            packageName: '@acme/wgc-plugin-relay',
            version: '2.0.0',
            directory: join(managedDir, 'node_modules', '@acme/wgc-plugin-relay'),
          },
        },
      });
      expect([...new Set(server.requested)].sort()).toEqual(['/cli/wgc-plugin-relay.tgz', '/cli/wgc-plugin-sdk.tgz']);
      expect(JSON.parse(readFileSync(join(managedDir, 'plugins.json'), 'utf8'))).toEqual({
        plugins: { relay: '@acme/wgc-plugin-relay' },
      });
    },
  );
});
