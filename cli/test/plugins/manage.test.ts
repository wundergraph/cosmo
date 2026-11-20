import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import { join } from 'pathe';
import { afterEach, describe, expect, test } from 'vitest';
import PluginCommands from '../../src/commands/plugins/index.js';
import { NpmRunner } from '../../src/core/plugins/npm.js';
import { createFakeNpm, createMemoryStream, createTempDir, fixturesDir } from './utils.js';

afterEach(() => {
  process.exitCode = undefined;
});

const wgc = async (managedDir: string, npm: NpmRunner, args: string[], registryUrl?: string) => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const program = new Command('wgc');
  program.exitOverride();
  program.command('auth');
  program.addCommand(
    PluginCommands({
      environment: { managedDir, workspaceRoot: undefined, runsFromSource: false, registryUrl },
      npm,
      caller: 'script',
      stdout,
      stderr,
    }),
  );
  await program.parseAsync(['node', 'wgc', 'plugins', ...args]);
  return { stdout, stderr };
};

const readManifest = (managedDir: string) => JSON.parse(readFileSync(join(managedDir, 'plugins.json'), 'utf8'));

describe('wgc plugins', () => {
  test('install, list and remove a plugin', async () => {
    const managedDir = join(createTempDir(), 'plugins');
    const { npm, calls } = createFakeNpm();

    const install = await wgc(managedDir, npm, ['install', 'wgc-plugin-echo']);
    expect(JSON.parse(install.stdout.text())).toEqual({
      ok: true,
      data: {
        plugin: {
          name: 'echo',
          packageName: 'wgc-plugin-echo',
          version: '1.2.0',
          directory: join(managedDir, 'node_modules', 'wgc-plugin-echo'),
        },
      },
    });
    expect(install.stderr.lines().map((line) => JSON.parse(line).step)).toEqual(['prepare', 'npm-install', 'verify']);
    expect(JSON.parse(readFileSync(join(managedDir, 'package.json'), 'utf8')).name).toBe('wgc-plugins');
    expect(readManifest(managedDir)).toEqual({ plugins: { echo: 'wgc-plugin-echo' } });

    const list = await wgc(managedDir, npm, ['list']);
    expect(JSON.parse(list.stdout.text()).data.plugins).toEqual([
      { name: 'echo', packageName: 'wgc-plugin-echo', version: '1.2.0', source: 'installed', active: true },
      { name: 'hub', packageName: '@wundergraph/wgc-plugin-hub', source: 'available', active: false },
      { name: 'forge', packageName: '@wundergraph/wgc-plugin-forge', source: 'available', active: false },
    ]);

    const remove = await wgc(managedDir, npm, ['remove', 'echo']);
    expect(JSON.parse(remove.stdout.text())).toEqual({
      ok: true,
      data: {
        plugin: { name: 'echo', packageName: 'wgc-plugin-echo' },
      },
    });
    expect(readManifest(managedDir)).toEqual({ plugins: {} });
    expect(existsSync(join(managedDir, 'node_modules', 'wgc-plugin-echo'))).toBe(false);
    expect(calls).toEqual([
      ['install', '--save', '--no-audit', '--no-fund', 'wgc-plugin-echo'],
      ['uninstall', '--save', '--no-audit', '--no-fund', 'wgc-plugin-echo'],
    ]);
  });

  test('install hub asks npm for the hub package', async () => {
    const calls: string[][] = [];
    const npm: NpmRunner = (args) => {
      calls.push(args);
      return Promise.resolve({ success: false, errors: [new Error('npm ERR! 404 Not Found')] });
    };

    const { stdout } = await wgc(createTempDir(), npm, ['install', 'hub']);

    expect(calls).toEqual([['install', '--save', '--no-audit', '--no-fund', '@wundergraph/wgc-plugin-hub']]);
    expect(JSON.parse(stdout.text())).toEqual({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'npm ERR! 404 Not Found', input: 'hub' },
    });
    expect(process.exitCode).toBe(1);
  });

  test('with a registry URL, install hub asks npm for the hub and SDK tarballs from that URL', async () => {
    const calls: string[][] = [];
    const npm: NpmRunner = (args) => {
      calls.push(args);
      return Promise.resolve({ success: false, errors: [new Error('npm ERR! 404 Not Found')] });
    };

    await wgc(createTempDir(), npm, ['install', 'hub'], 'https://hub.example.com/cli/');

    expect(calls).toEqual([
      [
        'install',
        '--save',
        '--no-audit',
        '--no-fund',
        '--allow-remote=all',
        'https://hub.example.com/cli/wgc-plugin-sdk.tgz',
        'https://hub.example.com/cli/wgc-plugin-hub.tgz',
      ],
    ]);
  });

  test('with a registry URL, a package spec still installs from npm', async () => {
    const calls: string[][] = [];
    const npm: NpmRunner = (args) => {
      calls.push(args);
      return Promise.resolve({ success: false, errors: [new Error('npm ERR! 404 Not Found')] });
    };

    await wgc(createTempDir(), npm, ['install', '@acme/wgc-plugin-relay@2.0.0'], 'https://hub.example.com/cli');

    expect(calls).toEqual([
      ['install', '--save', '--no-audit', '--no-fund', '--allow-remote=all', '@acme/wgc-plugin-relay@2.0.0'],
    ]);
  });

  test('a package that is not a plugin is uninstalled again and the install fails', async () => {
    const managedDir = createTempDir();
    const { npm, calls } = createFakeNpm();

    const { stdout, stderr } = await wgc(managedDir, npm, ['install', join(fixturesDir, 'not-a-plugin')]);

    expect(JSON.parse(stdout.text()).error.message).toBe(
      'not-a-plugin is not a wgc plugin. Plugin packages are named wgc-plugin-<name> or list "wgc-plugin" in their keywords.',
    );
    expect(stderr.lines().map((line) => JSON.parse(line).step)).toEqual([
      'prepare',
      'npm-install',
      'verify',
      'rollback',
    ]);
    expect(calls.at(-1)).toEqual(['uninstall', '--save', '--no-audit', '--no-fund', 'not-a-plugin']);
    expect(existsSync(join(managedDir, 'node_modules', 'not-a-plugin'))).toBe(false);
    expect(existsSync(join(managedDir, 'plugins.json'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('a plugin-named package with an invalid export is uninstalled again', async () => {
    const managedDir = createTempDir();
    const { npm } = createFakeNpm();

    const { stdout } = await wgc(managedDir, npm, ['install', 'wgc-plugin-broken']);

    expect(JSON.parse(stdout.text()).error.message).toContain(
      'is not a wgc plugin. Its default export must be a WgcPlugin',
    );
    expect(existsSync(join(managedDir, 'node_modules', 'wgc-plugin-broken'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('removing a plugin that is not installed fails with a fix', async () => {
    const managedDir = createTempDir();

    const { stdout } = await wgc(managedDir, createFakeNpm().npm, ['remove', 'hub']);

    expect(JSON.parse(stdout.text())).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `No plugin named hub is installed in ${managedDir}.`,
        input: 'hub',
        remediation: 'Run "wgc plugins list" to see installed plugins.',
      },
    });
    expect(process.exitCode).toBe(1);
  });
});
