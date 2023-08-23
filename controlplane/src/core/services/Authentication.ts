import { lru } from 'tiny-lru';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { UserAuthContext } from '../../types/index.js';
import ApiKeyAuthenticator from '../services/ApiKeyAuthenticator.js';
import WebSessionAuthenticator from '../services/WebSessionAuthenticator.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { AuthenticationError } from '../errors/errors.js';
import GraphApiTokenAuthenticator from './GraphApiTokenAuthenticator.js';

// The maximum time to cache the user auth context for the web session authentication.
const maxAuthCacheTtl = 30 * 1000; // 30 seconds

export interface Authenticator {
  authenticate(headers: Headers): Promise<UserAuthContext>;
  authenticateRouter(headers: Headers): Promise<UserAuthContext>;
}

export class Authentication implements Authenticator {
  #cache = lru<UserAuthContext>(1000, maxAuthCacheTtl);

  constructor(
    private webAuth: WebSessionAuthenticator,
    private keyAuth: ApiKeyAuthenticator,
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
  public async authenticate(headers: Headers): Promise<UserAuthContext> {
    try {
      /**
       * API keys are authenticated first.
       * First check for the token in the `Authorization` header
       */
      const authorization = headers.get('authorization');
      if (authorization) {
        const token = authorization.replace(/^bearer\s+/i, '');
        return this.keyAuth.authenticate(token);
      }

      /**
       * If no API key is found, check for the `cosmo_user_session` cookie which is used for web sessions.
       * The `cosmo-org-id` header must be set.
       */
      const user = await this.webAuth.authenticate(headers);
      const repo = await this.orgRepo.bySlug(user.organizationSlug);

      if (!repo) {
        throw new Error('organization not found');
      }

      const cacheKey = `${user.userId}:${repo.id}`;
      const cachedUserContext = this.#cache.get(cacheKey);

      if (cachedUserContext) {
        return cachedUserContext;
      }

      /**
       * Validate that the user is a member of the organization.
       */
      const isMember = await this.orgRepo.isMemberOf({
        userId: user.userId,
        organizationId: repo.id,
      });

      if (!isMember) {
        throw new Error('user is not a member of the organization');
      }

      const userContext: UserAuthContext = {
        userId: user.userId,
        organizationId: repo.id,
      };

      this.#cache.set(cacheKey, userContext);

      return userContext;
    } catch {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'invalid user session');
    }
  }

  async authenticateRouter(headers: Headers): Promise<UserAuthContext> {
    const authorization = headers.get('authorization');
    if (authorization) {
      try {
        const token = authorization.replace(/^bearer\s+/i, '');
        return await this.graphKeyAuth.authenticate(token);
      } catch {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'invalid graph token');
      }
    }
    throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'missing graph token');
  }
}
