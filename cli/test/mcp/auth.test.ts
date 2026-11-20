import { describe, expect, test, vi } from 'vitest';
import { createAuthProvider } from '../../src/commands/mcp/auth.js';
import type { ConfigData } from '../../src/utils.js';

const now = new Date('2026-10-31T12:00:00Z');
const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const setup = (config: ConfigData, overrides: Partial<Parameters<typeof createAuthProvider>[0]> = {}) => {
  let stored: ConfigData = { ...config };
  const refresh = vi.fn().mockResolvedValue({
    access_token: 't2',
    refresh_token: 'r2',
    expires_in: 300,
    refresh_expires_in: 3600,
  });
  const writeConfig = vi.fn((data: ConfigData) => {
    stored = { ...stored, ...data };
  });
  const provider = createAuthProvider({
    version: '1.2.3',
    readConfig: () => stored,
    writeConfig,
    refresh,
    now: () => now,
    ...overrides,
  });
  return { provider, refresh, writeConfig };
};

describe('MCP auth provider', () => {
  test('uses a valid access token without refreshing', async () => {
    const { provider, refresh } = setup({ accessToken: 't1', expiresAt: inMinutes(10), organizationSlug: 'acme' });

    const headers = await provider.getHeaders();

    expect(headers).toEqual({
      authorization: 'Bearer t1',
      'cosmo-org-slug': 'acme',
      'user-agent': 'cosmo-cli/1.2.3',
      'x-cosmo-client': 'wgc-mcp/1.2.3',
    });
    expect(refresh).toHaveBeenCalledTimes(0);
  });

  test('refreshes a token that expires within a minute and persists it', async () => {
    const { provider, refresh, writeConfig } = setup({
      accessToken: 't1',
      refreshToken: 'r1',
      expiresAt: new Date(now.getTime() + 30_000),
      refreshExpiresAt: inMinutes(60),
      organizationSlug: 'acme',
    });

    const headers = await provider.getHeaders();

    expect(headers.authorization).toBe('Bearer t2');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('r1');
    expect(writeConfig).toHaveBeenCalledWith({
      accessToken: 't2',
      refreshToken: 'r2',
      expiresAt: inMinutes(5),
      refreshExpiresAt: inMinutes(60),
      organizationSlug: 'acme',
    });
  });

  test('refreshes only once when several calls need a new token at the same time', async () => {
    const { provider, refresh } = setup({
      accessToken: 't1',
      refreshToken: 'r1',
      expiresAt: inMinutes(-1),
      refreshExpiresAt: inMinutes(60),
      organizationSlug: 'acme',
    });

    await Promise.all([provider.getHeaders(), provider.getHeaders(), provider.getHeaders()]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('rejects with a login hint when the refresh token has expired', async () => {
    const { provider } = setup({
      accessToken: 't1',
      refreshToken: 'r1',
      expiresAt: inMinutes(-10),
      refreshExpiresAt: inMinutes(-1),
      organizationSlug: 'acme',
    });

    await expect(provider.getHeaders()).rejects.toThrow(new Error('Your login expired. Run `wgc auth login`.'));
  });

  test('rejects with a login hint when not logged in', async () => {
    const { provider } = setup({});

    expect(provider.mode).toBe('user');
    await expect(provider.getHeaders()).rejects.toThrow(new Error('Not logged in. Run `wgc auth login`.'));
  });

  test('defaults to the API key when one is set and never reads the login', async () => {
    const readConfig = vi.fn(() => ({}));
    const { provider } = setup({}, { apiKey: 'cosmo_x', readConfig });

    const headers = await provider.getHeaders();

    expect(provider.mode).toBe('api-key');
    expect(headers.authorization).toBe('Bearer cosmo_x');
    expect(headers['x-cosmo-client']).toBe('wgc-mcp/1.2.3');
    expect(readConfig).toHaveBeenCalledTimes(0);
  });

  test('uses the login when user mode is chosen even though an API key is set', async () => {
    const { provider } = setup(
      { accessToken: 't1', expiresAt: inMinutes(10), organizationSlug: 'acme' },
      { apiKey: 'cosmo_x', mode: 'user' },
    );

    expect((await provider.getHeaders()).authorization).toBe('Bearer t1');
  });

  test('rejects api-key mode without an API key', async () => {
    const { provider } = setup({}, { mode: 'api-key' });

    await expect(provider.getHeaders()).rejects.toThrow(new Error('COSMO_API_KEY is not set.'));
  });
});
