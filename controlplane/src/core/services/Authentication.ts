import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { lru } from 'tiny-lru';
import { AuthContext } from '../../types/index.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { checkUserAccess } from '../util.js';
import AccessTokenAuthenticator from './AccessTokenAuthenticator.js';
import ApiKeyAuthenticator from './ApiKeyAuthenticator.js';
import GraphApiTokenAuthenticator, { GraphKeyAuthContext } from './GraphApiTokenAuthenticator.js';
import WebSessionAuthenticator from './WebSessionAuthenticator.js';

// The maximum time to cache the user auth context for the web session authentication.
const maxAuthCacheTtl = 30 * 1000; // 30 seconds

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
        const organizationSlug = headers.get('cosmo-org-slug');
        return await this.accessTokenAuth.authenticate(token, organizationSlug);
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

      const userRoles = await this.orgRepo.getOrganizationMemberRoles({
        userID: user.userId,
        organizationID: organization.id,
      });

      const isOrganizationDeactivated = !!organization.deactivation;

      const userContext: AuthContext = {
        auth: user.auth,
        userId: user.userId,
        organizationId: organization.id,
        organizationSlug: organization.slug,
        hasWriteAccess: checkUserAccess({ rolesToBe: ['admin', 'developer'], userRoles }) && !isOrganizationDeactivated,
        isAdmin: userRoles.includes('admin'),
        userDisplayName: user.userDisplayName,
      };

      this.#cache.set(cacheKey, userContext);

      return userContext;
    } catch {
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
