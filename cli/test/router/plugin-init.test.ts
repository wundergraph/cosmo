import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'pathe';
import { Command } from 'commander';
import semver from 'semver';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import InitPluginCommand from '../../src/commands/router/commands/plugin/commands/init.js';
import { GO_TOOL_VERSIONS } from '../../src/commands/router/commands/plugin/toolchain.js';
import { Client } from '../../src/core/client/client.js';

const routerPluginGoMod = resolve(import.meta.dirname, '../../../router-plugin/go.mod');

const goDirective = (goMod: string) => goMod.match(/^go (\S+)$/m)?.[1];
const minor = (version: string) => `${semver.major(version)}.${semver.minor(version)}`;

describe('router plugin init', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wgc-plugin-init-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const runInit = (name: string) => {
    const program = new Command();
    program.addCommand(InitPluginCommand({ client: {} as Client }));
    return program.parseAsync(['init', name, '-d', dir], { from: 'user' });
  };

  test('scaffolds a Go plugin that targets the same Go version as router-plugin', async () => {
    await runInit('hello-world');

    const pluginDir = join(dir, 'hello-world');
    const goMod = await readFile(join(pluginDir, 'go.mod'), 'utf8');
    const dockerfile = await readFile(join(pluginDir, 'Dockerfile'), 'utf8');

    const pluginGoVersion = goDirective(goMod);
    const routerPluginGoVersion = goDirective(await readFile(routerPluginGoMod, 'utf8'));
    expect(pluginGoVersion).toBeDefined();
    expect(routerPluginGoVersion).toBeDefined();

    // The scaffolded plugin must not target an older Go than the router-plugin module it depends on
    expect(pluginGoVersion).toBe(routerPluginGoVersion);

    // The builder image must match the Go version in go.mod
    const dockerGoVersion = dockerfile.match(/golang:(\d+\.\d+)-alpine/)?.[1];
    expect(dockerGoVersion).toBe(minor(pluginGoVersion!));

    // The toolchain the CLI installs must be able to build the scaffolded plugin
    const goTool = GO_TOOL_VERSIONS.go;
    expect(semver.gte(goTool.scriptVersion, pluginGoVersion!)).toBe(true);
    expect(semver.satisfies(goTool.scriptVersion, goTool.range)).toBe(true);
    expect(semver.minVersion(goTool.range)!.version).toBe(pluginGoVersion);

    expect(await readFile(join(pluginDir, 'src', 'main.go'), 'utf8')).toContain('HelloWorldService');
  });
});
