import Fastify from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AuthUtils from '../../src/core/auth-utils.js';
import * as schema from '../../src/db/schema.js';

const tokenEndpoint = vi.hoisted(() =>
  vi.fn((_request: { data: URLSearchParams }) => Promise.resolve({ status: 200, data: {} })),
);

vi.mock('axios', () => ({ default: tokenEndpoint }));

const callbackUrl = 'https://cp.example.com/v1/auth/callback';

const authUtils = new AuthUtils(drizzle(postgres('postgres://unused@localhost:1/unused'), { schema }), {
  webBaseUrl: 'https://studio.example.com',
  webErrorPath: '/error',
  ssoCookieDomain: undefined,
  jwtSecret: 'secret',
  oauth: {
    clientID: 'studio',
    openIdApiBaseUrl: 'https://keycloak.example.com/realms/cosmo',
    openIdFrontendUrl: 'https://keycloak.example.com/realms/cosmo',
    redirectUri: callbackUrl,
    logoutRedirectUri: 'https://studio.example.com/login',
  },
  session: { cookieName: 'cosmo_user_session' },
  pkce: { cookieName: 'cosmo_pkce' },
});

// Signs in through the login request, then lets Keycloak come back to the callback the way a browser would, and
// returns the redirect_uri of the authorization request and the one the token exchange sends.
const signIn = async (login: { redirectURL?: string; sso?: string }) => {
  const { authorizationUrl, pkceCookie } = await authUtils.handleLoginRequest(login);
  const authorizationRedirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri');
  if (!authorizationRedirectUri) {
    throw new Error('the authorization URL has no redirect_uri');
  }

  const server = Fastify();
  server.get<{ Querystring: { code: string; code_verifier: string; redirectURL?: string; ssoSlug?: string } }>(
    '/v1/auth/callback',
    async (req) => {
      await authUtils.handleAuthCallbackRequest(req);
      return { redirectURL: req.query.redirectURL ?? null };
    },
  );

  const returnedTo = new URL(authorizationRedirectUri);
  returnedTo.searchParams.append('code', 'the-code');
  const response = await server.inject({
    method: 'GET',
    url: returnedTo.pathname + returnedTo.search,
    headers: { cookie: pkceCookie.split(';')[0] },
  });
  await server.close();

  return {
    authorizationRedirectUri,
    callbackRedirectUri: tokenEndpoint.mock.calls[0]?.[0].data.get('redirect_uri'),
    callbackRedirectURL: response.json().redirectURL,
  };
};

afterEach(() => {
  tokenEndpoint.mockClear();
});

describe('the OAuth redirect_uri', () => {
  test('is the same at login and at the callback for a redirectURL that carries an encoded URL of its own', async () => {
    const redirectURL =
      'https://studio.example.com/embed/session?return=https%3A%2F%2Fhub.example.com%2Facme%2Fsettings%2Fmembers%3Ftab%3Dall%26q%3Da%2Bb';

    const result = await signIn({ redirectURL });

    expect(result.callbackRedirectUri).toBe(result.authorizationRedirectUri);
    expect(result.callbackRedirectURL).toBe(redirectURL);
  });

  test('is the same at login and at the callback with an SSO slug', async () => {
    const result = await signIn({ redirectURL: 'https://studio.example.com/acme/graphs?a=1&b=2', sso: 'acme-sso' });

    expect(result.callbackRedirectUri).toBe(result.authorizationRedirectUri);
    expect(result.authorizationRedirectUri).toBe(
      'https://cp.example.com/v1/auth/callback?redirectURL=https%3A%2F%2Fstudio.example.com%2Facme%2Fgraphs%3Fa%3D1%26b%3D2&ssoSlug=acme-sso',
    );
  });

  test('is the callback URL itself with nothing to carry', async () => {
    const result = await signIn({});

    expect(result.authorizationRedirectUri).toBe(callbackUrl);
    expect(result.callbackRedirectUri).toBe(callbackUrl);
  });
});
