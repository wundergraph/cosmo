import { existsSync } from 'node:fs';
import { expect, test, describe } from 'bun:test';
import { $ } from 'bun';

import packageJSON from '../package.json' with { type: 'json' };

$.nothrow();

describe('Bun CLI', () => {
  const binPath = './wgc';

  test('bun cli should exist', () => {
    expect(existsSync(binPath)).toBe(true);
  });

  test('bun cli should output the correct version', async () => {
    const { stdout, stderr, exitCode } = await $`${binPath} -V`.quiet();

    expect(exitCode, `exited with non-zero:\nstdout:\n${stdout.toString()}\n\nstderr:\n${stderr.toString()}`).toBe(0);

    expect(stdout.toString()).toBe(packageJSON.version + '\n');
  });

  test('bun cli should compose a router execution config', async () => {
    const { stdout, stderr, exitCode } =
      await $`${binPath} router compose -i ../demo/graph-no-edg.yaml -o e2e/config.json`.quiet();

    expect(exitCode, `exited with non-zero:\nstdout:\n${stdout.toString()}\n\nstderr:\n${stderr.toString()}`).toBe(0);

    expect(stdout.toString()).toContain('Router config successfully written');
  });
});

describe('Node CLI', () => {
  const binPath = packageJSON.bin;

  test('node cli should exist', () => {
    expect(existsSync(binPath)).toBe(true);
  });

  test('node cli should output the correct version', async () => {
    const { stdout, stderr, exitCode } = await $`node ${binPath} -V`.quiet();

    expect(exitCode, `exited with non-zero:\nstdout:\n${stdout.toString()}\n\nstderr:\n${stderr.toString()}`).toBe(0);

    expect(stdout.toString()).toBe(packageJSON.version + '\n');
  });

  test('bun cli should compose a router execution config', async () => {
    const { stdout, stderr, exitCode } =
      await $`node ${binPath} router compose -i ../demo/graph-no-edg.yaml -o e2e/config.json`.quiet();

    expect(exitCode, `exited with non-zero:\nstdout:\n${stdout.toString()}\n\nstderr:\n${stderr.toString()}`).toBe(0);

    expect(stdout.toString()).toContain('Router config successfully written');
  });
});
