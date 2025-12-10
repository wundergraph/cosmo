import cookie from 'cookie';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { UserSession } from '../../types/index.js';
import { decrypt, userSessionCookieName } from '../crypto/jwt.js';
import { UserRepository } from '../repositories/UserRepository.js';
import * as schema from '../../db/schema.js';
import AuthUtils from '../auth-utils.js';

export const OrganizationSlugHeader = 'cosmo-org-slug';

export type WebAuthAuthContext = {
  auth: 'cookie';
  userId: string;
  organizationSlug: string;
  userDisplayName: string;
};

export default class WebSessionAuthenticator {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
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

        // Ensure that the session is still valid
        if (!decryptedJwt.sessionId) {
          throw new Error('Missing session id in JWT');
        }

        const existingSessions = await this.db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, decryptedJwt.sessionId))
          .limit(1)
          .execute();

        if (existingSessions.length !== 1 || AuthUtils.isSessionExpired(existingSessions[0])) {
          throw new Error('Invalid or expired session');
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
          auth: 'cookie',
          userId: decryptedJwt.iss,
          organizationSlug,
          userDisplayName: user.email,
        };
      }
    }

    throw new Error('Missing user session cookie');
  }
}
