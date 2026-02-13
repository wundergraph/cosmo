import { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { lru } from 'tiny-lru';
import cookie from 'cookie';
import { cosmoIdpHintCookieName, decodeJWT, DEFAULT_SESSION_MAX_AGE_SEC, encrypt } from '../crypto/jwt.js';
import { CustomAccessTokenClaims, UserInfoEndpointResponse, UserSession } from '../../types/index.js';
import * as schema from '../../db/schema.js';
import { sessions } from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import AuthUtils from '../auth-utils.js';
import WebSessionAuthenticator from '../services/WebSessionAuthenticator.js';
import Keycloak from '../services/Keycloak.js';
import { IPlatformWebhookService } from '../webhooks/PlatformWebhookService.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationInvitationRepository } from '../repositories/OrganizationInvitationRepository.js';

export type AuthControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  organizationRepository: OrganizationRepository;
  orgInvitationRepository: OrganizationInvitationRepository;
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
  platformWebhooks: IPlatformWebhookService;
  defaultBillingPlanId?: string;
};

type SessionRequest = FastifyRequest;
type SessionReply = FastifyReply;
type LogoutRequest = FastifyRequest;
type LogoutReply = FastifyReply;

type CallbackRequest = FastifyRequest<{
  Querystring: {
    code: string;
    code_verifier: string;
    redirectURL?: string;
    ssoSlug?: string;
  };
}>;
type CallbackReply = FastifyReply;

type LoginRequest = FastifyRequest<{
  Querystring: {
    redirectURL?: string;
    provider?: string;
    sso?: string;
  };
}>;
type LoginReply = FastifyReply;

type SignupRequest = FastifyRequest<{
  Querystring: {
    redirectURL?: string;
    provider?: string;
  };
}>;
type SignupReply = FastifyReply;

const plugin: FastifyPluginCallback<AuthControllerOptions> = function Auth(fastify, opts, done) {
  const keycloakUserInfoCache = lru<UserInfoEndpointResponse>(1000, 15_000);

  fastify.get('/session', async (req: SessionRequest, res: SessionReply) => {
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

      const invitations = await opts.orgInvitationRepository.getPendingInvitationsOfUser({
        userId: userSession.userId,
      });

      return {
        id: userSession.userId,
        email: userInfoData.email,
        organizations: orgs
          .filter((o) => !o.deletion || o.rbac.isOrganizationAdmin)
          .map(({ rbac, ...org }) => ({
            ...org,
            groups: rbac.groups.map(({ description, kcGroupId, ...rest }) => ({
              ...rest,
            })),
          })),
        invitations,
        expiresAt: userSession.expiresAt,
      };
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        req.log.debug(err);
      } else {
        req.log.error(err);
      }

      req.log.debug('Cookie cleared due to error in /session route');

      // We assume that the session is invalid if there is an error
      // Clear the session cookie and redirect the user to the login page on the frontend
      opts.authUtils.clearCookie(res, opts.session.cookieName);

      res.status(401);
    }
  });

  fastify.get('/logout', async (req: LogoutRequest, res: LogoutReply) => {
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

  fastify.get('/callback', async (req: CallbackRequest, res: CallbackReply) => {
    try {
      const redirectURL = req.query?.redirectURL;
      const ssoSlug = req.query?.ssoSlug;
      const { accessToken, refreshToken, idToken } = await opts.authUtils.handleAuthCallbackRequest(req);

      // decodeJWT will throw an error if the token is invalid or expired
      const accessTokenPayload = decodeJWT<CustomAccessTokenClaims>(accessToken);

      // Clear the PKCE cookie
      opts.authUtils.clearCookie(res, opts.pkce.cookieName);
      // Clear the sso cookie
      opts.authUtils.clearCookie(res, cosmoIdpHintCookieName);

      const sessionExpiresIn = DEFAULT_SESSION_MAX_AGE_SEC;
      const sessionExpiresDate = new Date(Date.now() + 1000 * sessionExpiresIn);

      const [insertedSession, orgs] = await AuthUtils.handleAuthCallback({
        db: opts.db,
        keycloakClient: opts.keycloakClient,
        keycloakRealm: opts.keycloakRealm,
        tokenPayload: accessTokenPayload,
        platformWebhooks: opts.platformWebhooks,
        logger: req.log,
        defaultBillingPlanId: opts.defaultBillingPlanId,
        cookies: cookie.parse(req.headers.cookie || ''),
        sessionData: {
          accessToken,
          refreshToken,
          idToken,
        },
      });

      if (orgs === -1) {
        // We failed to acquire the lock, so we need to retry the request
        await res.code(429).send('Slow down');
        return;
      }

      // Create a JWT token containing the session id and user id.
      const jwt = await encrypt<UserSession>({
        maxAgeInSeconds: sessionExpiresIn,
        token: {
          sessionId: insertedSession!.id,
          iss: insertedSession!.userId,
        },
        secret: opts.jwtSecret,
      });

      // Set the session cookie. The cookie value is encrypted.
      opts.authUtils.createSessionCookie(res, jwt, sessionExpiresDate);
      if (ssoSlug) {
        // Set the sso cookie.
        opts.authUtils.createSsoCookie(res, ssoSlug);
      }
      // Determine the target URL
      let targetUrl = opts.webBaseUrl;
      if (redirectURL) {
        try {
          const redirectOrigin = new URL(redirectURL).origin;
          const webBaseOrigin = new URL(opts.webBaseUrl).origin;
          if (redirectOrigin === webBaseOrigin) {
            targetUrl = redirectURL;
          }
        } catch {
          // On parse error, keep targetUrl as opts.webBaseUrl
        }
      }

      // Append onboarding parameter if the user has no orgs
      if (orgs === 0) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        res.redirect(targetUrl + separator + 'onboarding=true');
      } else {
        res.redirect(targetUrl);
      }
    } catch (err: any) {
      if (err instanceof AuthenticationError) {
        req.log.debug(err);
      } else {
        req.log.error(err);
      }

      req.log.debug('Redirecting to home due to error in /callback route');

      res.redirect(opts.webBaseUrl);
    }
  });

  fastify.get('/login', async (req: LoginRequest, res: LoginReply) => {
    const redirectURL = req.query?.redirectURL;
    const provider = req.query?.provider;
    const sso = req.query?.sso;
    const { authorizationUrl, pkceCookie } = await opts.authUtils.handleLoginRequest({
      redirectURL,
      provider,
      sso,
    });

    res.header('Set-Cookie', pkceCookie);

    res.redirect(authorizationUrl);
  });

  fastify.get('/signup', async (req: SignupRequest, res: SignupReply) => {
    const redirectURL = req.query?.redirectURL;
    const provider = req.query?.provider;
    const { authorizationUrl, pkceCookie } = await opts.authUtils.handleLoginRequest({
      redirectURL,
      provider,
      action: 'signup',
    });

    res.header('Set-Cookie', pkceCookie);

    res.redirect(authorizationUrl);
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
