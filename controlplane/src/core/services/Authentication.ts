import { lru } from 'tiny-lru';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addDays } from 'date-fns';
import { AuthContext } from '../../types/index.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { AuthenticationError, FreeTrialExpiredError, isFreeTrialExpiredError } from '../errors/errors.js';
import WebSessionAuthenticator from './WebSessionAuthenticator.js';
import ApiKeyAuthenticator from './ApiKeyAuthenticator.js';
import GraphApiTokenAuthenticator, { GraphKeyAuthContext } from './GraphApiTokenAuthenticator.js';
import AccessTokenAuthenticator from './AccessTokenAuthenticator.js';

// The maximum time to cache the user auth context for the web session authentication.
const maxAuthCacheTtl = 30 * 1000; // 30 seconds

export const calLink = 'https://cal.com/stefan-avram-wundergraph/wundergraph-introduction';

export interface Authenticator {
  authenticate(headers: Headers): Promise<AuthContext>;
  authenticateRouter(headers: Headers): Promise<GraphKeyAuthContext>;
}

export class Authentication implements Authenticator {
  #cache = lru<AuthContext>(1000, maxAuthCacheTtl);

  constructor(
    private webAuth: WebSessionAuthenticator,
    private keyAuth: ApiKeyAuthenticator,
    private accessTokenAuth: AccessTokenAuthenticator,
    private graphKeyAuth: GraphApiTokenAuthenticator,
    private orgRepo: OrganizationRepository,
  ) {}

  /**
   * Authenticate a user for an organization.
   * The function will first check for the token in the `Authorization` header and if that is not found,
   * it will check for the token in the `cosmo_user_session` cookie. In case of a cookie, the functions expects
   * the `cosmo-org-id` header to be set and will validate that the user is a member of the organization.
   * If none of these are found, an error is thrown.
   */
  public async authenticate(headers: Headers): Promise<AuthContext> {
    try {
      /**
       * API keys are authenticated first.
       * First check for the token in the `Authorization` header
       */
      const authorization = headers.get('authorization');
      if (authorization) {
        const token = authorization.replace(/^bearer\s+/i, '');
        if (token.startsWith('cosmo')) {
          return await this.keyAuth.authenticate(token);
        }
        return await this.accessTokenAuth.authenticate(token);
      }

      /**
       * If no API key is found, check for the `cosmo_user_session` cookie which is used for web sessions.
       * The `cosmo-org-id` header must be set.
       */
      const user = await this.webAuth.authenticate(headers);
      const organization = await this.orgRepo.bySlug(user.organizationSlug);

      if (!organization) {
        throw new Error('Organization not found');
      }

      const isFreeTrialExpired = organization.isFreeTrial && new Date() > addDays(new Date(organization.createdAt), 10);

      if (isFreeTrialExpired) {
        throw new FreeTrialExpiredError(
          EnumStatusCode.ERR_FREE_TRIAL_EXPIRED,
          `Free trial has concluded. Please talk to sales to upgrade your plan.\n${calLink}\n`,
        );
      }

      const cacheKey = `${user.userId}:${organization.id}`;
      const cachedUserContext = this.#cache.get(cacheKey);

      if (cachedUserContext) {
        return cachedUserContext;
      }

      /**
       * Validate that the user is a member of the organization.
       */
      const isMember = await this.orgRepo.isMemberOf({
        userId: user.userId,
        organizationId: organization.id,
      });

      if (!isMember) {
        throw new Error('User is not a member of the organization');
      }

      const userContext: AuthContext = {
        userId: user.userId,
        organizationId: organization.id,
      };

      this.#cache.set(cacheKey, userContext);

      return userContext;
    } catch (e: any) {
      if (isFreeTrialExpiredError(e)) {
        throw e;
      }
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Not authenticated');
    }
  }

  async authenticateRouter(headers: Headers): Promise<GraphKeyAuthContext> {
    const authorization = headers.get('authorization');
    if (authorization) {
      try {
        const token = authorization.replace(/^bearer\s+/i, '');
        return await this.graphKeyAuth.authenticate(token);
      } catch {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Graph token is invalid');
      }
    }
    throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Graph token is missing');
  }
}
