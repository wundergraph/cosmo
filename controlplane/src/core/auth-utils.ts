import { FastifyReply, FastifyRequest } from 'fastify';
import cookie from 'cookie';
import axios from 'axios';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PKCECodeChallenge, UserInfoEndpointResponse, UserSession } from '../types/index.js';
import * as schema from '../db/schema.js';
import { sessions } from '../db/schema.js';
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

export type AuthUtilsOptions = {
  webBaseUrl: string;
  webErrorPath: string;
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

const pkceMaxAgeSec = 60 * 15; // 15 minutes
const pkceCodeAlgorithm = 'S256';
const scope = 'openid profile email';

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
      domain: this.webDomain,
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
      maxAge: pkceMaxAgeSec,
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
    if (parsedAccessToken.exp && parsedAccessToken.exp < Date.now() / 1000) {
      const parsedRefreshToken = decodeJWT(userSession.accessToken);

      // Check if the refresh token is valid to issue a new access token
      if (parsedRefreshToken.exp && parsedRefreshToken.exp < Date.now() / 1000) {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Refresh token expired');
      }

      const sessionExpiresIn = DEFAULT_SESSION_MAX_AGE_SEC;
      const sessionExpiresDate = new Date(Date.now() + 1000 * sessionExpiresIn);

      // Refresh the access token with the refresh token
      // The method will throw an error if the request fails
      const { accessToken, refreshToken, idToken } = await this.refreshToken(userSession.refreshToken);

      // Update active session
      const updatedSessions = await this.db
        .update(sessions)
        .set({
          accessToken,
          refreshToken,
          expiresAt: sessionExpiresDate,
          idToken,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId))
        .returning()
        .execute();

      if (updatedSessions.length === 0) {
        throw new AuthenticationError(EnumStatusCode.ERROR_NOT_AUTHENTICATED, 'Session not found');
      }

      const newUserSession = updatedSessions[0];

      const jwt = await encrypt<UserSession>({
        maxAge: sessionExpiresIn,
        token: {
          sessionId: newUserSession.id,
        },
        secret: this.opts.jwtSecret,
      });

      // Update the session cookie
      this.createSessionCookie(res, jwt, sessionExpiresDate);

      return newUserSession;
    }

    return userSession;
  }
}
