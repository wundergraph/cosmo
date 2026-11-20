import { chmod, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { chooseEngine } from '../src/engine.js';

const directoryWithForge = async (mode: number): Promise<string> => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'forge-path-')));
  await writeFile(path.join(directory, 'forge'), '#!/bin/sh\n');
  await chmod(path.join(directory, 'forge'), mode);
  return directory;
};

const emptyDirectory = async (): Promise<string> => realpath(await mkdtemp(path.join(tmpdir(), 'forge-empty-')));

describe('chooseEngine', () => {
  test('uses the first executable forge on PATH', async () => {
    const empty = await emptyDirectory();
    const first = await directoryWithForge(0o755);
    const second = await directoryWithForge(0o755);

    const choice = chooseEngine({ PATH: [empty, first, second].join(path.delimiter) });

    expect(choice).toEqual({ kind: 'binary', binary: path.join(first, 'forge') });
  });

  test('skips a forge file that is not executable', async () => {
    const notExecutable = await directoryWithForge(0o644);

    expect(chooseEngine({ PATH: notExecutable })).toEqual({ kind: 'builtin' });
  });

  test('falls back to the builtin commands when PATH has no forge', async () => {
    expect(chooseEngine({ PATH: await emptyDirectory() })).toEqual({ kind: 'builtin' });
  });

  test('WGC_FORGE_BINARY picks the binary even when PATH has another forge', async () => {
    const onPath = await directoryWithForge(0o755);

    const choice = chooseEngine({ PATH: onPath, WGC_FORGE_BINARY: '/opt/forge/bin/forge' });

    expect(choice).toEqual({ kind: 'binary', binary: '/opt/forge/bin/forge' });
  });

  test('WGC_FORGE_BINARY=builtin ignores a forge on PATH', async () => {
    const onPath = await directoryWithForge(0o755);

    expect(chooseEngine({ PATH: onPath, WGC_FORGE_BINARY: 'builtin' })).toEqual({ kind: 'builtin' });
  });
});
