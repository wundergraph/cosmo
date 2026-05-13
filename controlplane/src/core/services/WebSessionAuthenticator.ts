import cookie from 'cookie';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { UserSession } from '../../types/index.js';
import { decrypt, userSessionCookieName } from '../crypto/jwt.js';
import { UserRepository } from '../repositories/UserRepository.js';
import * as schema from '../../db/schema.js';
import AuthUtils from '../auth-utils.js';
import { AuthenticationError } from '../errors/errors.js';
import { traced } from '../tracing.js';

export const OrganizationSlugHeader = 'cosmo-org-slug';

export type WebAuthAuthContext = {
  auth: 'cookie';
  userId: string;
  organizationSlug: string;
  userDisplayName: string;
};

@traced
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
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Missing user id in JWT');
        }

        // Ensure that the session is still valid
        if (!decryptedJwt.sessionId) {
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Missing session id in JWT');
        }

        const existingSessions = await this.db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, decryptedJwt.sessionId))
          .limit(1)
          .execute();

        if (
          existingSessions.length !== 1 ||
          existingSessions[0].userId.toLowerCase() !== decryptedJwt.iss?.toLowerCase() ||
          AuthUtils.isSessionExpired(existingSessions[0])
        ) {
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Invalid or expired session');
        }

        const organizationSlug = headers.get(OrganizationSlugHeader);
        if (!organizationSlug) {
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Missing organization slug header');
        }

        const user = await this.userRepository.byId(decryptedJwt.iss);
        if (!user) {
          throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'User not found');
        }

        return {
          auth: 'cookie',
          userId: decryptedJwt.iss,
          organizationSlug,
          userDisplayName: user.email,
        };
      }
    }

    throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Missing user session cookie');
  }
}
