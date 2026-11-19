import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { createCredentials, createPluginContext, ok } from '@wundergraph/wgc-plugin-sdk';
import type { CallerKind, PluginContext } from '@wundergraph/wgc-plugin-sdk';
import { NpmRunner } from '../../src/core/plugins/npm.js';

export const fixturesDir = join(import.meta.dirname, 'fixtures');
export const workspaceFixture = join(fixturesDir, 'workspace');

export const createTempDir = (): string => mkdtempSync(join(tmpdir(), 'wgc-plugins-'));

export const createMemoryStream = () => {
  const chunks: string[] = [];
  return {
    write: (chunk: string) => chunks.push(chunk),
    text: () => chunks.join(''),
    lines: () => chunks.join('').trim().split('\n').filter(Boolean),
  };
};

export const createTestContext = (
  caller: CallerKind,
  stdout: ReturnType<typeof createMemoryStream>,
  stderr: ReturnType<typeof createMemoryStream>,
): PluginContext =>
  createPluginContext({
    cliVersion: '0.0.0-test',
    caller,
    endpoints: { cosmoApiUrl: 'http://cosmo.test', cosmoWebUrl: 'http://web.test', hubUrl: 'http://hub.test' },
    credentials: createCredentials({ env: {}, loginToken: () => Promise.resolve(undefined) }),
    stdout,
    stderr,
  });

/** Stands in for npm: `install <fixture name or path>` copies the fixture into node_modules, `uninstall` deletes it. */
export const createFakeNpm = () => {
  const calls: string[][] = [];
  const npm: NpmRunner = (args, cwd) => {
    calls.push(args);
    const target = args.at(-1)!;
    if (args[0] === 'install') {
      const source = target.startsWith('/') ? target : join(fixturesDir, target);
      const packageName = source.split('/').at(-1)!;
      mkdirSync(join(cwd, 'node_modules'), { recursive: true });
      cpSync(source, join(cwd, 'node_modules', packageName), { recursive: true });
    } else {
      rmSync(join(cwd, 'node_modules', target), { recursive: true, force: true });
    }
    return Promise.resolve(ok(''));
  };
  return { npm, calls };
};
