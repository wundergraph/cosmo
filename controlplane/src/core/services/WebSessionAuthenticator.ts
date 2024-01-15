import cookie from 'cookie';
import { UserSession } from '../../types/index.js';
import { decrypt, userSessionCookieName } from '../crypto/jwt.js';
import { UserRepository } from '../repositories/UserRepository.js';

export const OrganizationSlugHeader = 'cosmo-org-slug';

export type WebAuthAuthContext = {
  userId: string;
  organizationSlug: string;
  userDisplayName: string;
};

export default class WebSessionAuthenticator {
  constructor(
    private jwtSecret: string,
    private userRepository: UserRepository,
  ) {}

  /**
   * authenticate authenticates a user based on the presence of a JWT in a cookie.
   * This method also resolves the organization slug from the "cosmo-org-slug" header,
   * if the organization slug is not present in the header, an error is thrown.
   * You are still responsible for checking if the organization exists and if the user is a member of the organization.
   */
  public async authenticate(headers: Headers): Promise<WebAuthAuthContext> {
    const cookieValue = headers.get('cookie');

    if (cookieValue) {
      const cookies = cookie.parse(cookieValue);
      const token = cookies[userSessionCookieName];
      if (token) {
        const decryptedJwt = await decrypt<UserSession>({
          secret: this.jwtSecret,
          token,
        });

        if (!decryptedJwt.iss) {
          throw new Error('Missing user id in JWT');
        }

        const organizationSlug = headers.get(OrganizationSlugHeader);
        if (!organizationSlug) {
          throw new Error('Missing organization slug header');
        }

        const user = await this.userRepository.byId(decryptedJwt.iss);
        if (!user) {
          throw new Error('User not found');
        }

        return {
          userId: decryptedJwt.iss,
          organizationSlug,
          userDisplayName: user.email,
        };
      }
    }

    throw new Error('Missing user session cookie');
  }
}
