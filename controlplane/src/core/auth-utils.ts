import { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import cookie from 'cookie';
import axios from 'axios';
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addSeconds } from 'date-fns';
import { JWTPayload } from 'jose';
import { uid } from 'uid';
import { CustomAccessTokenClaims, PKCECodeChallenge, UserInfoEndpointResponse, UserSession } from '../types/index.js';
import * as schema from '../db/schema.js';
import { organizationsMembers, sessions, users } from '../db/schema.js';
import { PlatformEventName } from '../../../connect/src/wg/cosmo/notifications/events_pb.js';
import {
  calculatePKCECodeChallenge,
  cosmoIdpHintCookieName,
  decodeJWT,
  decrypt,
  DEFAULT_SESSION_MAX_AGE_SEC,
  encrypt,
  generateRandomCodeVerifier,
} from './crypto/jwt.js';
import { AuthenticationError } from './errors/errors.js';
import { OrganizationRepository } from './repositories/OrganizationRepository.js';
import { OrganizationGroupRepository } from './repositories/OrganizationGroupRepository.js';
import { DefaultNamespace, NamespaceRepository } from './repositories/NamespaceRepository.js';
import Keycloak from './services/Keycloak.js';
import { IPlatformWebhookService } from './webhooks/PlatformWebhookService.js';

export type AuthUtilsOptions = {
  webBaseUrl: string;
  webErrorPath: string;
  ssoCookieDomain: string | undefined;
  jwtSecret: string;
  oauth: {
    clientID: string;
    openIdApiBaseUrl: string;
    openIdFrontendUrl: string;
    redirectUri: string;
    logoutRedirectUri: string;
  };
  session: {
    cookieName: string;
  };
  pkce: {
    cookieName: string;
  };
};

const tokenExpirationWindowSkew = 60 * 5; // 5 minutes
const pkceMaxAgeSec = 60 * 15; // 15 minutes
const pkceCodeAlgorithm = 'S256';
const scope = 'openid profile email';

const axiosStatusValidator = function (status: number): boolean {
  // All user-level (4xx) errors are handled below by returning `AuthenticationError`.
  // For any server errors (5xx), we want to surface those separately.
  return status < 500;
};

