import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { join } from 'pathe';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CallerKind } from '@wundergraph/wgc-plugin-sdk';
import { PluginEnvironment } from '../../src/core/plugins/environment.js';
import { attachPlugins } from '../../src/core/plugins/startup.js';
import { createMemoryStream, createTempDir, createTestContext, fixturesDir, workspaceFixture } from './utils.js';

afterEach(() => {
  process.exitCode = undefined;
});

const run = async (program: Command, args: string[], environment: PluginEnvironment, caller: CallerKind = 'human') => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const argv = ['node', 'wgc', ...args];
  await attachPlugins({ program, argv, environment, createContext: () => createTestContext(caller, stdout, stderr) });
  await program.parseAsync(argv);
  return { stdout, stderr };
};

const testProgram = () => {
  const program = new Command('wgc');
  program.exitOverride();
  program.command('auth').description('A built-in command');
  return program;
};

describe('attachPlugins', () => {
  test('a workspace plugin subcommand runs through the real wgc program', { timeout: 60_000 }, async () => {
    vi.stubEnv('DISABLE_UPDATE_CHECK', 'true');
    const { default: program } = await import('../../src/commands/index.js');
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: workspaceFixture,
      runsFromSource: true,
      registryUrl: undefined,
    };

    const { stdout } = await run(program, ['greet', 'hello', 'Ada', '--json'], environment);

    expect(JSON.parse(stdout.text())).toEqual({ status: 'success', greeting: 'Hello Ada from source' });
    expect(program.commands.find((command) => command.name() === 'greet')?.description()).toBe('Greets people');
  });

  test('the built cli runs the workspace plugin from its package main', async () => {
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: workspaceFixture,
      runsFromSource: false,
      registryUrl: undefined,
    };

    const { stdout } = await run(testProgram(), ['greet', 'hello', 'Ada'], environment);

    expect(stdout.text()).toBe('Hello Ada from build\n');
  });

  test('a managed install runs when no workspace package provides the command', async () => {
    const managedDir = createTempDir();
    mkdirSync(join(managedDir, 'node_modules'), { recursive: true });
    cpSync(join(fixturesDir, 'wgc-plugin-echo'), join(managedDir, 'node_modules', 'wgc-plugin-echo'), {
      recursive: true,
    });
    writeFileSync(join(managedDir, 'plugins.json'), JSON.stringify({ plugins: { echo: 'wgc-plugin-echo' } }));
    const environment = { managedDir, workspaceRoot: workspaceFixture, runsFromSource: true, registryUrl: undefined };

    const { stdout } = await run(testProgram(), ['echo', 'say', 'hi'], environment);

    expect(stdout.text()).toBe('echo: hi\n');
  });

  test('wgc hub without the hub plugin prints the install command as JSON and exits 1', async () => {
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: undefined,
      runsFromSource: false,
      registryUrl: undefined,
    };

    const { stdout } = await run(testProgram(), ['hub', 'sandbox', 'create', '--json'], environment);

    expect(JSON.parse(stdout.text())).toEqual({
      status: 'error',
      error: {
        message: 'The hub command comes from the hub plugin. Install it with: wgc plugins install hub',
        fix: 'wgc plugins install hub',
      },
    });
    expect(process.exitCode).toBe(1);
  });

  test('an agent caller gets the not-installed hint as JSON without --json', async () => {
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: undefined,
      runsFromSource: false,
      registryUrl: undefined,
    };

    const { stdout } = await run(testProgram(), ['forge', 'deploy'], environment, 'agent');

    expect(JSON.parse(stdout.text()).error.message).toBe(
      'The forge command comes from the forge plugin. Install it with: wgc plugins install forge',
    );
    expect(process.exitCode).toBe(1);
  });

  test('a person sees the not-installed hint on stderr, even for --help', async () => {
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: undefined,
      runsFromSource: false,
      registryUrl: undefined,
    };

    const { stdout, stderr } = await run(testProgram(), ['hub', '--help'], environment);

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain(
      'The hub command comes from the hub plugin. Install it with: wgc plugins install hub',
    );
    expect(process.exitCode).toBe(1);
  });

  test('a plugin that fails validation reports why instead of running', async () => {
    const managedDir = createTempDir();
    mkdirSync(join(managedDir, 'node_modules'), { recursive: true });
    cpSync(join(fixturesDir, 'wgc-plugin-broken'), join(managedDir, 'node_modules', 'wgc-plugin-broken'), {
      recursive: true,
    });
    writeFileSync(join(managedDir, 'plugins.json'), JSON.stringify({ plugins: { broken: 'wgc-plugin-broken' } }));
    const environment = { managedDir, workspaceRoot: undefined, runsFromSource: false, registryUrl: undefined };

    const { stdout } = await run(testProgram(), ['broken', 'anything', '--json'], environment);

    const entry = join(managedDir, 'node_modules', 'wgc-plugin-broken', 'index.js');
    expect(JSON.parse(stdout.text())).toEqual({
      status: 'error',
      error: {
        message: `${entry} is not a wgc plugin. Its default export must be a WgcPlugin: ✖ register must be a function\n  → at default.register`,
        input: entry,
      },
    });
    expect(process.exitCode).toBe(1);
  });

  test('wgc --help names the available plugins and wgc plugins', async () => {
    const program = testProgram();
    const environment = {
      managedDir: createTempDir(),
      workspaceRoot: workspaceFixture,
      runsFromSource: true,
      registryUrl: undefined,
    };
    let help = '';
    program.configureOutput({ writeOut: (text) => (help += text) });

    await attachPlugins({
      program,
      argv: ['node', 'wgc', '--help'],
      environment,
      createContext: () => createTestContext('human', createMemoryStream(), createMemoryStream()),
    });
    program.outputHelp();

    expect(help).toContain(
      'Plugins: greet\nRun "wgc plugins list" to see available plugins and "wgc plugins install <name>" to add one.',
    );
  });
});
