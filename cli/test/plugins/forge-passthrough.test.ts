import { chmodSync, writeFileSync } from 'node:fs';
import { execa } from 'execa';
import { join } from 'pathe';
import { describe, expect, test } from 'vitest';
import { createTempDir } from './utils.js';

const cliRoot = join(import.meta.dirname, '..', '..');

const fakeForgeScript = `#!/bin/sh
exec node -e 'let input = "";
process.stdin.on("data", (chunk) => { input += chunk; }).on("end", () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(1), stdin: input }) + "\\n");
  process.stderr.write("forge progress\\n");
  process.exit(Number(process.env.FAKE_FORGE_EXIT || 0));
});' -- "$@"
`;

const pathWithFakeForge = (): string => {
  const directory = createTempDir();
  writeFileSync(join(directory, 'forge'), fakeForgeScript);
  chmodSync(join(directory, 'forge'), 0o755);
  return `${directory}:${process.env.PATH}`;
};

const runWgc = (args: string[], env: Record<string, string>, input: string) =>
  execa(join(cliRoot, 'node_modules', '.bin', 'tsx'), [join(cliRoot, 'src', 'index.ts'), ...args], {
    cwd: cliRoot,
    env: { DISABLE_UPDATE_CHECK: 'true', ...env },
    input,
    reject: false,
  });

describe('wgc forge with a forge binary on PATH', () => {
  test('forwards arguments, stdin, stdout, stderr and the exit code unchanged', { timeout: 60_000 }, async () => {
    const result = await runWgc(
      ['forge', '--version', 'router', 'upgrade', '--json', '--config', 'router.yaml', '--', '0.300.0'],
      { PATH: pathWithFakeForge(), FAKE_FORGE_EXIT: '3' },
      'piped input',
    );

    expect(JSON.parse(result.stdout)).toEqual({
      args: ['--version', 'router', 'upgrade', '--json', '--config', 'router.yaml', '--', '0.300.0'],
      stdin: 'piped input',
    });
    expect(result.stderr).toBe('forge progress');
    expect(result.exitCode).toBe(3);
  });

  test('a failing WGC_FORGE_BINARY reports the failure as JSON', { timeout: 60_000 }, async () => {
    const result = await runWgc(['forge', 'build', '--json'], { WGC_FORGE_BINARY: '/nonexistent/forge' }, '');

    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'error',
      error: {
        input: '/nonexistent/forge',
        fix: 'Point WGC_FORGE_BINARY at a working forge binary, or set WGC_FORGE_BINARY=builtin to use the commands built into wgc.',
      },
    });
    expect(result.exitCode).toBe(1);
  });
});