export default class AuthUtils {
  private webUrl: URL;
  private readonly webDomain: string;
  private readonly secureCookie: boolean = false;

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private opts: AuthUtilsOptions,
  ) {
    this.webUrl = new URL(opts.webBaseUrl);
    this.webDomain = this.webUrl.hostname.replace(/^[^.]+\./g, '');
    this.secureCookie = this.webUrl.protocol === 'https:';
  }

  // https://www.keycloak.org/docs/latest/upgrading/index.html#openid-connect-logout
  logout(res: FastifyReply, idToken: string) {
    const authorizationUrl = new URL(this.opts.oauth.openIdFrontendUrl + '/protocol/openid-connect/logout');
    authorizationUrl.searchParams.set('id_token_hint', idToken);
    authorizationUrl.searchParams.set('post_logout_redirect_uri', this.opts.oauth.logoutRedirectUri);
    res.redirect(authorizationUrl.toString());
  }

  async parseUserSessionCookie(req: FastifyRequest) {
    const cookies = cookie.parse(req.headers.cookie || '');

    if (!cookies[this.opts.session.cookieName]) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session cookie not found');
    }

    const userSession = await decrypt<UserSession>({
      token: cookies[this.opts.session.cookieName],
      secret: this.opts.jwtSecret,
    });

    if (!userSession) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session cookie could not be found');
    }

    return userSession;
  }

  clearCookie(res: FastifyReply, cookieName: string) {
    const clearPkceCookie = cookie.serialize(cookieName, '', {
      // primary domain
      domain: this.webDomain,
      sameSite: 'lax',
      expires: new Date(1),
      path: '/',
      httpOnly: true,
      secure: this.secureCookie,
    });

    res.header('Set-Cookie', clearPkceCookie);
  }

  createSessionCookie(res: FastifyReply, jwt: string, expTokenDate: Date) {
    const userSessionCookie = cookie.serialize(this.opts.session.cookieName, jwt, {
      domain: this.webDomain,
      sameSite: 'lax',
      expires: expTokenDate,
      path: '/',
      httpOnly: true,
      secure: this.secureCookie,
    });

    res.header('Set-Cookie', userSessionCookie);
  }

  createSsoCookie(res: FastifyReply, ssoSlug: string) {
    const currentDate = new Date();
    const userSsoCookie = cookie.serialize(cosmoIdpHintCookieName, ssoSlug, {
      domain: this.opts.ssoCookieDomain ?? this.webDomain,
      sameSite: 'lax',
      expires: new Date(currentDate.setFullYear(currentDate.getFullYear() + 1)),
      path: '/',
      secure: this.secureCookie,
    });

    res.header('Set-Cookie', userSsoCookie);
  }

  async getUserInfo(accessToken: string) {
    const res = await axios({
      url: this.opts.oauth.openIdApiBaseUrl + '/protocol/openid-connect/userinfo',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      validateStatus: axiosStatusValidator,
    });

    if (res.status !== 200) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Not authenticated');
    }

    return res.data as UserInfoEndpointResponse;
  }

  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
    idToken: string;
  }> {
    const res = await axios({
      url: this.opts.oauth.openIdApiBaseUrl + '/protocol/openid-connect/token',
      method: 'POST',
      data: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: this.opts.oauth.clientID,
        scope,
      }),
      validateStatus: axiosStatusValidator,
    });

    if (res.status !== 200) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Unable to refresh token');
    }

    return {
      accessToken: res.data.access_token,
      accessTokenExpiresIn: res.data.expires_in,
      refreshToken: res.data.refresh_token,
      refreshTokenExpiresIn: res.data.refresh_expires_in,
      idToken: res.data.id_token,
    };
  }

  getRedirectUri({ redirectURL, sso }: { redirectURL?: string; sso?: string }) {
    if (redirectURL && sso) {
      return `${this.opts.oauth.redirectUri}?redirectURL=${redirectURL}&ssoSlug=${sso}`;
    } else if (redirectURL) {
      return `${this.opts.oauth.redirectUri}?redirectURL=${redirectURL}`;
    } else if (sso) {
      return `${this.opts.oauth.redirectUri}?ssoSlug=${sso}`;
    } else {
      return this.opts.oauth.redirectUri;
    }
  }

  async handleLoginRequest(options: {
    redirectURL?: string;
    provider?: string;
    sso?: string;
    action?: 'login' | 'signup';
  }) {
    const { redirectURL, provider, sso, action = 'login' } = options;

    const codeVerifier = await generateRandomCodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

    const authAction = action === 'signup' && !provider ? 'registrations' : 'auth';

    const idpHint = sso || provider;

    const authorizationUrl = new URL(this.opts.oauth.openIdFrontendUrl + '/protocol/openid-connect/' + authAction);
    authorizationUrl.searchParams.set('client_id', this.opts.oauth.clientID);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', pkceCodeAlgorithm);
    authorizationUrl.searchParams.set('redirect_uri', this.getRedirectUri({ redirectURL, sso }));
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', scope);
    if (idpHint) {
      authorizationUrl.searchParams.set('kc_idp_hint', idpHint);
    }

    const jwt = await encrypt<PKCECodeChallenge>({
      maxAgeInSeconds: pkceMaxAgeSec,
      token: {
        codeVerifier,
      },
      secret: this.opts.jwtSecret,
    });

    return {
      pkceCookie: cookie.serialize(this.opts.pkce.cookieName, jwt, {
        domain: this.webDomain,
        sameSite: 'lax',
        path: '/',
        httpOnly: true,
        secure: this.secureCookie,
      }),
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async handleAuthCallbackRequest(
    req: FastifyRequest<{
      Querystring: { code: string; code_verifier: string; redirectURL?: string; ssoSlug?: string };
    }>,
  ): Promise<{
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
    idToken: string;
    sessionState: string;
  }> {
    const code = req.query.code;
    const redirectURL = req.query?.redirectURL;
    const ssoSlug = req.query?.ssoSlug;

    const cookies = cookie.parse(req.headers.cookie || '');

    if (!cookies[this.opts.pkce.cookieName]) {
      throw new AuthenticationError(
        EnumStatusCode.ERROR_NOT_AUTHENTICATED,
        'Code challenge cookie not found on callback',
      );
    }

    const codeChallenge = await decrypt<PKCECodeChallenge>({
      token: cookies[this.opts.pkce.cookieName],
      secret: this.opts.jwtSecret,
    });

    if (!codeChallenge) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Code challenge could not be found');
    }

    const resp = await axios({
      url: this.opts.oauth.openIdApiBaseUrl + '/protocol/openid-connect/token',
      method: 'POST',
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.opts.oauth.clientID,
        code_verifier: codeChallenge?.codeVerifier,
        code,
        redirect_uri: this.getRedirectUri({ redirectURL, sso: ssoSlug }),
      }),
      validateStatus: axiosStatusValidator,
    });

    if (resp.status !== 200) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Token request failed');
    }

    return {
      accessToken: resp.data.access_token,
      accessTokenExpiresIn: resp.data.expires_in,
      refreshToken: resp.data.refresh_token,
      refreshTokenExpiresIn: resp.data.refresh_expires_in,
      idToken: resp.data.id_token,
      sessionState: resp.data.session_state,
    };
  }

  public static isSessionExpired(session: { createdAt: Date; updatedAt: Date | null; expiresAt: Date }): boolean {
    const now = new Date();
    if (session.expiresAt <= now) {
      // Session reached end-of-life
      return true;
    }

    const sessionLastUpdatedOrCreation = session.updatedAt ?? session.createdAt;
    const sessionExpiresAt = addSeconds(sessionLastUpdatedOrCreation, DEFAULT_SESSION_MAX_AGE_SEC);
    return sessionExpiresAt <= now;
  }

  /**
   * renewSession renews the user session if the access token is expired.
   * If the refresh token is expired, an error is thrown.
   */
  public async renewSession(req: FastifyRequest, res: FastifyReply) {
    // Will throw an error if the cookie is invalid or not present
    const { sessionId } = await this.parseUserSessionCookie(req);

    const userSessions = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1).execute();

    if (userSessions.length === 0) {
      throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session not found');
    }

    const userSession = userSessions[0];

    // Check if the access token is expired
    const parsedAccessToken = decodeJWT(userSession.accessToken);
    if (parsedAccessToken.exp && parsedAccessToken.exp < Date.now() / 1000 + tokenExpirationWindowSkew) {
      if (!userSession.refreshToken) {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'No refresh token');
      }

      // Check if the refresh token is valid to issue a new access token
      const parsedRefreshToken = decodeJWT(userSession.refreshToken);
      if (parsedRefreshToken.exp && parsedRefreshToken.exp < Date.now() / 1000) {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Refresh token expired');
      }

      // The session expiration is relative
      if (AuthUtils.isSessionExpired(userSession)) {
        // Absolute session lifetime has elapsed; do not renew.
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session expired');
      }

      // Refresh the access token with the refresh token
      // The method will throw an error if the request fails
      const now = new Date();
      const { accessToken, refreshToken, idToken } = await this.refreshToken(userSession.refreshToken);

      // Update active session
      const expiresAt = addSeconds(now, DEFAULT_SESSION_MAX_AGE_SEC);
      const updatedSessions = await this.db
        .update(sessions)
        .set({
          accessToken,
          refreshToken,
          expiresAt,
          idToken,
          updatedAt: now,
        })
        .where(eq(sessions.id, sessionId))
        .returning()
        .execute();

      if (updatedSessions.length === 0) {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session not found');
      }

      const newUserSession = updatedSessions[0];

      const jwt = await encrypt<UserSession>({
        maxAgeInSeconds: DEFAULT_SESSION_MAX_AGE_SEC,
        token: {
          iss: userSession.userId,
          sessionId: newUserSession.id,
        },
        secret: this.opts.jwtSecret,
      });

      // Update the session cookie
      this.createSessionCookie(res, jwt, expiresAt);

      return newUserSession;
    }

    return userSession;
  }

  static async handleAuthCallback({
    db,
    keycloakClient,
    keycloakRealm,
    tokenPayload,
    platformWebhooks,
    logger,
    defaultBillingPlanId,
    cookies,
    sessionData,
  }: {
    db: PostgresJsDatabase<typeof schema>;
    keycloakClient: Keycloak;
    keycloakRealm: string;
    tokenPayload: CustomAccessTokenClaims & JWTPayload;
    platformWebhooks: IPlatformWebhookService;
    logger: FastifyBaseLogger;
    defaultBillingPlanId: string | undefined;
    cookies?: Record<string, string>;
    sessionData?: {
      accessToken: string;
      refreshToken: string;
      idToken: string;
    };
  }): Promise<[{ id: string; userId: string } | undefined, number]> {
    const userId = tokenPayload.sub!;
    const userEmail = tokenPayload.email!;
    const firstName = tokenPayload.given_name || '';
    const lastName = tokenPayload.family_name || '';

    const [insertedSession, numberOfOrganizations] = await db.transaction(async (tx) => {
      const advisoryLockRows = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${userId})) as acquired`);
      if (!advisoryLockRows?.[0]?.acquired) {
        // We need to identify when we failed to acquire the lock because another request already acquired it
        return [undefined, -1];
      }

      return [
        await AuthUtils.#createUserAndSessionIfNeeded({
          db: tx,
          tokenPayload,
          logger,
          defaultBillingPlanId,
          sessionData,
        }),
        // Retrieve the number of organizations the user is a member of or create the initial organization if this
        // is the first time we are seeing the user
        await AuthUtils.#ensureUserMemberships({
          db: tx,
          keycloakClient,
          keycloakRealm,
          tokenPayload,
          logger,
          defaultBillingPlanId,
        }),
      ];
    });

    if (numberOfOrganizations === 0) {
      // Send a notification to the platform that a new user has been created
      try {
        await platformWebhooks.send(PlatformEventName.USER_REGISTER_SUCCESS, {
          user_id: userId,
          user_email: userEmail,
          user_first_name: firstName,
          user_last_name: lastName,
          utm_source: cookies?.utm_source,
          utm_medium: cookies?.utm_medium,
          utm_campaign: cookies?.utm_campaign,
          utm_content: cookies?.utm_content,
          utm_term: cookies?.utm_term,
        });
      } catch (error: unknown) {
        logger.error(error, 'Failed to send the user registered notification webhook');
      }
    }

    return [insertedSession, numberOfOrganizations];
  }

  static async #createUserAndSessionIfNeeded({
    db,
    tokenPayload,
    logger,
    defaultBillingPlanId,
    sessionData,
  }: {
    db: PostgresJsDatabase<typeof schema>;
    tokenPayload: CustomAccessTokenClaims & JWTPayload;
    logger: FastifyBaseLogger;
    defaultBillingPlanId: string | undefined;
    sessionData?: {
      accessToken: string;
      refreshToken: string;
      idToken: string;
    };
  }) {
    const userId = tokenPayload.sub!;
    const userEmail = tokenPayload.email!;
    const groups = tokenPayload.groups;
    const sessionExpiresDate = new Date(Date.now() + 1000 * DEFAULT_SESSION_MAX_AGE_SEC);

    // Upsert the user
    await db
      .insert(users)
      .values({
        id: userId,
        email: userEmail,
      })
      .onConflictDoUpdate({
        target: users.id,
        // Update the fields when the user already exists
        set: {
          email: userEmail,
        },
      })
      .execute();

    if (groups && groups.length > 0) {
      const keycloakOrganizations = new Set(groups.map((grp) => grp.split('/')[1]));
      const orgRepo = new OrganizationRepository(logger, db, defaultBillingPlanId);
      const orgGroupRepo = new OrganizationGroupRepository(db);

      // delete all the organization member roles
      for (const slug of keycloakOrganizations) {
        const dbOrg = await orgRepo.bySlug(slug);
        if (!dbOrg) {
          continue;
        }

        const orgMember = await orgRepo.getOrganizationMember({ organizationID: dbOrg.id, userID: userId });
        if (!orgMember) {
          continue;
        }

        await db
          .delete(schema.organizationGroupMembers)
          .where(eq(schema.organizationGroupMembers.organizationMemberId, orgMember.orgMemberID));
      }

      // upserting the members into the organizations and inserting their roles.
      for (const kcGroup of groups) {
        const slug = kcGroup.split('/')[1];
        const dbOrg = await orgRepo.bySlug(slug);
        if (!dbOrg) {
          continue;
        }

        const insertedMember = await db
          .insert(organizationsMembers)
          .values({
            userId,
            organizationId: dbOrg.id,
          })
          .onConflictDoUpdate({
            target: [organizationsMembers.userId, organizationsMembers.organizationId],
            // Update the fields only when the org member already exists
            set: {
              userId,
              organizationId: dbOrg.id,
            },
          })
          .returning()
          .execute();

        const groupName = kcGroup.split('/')?.[2];
        if (!groupName) {
          continue;
        }

        const orgGroup = await orgGroupRepo.byName({
          organizationId: dbOrg.id,
          name: groupName,
        });

        if (!orgGroup) {
          // The group doesn't exist for the organization, instead of failing, we'll just skip the group
          continue;
        }

        await orgGroupRepo.addUserToGroup({
          organizationMemberId: insertedMember[0].id,
          groupId: orgGroup.groupId,
        });
      }
    }

    if (!sessionData) {
      return undefined;
    }

    // If there is already a session for this user, update it.
    // Otherwise, insert a new session. Because we use an Idp like keycloak,
    // we can assume that the user will have only one session per client at a time.
    const { accessToken, refreshToken, idToken } = sessionData;
    const insertedSessions = await db
      .insert(sessions)
      .values({
        userId,
        idToken,
        accessToken,
        refreshToken,
        expiresAt: sessionExpiresDate,
      })
      .onConflictDoUpdate({
        target: sessions.userId,
        // Update the fields when the session already exists
        set: {
          idToken,
          accessToken,
          refreshToken,
          expiresAt: sessionExpiresDate,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: sessions.id,
        userId: sessions.userId,
      })
      .execute();

    return insertedSessions[0];
  }

  static async #ensureUserMemberships({
    db,
    keycloakClient,
    keycloakRealm,
    tokenPayload,
    logger,
    defaultBillingPlanId,
  }: {
    db: PostgresJsDatabase<typeof schema>;
    keycloakClient: Keycloak;
    keycloakRealm: string;
    tokenPayload: CustomAccessTokenClaims & JWTPayload;
    logger: FastifyBaseLogger;
    defaultBillingPlanId: string | undefined;
  }) {
    const userId = tokenPayload.sub!;
    const userEmail = tokenPayload.email!;
    const orgRepo = new OrganizationRepository(logger, db, defaultBillingPlanId);

    // Check if the user is already a member of at least one organization
    const existingMemberships = await db
      .select({ one: sql<number>`1`.as('one') })
      .from(organizationsMembers)
      .where(and(eq(organizationsMembers.userId, userId), eq(organizationsMembers.active, true)))
      .limit(1)
      .execute();

    if (existingMemberships.length > 0) {
      return existingMemberships.length;
    }

    // Authenticate on Keycloak and create the organization group
    await keycloakClient.authenticateClient();

    const organizationSlug = uid(8);
    const [kcRootGroupId, kcCreatedGroups] = await keycloakClient.seedGroup({
      userID: userId,
      organizationSlug,
      realm: keycloakRealm,
    });

    // Create the new organization and add the user as a member of the organization
    const insertedOrg = await orgRepo.createOrganization({
      organizationName: userEmail.split('@')[0],
      organizationSlug,
      ownerID: userId,
      kcGroupId: kcRootGroupId,
    });

    const orgMember = await orgRepo.addOrganizationMember({
      organizationID: insertedOrg.id,
      userID: userId,
    });

    // Create the organization groups
    const orgGroupRepo = new OrganizationGroupRepository(db);
    await orgGroupRepo.importKeycloakGroups({
      organizationId: insertedOrg.id,
      kcGroups: kcCreatedGroups,
    });

    const orgAdminGroup = await orgGroupRepo.byName({
      organizationId: insertedOrg.id,
      name: 'admin',
    });

    if (orgAdminGroup) {
      await orgGroupRepo.addUserToGroup({
        organizationMemberId: orgMember.id,
        groupId: orgAdminGroup.groupId,
      });
    }

    // Create the default namespace for the organization
    const namespaceRepo = new NamespaceRepository(db, insertedOrg.id);
    const ns = await namespaceRepo.create({
      name: DefaultNamespace,
      createdBy: userId,
    });

    if (!ns) {
      throw new Error(`Could not create ${DefaultNamespace} namespace`);
    }

    // We return an empty even when we just created the organization, that way we can still send the
    // user registered webhook and prompt the user to migrate
    return 0;
  }
}
