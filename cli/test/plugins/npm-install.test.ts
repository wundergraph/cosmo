import { Command } from 'commander';
import { join } from 'pathe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import PluginCommands from '../../src/commands/plugins/index.js';
import { runNpm } from '../../src/core/plugins/npm.js';
import { attachPlugins } from '../../src/core/plugins/startup.js';
import { createMemoryStream, createTempDir, createTestContext, fixturesDir } from './utils.js';

afterEach(() => {
  process.exitCode = undefined;
});

describe('wgc plugins install with real npm', () => {
  test('installs a local plugin package offline and runs its command', { timeout: 120_000 }, async () => {
    vi.stubEnv('npm_config_offline', 'true');
    const environment = {
      managedDir: join(createTempDir(), 'plugins'),
      workspaceRoot: undefined,
      runsFromSource: false,
      registryUrl: undefined,
    };
    const installOutput = createMemoryStream();
    const installer = new Command('wgc');
    installer.exitOverride();
    installer.addCommand(
      PluginCommands({
        environment,
        npm: runNpm,
        caller: 'script',
        stdout: installOutput,
        stderr: createMemoryStream(),
      }),
    );

    await installer.parseAsync(['node', 'wgc', 'plugins', 'install', join(fixturesDir, 'wgc-plugin-echo')]);

    expect(JSON.parse(installOutput.text()).data.plugin).toEqual({
      name: 'echo',
      packageName: 'wgc-plugin-echo',
      version: '1.2.0',
      directory: join(environment.managedDir, 'node_modules', 'wgc-plugin-echo'),
    });

    const stdout = createMemoryStream();
    const program = new Command('wgc');
    program.exitOverride();
    const argv = ['node', 'wgc', 'echo', 'say', 'installed', '--json'];
    await attachPlugins({
      program,
      argv,
      environment,
      createContext: () => createTestContext('human', stdout, createMemoryStream()),
    });
    await program.parseAsync(argv);

    expect(JSON.parse(stdout.text())).toEqual({ ok: true, data: { echoed: 'installed' } });
  });
});
