import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import WhoamiCommand from '../src/commands/auth/commands/whoami.js';
import { Client } from '../src/core/client/client.js';
import { config } from '../src/core/config.js';

const unsignedJwt = (claims: object): string =>
  ['{"alg":"none"}', JSON.stringify(claims)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.';

const runWhoami = async (args: string[] = []) => {
  const client: Client = {
    platform: createClient(
      PlatformService,
      createRouterTransport(({ service }) => {
        service(PlatformService, {
          whoAmI: () => ({
            response: { code: EnumStatusCode.OK },
            organizationName: 'Acme',
            organizationSlug: 'acme',
          }),
        });
      }),
    ),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(WhoamiCommand({ client }));
  await program.parseAsync(['whoami', ...args], { from: 'user' });
};

describe('auth whoami Hub audience', () => {
  let logSpy: MockInstance<typeof console.log>;
  const originalApiKey = config.apiKey;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    config.apiKey = originalApiKey;
    vi.restoreAllMocks();
  });

  test('shows that a sign-in token carrying the hub audience is accepted by Hub', async () => {
    config.apiKey = unsignedJwt({ aud: ['hub', 'account'], sub: 'user-1' });

    await runWhoami();

    expect(logSpy.mock.calls.at(-1)).toEqual(['Hub Audience:', 'accepted (token audience: hub, account)']);
  });

  test('shows that a token without the hub audience is not accepted', async () => {
    config.apiKey = unsignedJwt({ aud: 'account' });

    await runWhoami();

    expect(logSpy.mock.calls.at(-1)).toEqual([
      'Hub Audience:',
      'not accepted, Hub needs audience "hub" (token audience: account)',
    ]);
  });

  test('includes the Hub audience in JSON output', async () => {
    config.apiKey = unsignedJwt({ aud: ['hub'] });

    await runWhoami(['--json']);

    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      status: 'success',
      organizationName: 'Acme',
      organizationSlug: 'acme',
      apiUrl: config.baseURL,
      hubAudience: { audiences: ['hub'], acceptedByHub: true },
    });
  });

  test('prints no Hub audience for an API key', async () => {
    config.apiKey = 'cosmo_api_key';

    await runWhoami();

    expect(logSpy.mock.calls.map(([label]) => label)).toEqual(['Organization:', 'Organization Slug:', 'Api Url:']);
  });
});
