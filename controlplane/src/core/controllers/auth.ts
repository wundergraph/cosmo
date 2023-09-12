import { randomUUID } from 'node:crypto';
import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { lru } from 'tiny-lru';
import { uid } from 'uid';
import { decodeJWT, DEFAULT_SESSION_MAX_AGE_SEC, encrypt } from '../crypto/jwt.js';
import { CustomAccessTokenClaims, UserInfoEndpointResponse, UserSession } from '../../types/index.js';
import * as schema from '../../db/schema.js';
import { organizationMemberRoles, organizations, organizationsMembers, sessions, users } from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import AuthUtils from '../auth-utils.js';
import WebSessionAuthenticator from '../services/WebSessionAuthenticator.js';
import Keycloak from '../services/Keycloak.js';

export type AuthControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  organizationRepository: OrganizationRepository;
  webAuth: WebSessionAuthenticator;
  authUtils: AuthUtils;
  webBaseUrl: string;
  jwtSecret: string;
  pkce: {
    cookieName: string;
  };
  session: {
    cookieName: string;
  };
  keycloakClient: Keycloak;
  keycloakRealm: string;
};

const plugin: FastifyPluginCallback<AuthControllerOptions> = function Auth(fastify, opts, done) {
  const keycloakUserInfoCache = lru<UserInfoEndpointResponse>(1000, 15_000);

  fastify.get('/session', async (req, res) => {
    try {
      const userSession = await opts.authUtils.renewSession(req, res);
      let userInfoData = keycloakUserInfoCache.get(userSession.accessToken);

      if (userInfoData === undefined) {
        userInfoData = await opts.authUtils.getUserInfo(userSession.accessToken);
        keycloakUserInfoCache.set(userSession.accessToken, userInfoData);
      }

      const orgs = await opts.organizationRepository.memberships({
        userId: userSession.userId,
      });

      return {
        id: userSession.userId,
        email: userInfoData.email,
        organizations: orgs,
        roles: await opts.organizationRepository.getOrganizationMemberRoles({
          userID: userSession.userId,
          // just passing the first org because we are limiting the user to onyly be a part of a single organization.
          organizationID: orgs[0].id,
        }),
        expiresAt: userSession.expiresAt,
      };
    } catch (err: any) {
      req.log.error(err);

      req.log.error('Cookie cleared due to error in /session route');

      // We assume that the session is invalid if there is an error
      // Clear the session cookie and redirect the user to the login page on the frontend
      opts.authUtils.clearCookie(res, opts.session.cookieName);

      res.status(401);
    }
  });

  fastify.get('/logout', async (req, res) => {
    // Will throw an error if the token is invalid or expired
    const { sessionId } = await opts.authUtils.parseUserSessionCookie(req);

    const userSessions = await opts.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1).execute();

    // Clear the session cookie
    opts.authUtils.clearCookie(res, opts.session.cookieName);

    if (userSessions.length === 0) {
      // If the session doesn't exist, redirect to the login page
      res.redirect(opts.webBaseUrl + '/login');
      return;
    }

    // Delete the active session
    await opts.db.delete(sessions).where(eq(sessions.id, sessionId)).execute();

    opts.authUtils.logout(res, userSessions[0].idToken);
  });

  fastify.get<{ Querystring: { code: string; code_verifier: string } }>('/callback', async (req, res) => {
    const { accessToken, refreshToken, idToken } = await opts.authUtils.handleAuthCallbackRequest(req);

    // decodeJWT will throw an error if the token is invalid or expired
    const accessTokenPayload = decodeJWT<CustomAccessTokenClaims>(accessToken);

    // Clear the PKCE cookie
    opts.authUtils.clearCookie(res, opts.pkce.cookieName);

    const sessionExpiresIn = DEFAULT_SESSION_MAX_AGE_SEC;
    const sessionExpiresDate = new Date(Date.now() + 1000 * sessionExpiresIn);

    const userId = accessTokenPayload.sub!;
    const userEmail = accessTokenPayload.email!;

    const insertedSession = await opts.db.transaction(async (db) => {
      // Upsert the user
      await db
        .insert(users)
        .values({
          id: userId,
          email: accessTokenPayload.email,
        })
        .onConflictDoUpdate({
          target: users.id,
          // Update the fields when the user already exists
          set: {
            email: accessTokenPayload.email,
          },
        })
        .execute();

      // update the organizationMember table to indicate that the user has accepted the invite
      await db
        .update(organizationsMembers)
        .set({ acceptedInvite: true })
        .where(eq(organizationsMembers.userId, userId))
        .execute();

      // If there is already a session for this user, update it.
      // Otherwise, insert a new session. Because we use an Idp like keycloak,
      // we can assume that the user will have only one session per client at a time.
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
    });

    const orgs = await opts.organizationRepository.memberships({
      userId,
    });
    if (orgs.length === 0) {
      await opts.keycloakClient.authenticateClient();

      const organizationSlug = uid(8);

      await opts.keycloakClient.seedGroup({ userID: userId, organizationSlug, realm: opts.keycloakRealm });

      await opts.db.transaction(async (db) => {
        const orgRepo = new OrganizationRepository(db);

        const insertedOrg = await orgRepo.createOrganization({
          organizationName: userEmail.split('@')[0],
          organizationSlug,
          ownerID: userId,
          isFreeTrial: true,
        });

        const orgMember = await orgRepo.addOrganizationMember({
          organizationID: insertedOrg.id,
          userID: userId,
          acceptedInvite: true,
        });

        await orgRepo.addOrganizationMemberRoles({
          memberID: orgMember.id,
          roles: ['admin'],
        });
      });
    }

    // Create a JWT token containing the session id and user id.
    const jwt = await encrypt<UserSession>({
      maxAge: sessionExpiresIn,
      token: {
        iss: userId,
        sessionId: insertedSession.id,
      },
      secret: opts.jwtSecret,
    });

    // Set the session cookie. The cookie value is encrypted.
    opts.authUtils.createSessionCookie(res, jwt, sessionExpiresDate);

    if (orgs.length === 0) {
      res.redirect(opts.webBaseUrl + '?migrate=true');
    }

    res.redirect(opts.webBaseUrl);
  });

  fastify.get('/login', async (req, res) => {
    const { authorizationUrl, pkceCookie } = await opts.authUtils.handleLoginRequest();

    res.header('Set-Cookie', pkceCookie);

    res.redirect(authorizationUrl);
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
