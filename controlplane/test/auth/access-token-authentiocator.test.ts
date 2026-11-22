import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import AccessTokenAuthenticator from '../../src/core/services/AccessTokenAuthenticator.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';
import AuthUtils from '../../src/core/auth-utils.js';
import { OidcRepository } from '../../src/core/repositories/OidcRepository.js';
import { NamespaceLoginMethodRepository } from '../../src/core/repositories/NamespaceLoginMethodRepository.js';
import { OrganizationLoginMethodRepository } from '../../src/core/repositories/OrganizationLoginMethodRepository.js';
import { UserRepository } from '../../src/core/repositories/UserRepository.js';
import { UserInfoEndpointResponse } from '../../src/types/index.js';
import { SetupTest } from './../test-util.js';

let dbname = '';

describe('AccessTokenAuthenticator', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an user with no groups fallback to owned organizations', async (testContext) => {
    const { server, users } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const authUtils = new AuthUtils(server.db, {
      webBaseUrl: 'https://UNUSED/',
      webErrorPath: 'UNUSED',
      ssoCookieDomain: undefined,
      jwtSecret: 'UNUSED',
      oauth: {
        clientID: 'UNUSED',
        openIdApiBaseUrl: 'UNUSED',
        openIdFrontendUrl: 'UNUSED',
        redirectUri: 'UNUSED',
        logoutRedirectUri: 'UNUSED',
      },
      session: { cookieName: 'UNUSED' },
      pkce: { cookieName: 'UNUSED' },
    });

    const alice = users.adminAliceCompanyA;
    authUtils.getUserInfo = vi.fn(() =>
      Promise.resolve({
        preferred_username: alice.userDisplayName,
        name: alice.email,
        email_verified: true,
        sub: alice.userId,
        given_name: 'Test',
        family_name: 'Test',
        email: alice.email,
        groups: [],
      } as UserInfoEndpointResponse),
    );

    const authenticator = new AccessTokenAuthenticator(
      new OrganizationRepository(server.log, server.db),
      authUtils,
      new OidcRepository(server.db),
      new NamespaceLoginMethodRepository(server.db),
      new OrganizationLoginMethodRepository(server.db),
      new UserRepository(server.log, server.db),
    );

    const context = await authenticator.authenticate('', null);
    expect(context.organizationId).toBe(alice.organizationId);
    expect(context.organizationSlug).toBe(alice.organizationSlug);
  });

  test('that a user Keycloak knows but the control plane has not met is recorded and authenticated without an organization', async (testContext) => {
    const { server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const authUtils = new AuthUtils(server.db, {
      webBaseUrl: 'https://UNUSED/',
      webErrorPath: 'UNUSED',
      ssoCookieDomain: undefined,
      jwtSecret: 'UNUSED',
      oauth: {
        clientID: 'UNUSED',
        openIdApiBaseUrl: 'UNUSED',
        openIdFrontendUrl: 'UNUSED',
        redirectUri: 'UNUSED',
        logoutRedirectUri: 'UNUSED',
      },
      session: { cookieName: 'UNUSED' },
      pkce: { cookieName: 'UNUSED' },
    });

    const userId = randomUUID();
    const email = `first-timer-${userId}@example.com`;
    authUtils.getUserInfo = vi.fn(() =>
      Promise.resolve({
        preferred_username: email,
        name: email,
        email_verified: true,
        sub: userId,
        given_name: 'First',
        family_name: 'Timer',
        email,
        groups: [],
      } as UserInfoEndpointResponse),
    );

    const userRepo = new UserRepository(server.log, server.db);
    const authenticator = new AccessTokenAuthenticator(
      new OrganizationRepository(server.log, server.db),
      authUtils,
      new OidcRepository(server.db),
      new NamespaceLoginMethodRepository(server.db),
      new OrganizationLoginMethodRepository(server.db),
      userRepo,
    );

    await expect(authenticator.authenticate('', null)).rejects.toThrow('Cannot determine organization slug');
    expect(await authenticator.authenticateUser('')).toStrictEqual({
      auth: 'access_token',
      userId,
      userDisplayName: email,
    });
    expect(await userRepo.byId(userId)).toStrictEqual({ id: userId, email });
  });
});
