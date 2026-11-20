import { afterEach, describe, expect, test, vi } from 'vitest';

describe('the published wgc', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('is the command wgc and keeps plugins under ~/.wgc', async () => {
    vi.stubEnv('HOME', '/home/tester');
    const config = await import('../src/core/config.js');
    const { defaultPluginEnvironment } = await import('../src/core/plugins/environment.js');

    expect({
      commandName: config.commandName,
      homeDir: config.homeDir,
      pluginsDir: defaultPluginEnvironment({}).managedDir,
    }).toEqual({
      commandName: 'wgc',
      homeDir: '/home/tester/.wgc',
      pluginsDir: '/home/tester/.wgc/plugins',
    });
  });
});
