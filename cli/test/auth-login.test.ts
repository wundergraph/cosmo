import { createClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createOutput } from '@wundergraph/wgc-plugin-sdk';
import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import LoginCommand from '../src/commands/auth/commands/login.js';
import type { LoginDependencies, OrganizationChoice } from '../src/commands/auth/commands/login.js';
import type { ConfigData } from '../src/utils.js';

vi.mock('../src/core/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/config.js')>()),
  commandName: 'wgcm',
}));

const unsignedJwt = (claims: object): string =>
  ['{"alg":"none"}', JSON.stringify(claims)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.';

const deviceAuthorization = {
  device_code: 'device-secret',
  user_code: 'WDJB-MJHT',
  verification_uri_complete: 'https://accounts.example/realms/cosmo/device?user_code=WDJB-MJHT',
  interval: 5,
  expires_in: 600,
};

/** Answers the device endpoint, then each token request with the next answer in `tokenAnswers`. */
const fakeIdentityServer = (tokenAnswers: Array<{ status: number; body: object }>) => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = String(input);
    requests.push(url.replace('https://accounts.example/auth/realms/cosmo/protocol/openid-connect/', ''));
    if (url.endsWith('/auth/device')) {
      return Promise.resolve(Response.json(deviceAuthorization));
    }
    const answer = tokenAnswers.shift() ?? { status: 400, body: { error: 'expired_token' } };
    return Promise.resolve(Response.json(answer.body, { status: answer.status }));
  };
  return { fetchImpl, requests };
};

const granted = (groups: string[]) => ({
  status: 200,
  body: {
    access_token: unsignedJwt({ groups, aud: ['hub'] }),
    refresh_token: 'refresh',
    expires_in: 300,
    refresh_expires_in: 3600,
  },
});

const pending = { status: 400, body: { error: 'authorization_pending' } };

const runLogin = async (
  args: string[],
  {
    tokenAnswers = [],
    interactive = false,
    session = {},
  }: { tokenAnswers?: Array<{ status: number; body: object }>; interactive?: boolean; session?: ConfigData },
) => {
  let stdout = '';
  let stderr = '';
  const saved: ConfigData[] = [];
  const opened: string[] = [];
  const slept: number[] = [];
  const identity = fakeIdentityServer(tokenAnswers);
  const dependencies: LoginDependencies = {
    fetchImpl: identity.fetchImpl,
    sleep: (milliseconds) => {
      slept.push(milliseconds);
      return Promise.resolve();
    },
    openBrowser: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    saveSession: (update) => {
      saved.push(update);
      Object.assign(session, update);
    },
    readSession: () => session,
    interactive,
    createOutput: (json) =>
      createOutput({
        json,
        stdout: { write: (chunk: string) => (stdout += chunk) },
        stderr: { write: (chunk: string) => (stderr += chunk) },
      }),
    describeOrganizations: (_token, slugs) =>
      Promise.resolve(slugs.map((slug): OrganizationChoice => ({ slug, label: slug }))),
    chooseOrganization: (choices) => Promise.resolve(choices[1].slug),
    endpoints: { apiUrl: 'https://accounts.example/auth', realm: 'cosmo', clientId: 'cosmo-cli' },
  };
  const client = {
    platform: createClient(
      PlatformService,
      createRouterTransport(() => {}),
    ),
  };

  const program = new Command().exitOverride();
  program.addCommand(LoginCommand({ client }, dependencies));
  process.exitCode = 0;
  await program.parseAsync(['login', ...args], { from: 'user' });
  const exitCode = Number(process.exitCode ?? 0);

  return { stdout, stderr, exitCode, saved, opened, slept, requests: identity.requests };
};

afterEach(() => {
  process.exitCode = 0;
});

describe('wgcm auth login', () => {
  test('a person sees the pairing code the browser shows, and the login is saved for their organization', async () => {
    const run = await runLogin([], { interactive: true, tokenAnswers: [pending, granted(['/acme'])] });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe(
      [
        'Pairing code  WDJB-MJHT',
        'Check that your browser shows the same code before you approve the login.',
        '  https://accounts.example/realms/cosmo/device?user_code=WDJB-MJHT',
        '',
        '',
      ].join('\n'),
    );
    expect(run.opened).toEqual(['https://accounts.example/realms/cosmo/device?user_code=WDJB-MJHT']);
    expect(run.stdout).toBe('Logged in to acme.\nHub (https://hub.wundergraph.com): accepted (token audience: hub)\n');
    expect(run.saved.map((session) => [session.organizationSlug, session.refreshToken])).toEqual([['acme', 'refresh']]);
    expect(run.slept).toEqual([5000]);
  });

  test('a person in several organizations picks one', async () => {
    const run = await runLogin([], { interactive: true, tokenAnswers: [granted(['/acme', '/globex'])] });

    expect(run.saved.map((session) => session.organizationSlug)).toEqual(['globex']);
  });

  test('without a terminal it prints the browser URL, code and next step as JSON and exits without waiting', async () => {
    const run = await runLogin(['--org', 'acme'], {});

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        browser_url: 'https://accounts.example/realms/cosmo/device?user_code=WDJB-MJHT',
        verification_code: 'WDJB-MJHT',
        expires_in: 600,
        next_step: 'wgcm auth login --complete device-secret --org acme',
      },
      next: ['wgcm auth login --complete device-secret --org acme'],
    });
    expect(run.requests).toEqual(['auth/device']);
    expect(run.saved).toEqual([]);
  });

  test('--complete finishes the approved login and saves it', async () => {
    const run = await runLogin(['--complete', 'device-secret', '--org', 'globex'], {
      tokenAnswers: [pending, granted(['/acme', '/globex'])],
    });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: { organizationSlug: 'globex', hubAudience: { audiences: ['hub'], acceptedByHub: true } },
    });
    expect(run.saved.map((session) => session.organizationSlug)).toEqual(['globex']);
    expect(run.requests).toEqual(['token', 'token']);
  });

  test('--complete never picks an organization for an account in several', async () => {
    const run = await runLogin(['--complete', 'device-secret'], { tokenAnswers: [granted(['/acme', '/globex'])] });

    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: 'Your account belongs to 2 organizations: acme, globex.',
        remediation: 'Finish this login with the one to use: `wgcm auth login --complete device-secret --org <slug>`.',
        next: ['wgcm auth login --complete device-secret --org <slug>'],
      },
    });
    expect(run.saved.map((session) => session.organizationSlug)).toEqual([undefined]);
  });

  test('an account in several organizations finishes the same login with --org, without a new browser login', async () => {
    const session: ConfigData = {};
    await runLogin(['--complete', 'device-secret'], { tokenAnswers: [granted(['/acme', '/globex'])], session });

    const run = await runLogin(['--complete', 'device-secret', '--org', 'globex'], { session });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: { organizationSlug: 'globex', hubAudience: { audiences: ['hub'], acceptedByHub: true } },
    });
    expect(run.requests).toEqual([]);
    expect([session.organizationSlug, session.refreshToken, session.pendingLogin]).toEqual([
      'globex',
      'refresh',
      undefined,
    ]);
  });

  test('an expired code exits 4 and says to start again', async () => {
    const run = await runLogin(['--complete', 'device-secret'], {
      tokenAnswers: [{ status: 400, body: { error: 'expired_token' } }],
    });

    expect(run.exitCode).toBe(4);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'LOGIN_NOT_APPROVED',
      message: 'The login code expired before it was approved.',
      remediation: 'Start a new login with `wgcm auth login`.',
      next: ['wgcm auth login'],
    });
  });
});
