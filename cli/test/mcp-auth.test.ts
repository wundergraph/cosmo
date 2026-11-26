import { ok } from '@wundergraph/wgc-plugin-sdk';
import { Command, program as globalProgram } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import McpCommand from '../src/commands/mcp/index.js';
import { Client } from '../src/core/client/client.js';
import { config } from '../src/core/config.js';
import type { ConfigData } from '../src/utils.js';

const userConfig = vi.hoisted((): { current: ConfigData } => ({ current: {} }));

vi.mock('../src/utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils.js')>()),
  readConfigFile: () => userConfig.current,
}));

vi.mock('../src/core/ci-oidc.js', () => ({
  useCiIdentityForCosmo: () => Promise.resolve(ok('none')),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    start() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }

    send() {
      return Promise.resolve();
    }
  },
}));

const runMcp = async () => {
  const program = new Command();
  program.exitOverride();
  program.addCommand(McpCommand({ client: {} as Client }));
  await program.parseAsync(['mcp'], { from: 'user' });
};

describe('mcp credentials', () => {
  const originalApiKey = config.apiKey;

  beforeEach(() => {
    config.apiKey = undefined;
    globalProgram.exitOverride();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    config.apiKey = originalApiKey;
    userConfig.current = {};
    vi.restoreAllMocks();
  });

  test('uses the token from auth login when COSMO_API_KEY is not set', async () => {
    userConfig.current = {
      accessToken: 'login-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      organizationSlug: 'acme',
    };

    await runMcp();

    expect(config.apiKey).toBe('login-token');
  });

  test('refuses to start without a login or COSMO_API_KEY', async () => {
    await expect(runMcp()).rejects.toThrow(/auth login.*COSMO_API_KEY/);
  });
});
