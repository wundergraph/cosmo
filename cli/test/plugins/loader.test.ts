import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, test } from 'vitest';
import { loadPlugin } from '../../src/core/plugins/plugin-package.js';
import { listPlugins, resolvePlugin } from '../../src/core/plugins/registry.js';
import { createTempDir, fixturesDir, workspaceFixture } from './utils.js';

const installFixture = (managedDir: string, command: string, packageName: string, version: string) => {
  const directory = join(managedDir, 'node_modules', packageName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: packageName, version, main: 'index.js' }));
  writeFileSync(join(managedDir, 'plugins.json'), JSON.stringify({ plugins: { [command]: packageName } }));
};

describe('plugin resolution', () => {
  test('a workspace package wins over a managed install of the same command', () => {
    const managedDir = createTempDir();
    installFixture(managedDir, 'greet', 'wgc-plugin-greet', '9.9.9');
    const environment = { managedDir, workspaceRoot: workspaceFixture, runsFromSource: true };

    expect(resolvePlugin(environment, 'greet')).toEqual({
      name: 'greet',
      packageName: '@acme/greet',
      version: '0.4.0',
      source: 'workspace',
      entryPath: join(workspaceFixture, 'cli-plugins', 'greet', 'src', 'index.ts'),
    });
  });

  test('outside the repository the managed install resolves, loading its package entry', () => {
    const managedDir = createTempDir();
    installFixture(managedDir, 'greet', 'wgc-plugin-greet', '9.9.9');
    const environment = { managedDir, workspaceRoot: undefined, runsFromSource: false };

    expect(resolvePlugin(environment, 'greet')).toEqual({
      name: 'greet',
      packageName: 'wgc-plugin-greet',
      version: '9.9.9',
      source: 'installed',
      entryPath: join(managedDir, 'node_modules', 'wgc-plugin-greet', 'index.js'),
    });
  });

  test('the built cli loads a workspace plugin from its package main', () => {
    const environment = { managedDir: createTempDir(), workspaceRoot: workspaceFixture, runsFromSource: false };

    expect(resolvePlugin(environment, 'greet')?.entryPath).toBe(
      join(workspaceFixture, 'cli-plugins', 'greet', 'build', 'index.js'),
    );
  });

  test('an unknown command resolves to nothing', () => {
    const environment = { managedDir: createTempDir(), workspaceRoot: workspaceFixture, runsFromSource: true };

    expect(resolvePlugin(environment, 'nothing')).toBeUndefined();
  });

  test('list shows workspace, installed and known-but-not-installed plugins', () => {
    const managedDir = createTempDir();
    installFixture(managedDir, 'greet', 'wgc-plugin-greet', '9.9.9');
    const environment = { managedDir, workspaceRoot: workspaceFixture, runsFromSource: true };

    expect(listPlugins(environment)).toEqual([
      { name: 'greet', packageName: '@acme/greet', version: '0.4.0', source: 'workspace', active: true },
      { name: 'greet', packageName: 'wgc-plugin-greet', version: '9.9.9', source: 'installed', active: false },
      {
        name: 'hub',
        packageName: '@wundergraph/wgc-plugin-hub',
        version: undefined,
        source: 'available',
        active: false,
      },
      {
        name: 'forge',
        packageName: '@wundergraph/wgc-plugin-forge',
        version: undefined,
        source: 'available',
        active: false,
      },
    ]);
  });
});

describe('plugin shape validation', () => {
  test('a valid default export loads', async () => {
    const loaded = await loadPlugin(join(fixturesDir, 'wgc-plugin-echo', 'index.js'), 'echo');

    expect(loaded.success && { name: loaded.data.name, description: loaded.data.description }).toEqual({
      name: 'echo',
      description: 'Echoes words back',
    });
  });

  test('a default export without register is rejected with the reason', async () => {
    const entry = join(fixturesDir, 'wgc-plugin-broken', 'index.js');
    const loaded = await loadPlugin(entry);

    expect(loaded.success).toBe(false);
    expect(!loaded.success && loaded.errors[0].message).toBe(
      `${entry} is not a wgc plugin. Its default export must be a WgcPlugin: ✖ register must be a function\n  → at default.register`,
    );
  });

  test('a plugin whose name differs from its command is rejected', async () => {
    const entry = join(fixturesDir, 'wgc-plugin-echo', 'index.js');
    const loaded = await loadPlugin(entry, 'hub');

    expect(!loaded.success && loaded.errors[0].message).toBe(
      `The plugin at ${entry} is named echo, but wgc expected hub.`,
    );
  });
});
