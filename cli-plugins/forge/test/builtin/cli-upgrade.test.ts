import { describe, expect, test } from 'vitest';
import type { Prompts } from '@wundergraph/wgc-plugin-sdk';
import { createWorkspace, read, runForge } from './harness.js';

const version = '0.1.0';

const picking = (answer: string): Prompts => ({
  canPrompt: true,
  confirm: () => Promise.resolve(false),
  text: () => Promise.resolve(answer),
});

describe('wgc forge upgrade', () => {
  test('gives the update command for the stable channel by default', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['upgrade'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      installation: 'wgc-plugin',
      channel: 'stable',
      version,
      command: 'wgc plugins install forge',
      upgraded: false,
    });
  });

  test('follows the selected channel', async () => {
    const workspace = await createWorkspace();
    await runForge(['upgrade', 'channel', 'nightly'], { workspace });

    const run = await runForge(['upgrade'], { workspace });

    expect(JSON.parse(run.stdout).command).toBe('wgc plugins install @wundergraph/wgc-plugin-forge@nightly');
  });
});

describe('wgc forge upgrade channel', () => {
  test('sets the channel per user', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['upgrade', 'channel', 'nightly'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      channel: 'nightly',
      previous: 'stable',
      version,
      command: 'wgc plugins install @wundergraph/wgc-plugin-forge@nightly',
    });
    expect(JSON.parse(await read(workspace, '.forge-settings.json'))).toEqual({ channel: 'nightly' });
  });

  test('without an argument an agent or CI gets the current channel and installed version', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['upgrade', 'channel'], { workspace, caller: 'ci' });

    expect(JSON.parse(run.stdout)).toEqual({ status: 'success', channel: 'stable', version });
  });

  test('without an argument a person picks the channel', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['upgrade', 'channel'], { workspace, caller: 'human', prompts: picking('nightly') });

    expect(run.stdout).toBe('Channel set to nightly. Run `wgc forge upgrade` to install its release.\n');
  });

  test('an unknown channel is refused with the valid ones', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['upgrade', 'channel', 'beta'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      message: '"beta" is not a release channel.',
      input: 'beta',
      fix: 'Use one of: stable, nightly.',
    });
  });
});
