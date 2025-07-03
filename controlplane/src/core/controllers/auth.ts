import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { lru } from 'tiny-lru';
import { uid } from 'uid';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { cosmoIdpHintCookieName, decodeJWT, DEFAULT_SESSION_MAX_AGE_SEC, encrypt } from '../crypto/jwt.js';
import { CustomAccessTokenClaims, UserInfoEndpointResponse, UserSession } from '../../types/index.js';
import * as schema from '../../db/schema.js';
import { organizationsMembers, sessions, users } from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import AuthUtils from '../auth-utils.js';
import WebSessionAuthenticator from '../services/WebSessionAuthenticator.js';
import Keycloak from '../services/Keycloak.js';
import { IPlatformWebhookService } from '../webhooks/PlatformWebhookService.js';
import { AuthenticationError } from '../errors/errors.js';
import { OrganizationInvitationRepository } from '../repositories/OrganizationInvitationRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../repositories/NamespaceRepository.js';
import { OrganizationGroupRepository } from '../repositories/OrganizationGroupRepository.js';

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

  fastify.get<{ Querystring: { code: string; code_verifier: string; redirectURL?: string; ssoSlug?: string } }>(
    '/callback',
    async (req, res) => {
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

        const userId = accessTokenPayload.sub!;
        const userEmail = accessTokenPayload.email!;
        const firstName = accessTokenPayload.given_name || '';
        const lastName = accessTokenPayload.family_name || '';

        const insertedSession = await opts.db.transaction(async (tx) => {
          // Upsert the user
          await tx
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

          if (accessTokenPayload.groups && accessTokenPayload.groups.length > 0) {
            const keycloakOrgs = new Set(accessTokenPayload.groups.map((grp) => grp.split('/')[1]));
            const orgRepo = new OrganizationRepository(req.log, tx, opts.defaultBillingPlanId);
            const orgGroupRepo = new OrganizationGroupRepository(tx);

            // delete all the org member roles
            for (const slug of keycloakOrgs) {
              const dbOrg = await orgRepo.bySlug(slug);

              if (!dbOrg) {
                continue;
              }

              const orgMember = await orgRepo.getOrganizationMember({ organizationID: dbOrg.id, userID: userId });
              if (!orgMember) {
                continue;
              }

              await tx
                .delete(schema.organizationGroupMembers)
                .where(eq(schema.organizationGroupMembers.organizationMemberId, orgMember.orgMemberID));
            }

            // upserting the members into the orgs and inserting their roles.
            for (const kcGroup of accessTokenPayload.groups) {
              const slug = kcGroup.split('/')[1];
              const dbOrg = await orgRepo.bySlug(slug);
              if (!dbOrg) {
                continue;
              }

              const insertedMember = await tx
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

          // If there is already a session for this user, update it.
          // Otherwise, insert a new session. Because we use an Idp like keycloak,
          // we can assume that the user will have only one session per client at a time.
          const insertedSessions = await tx
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

          const [kcRootGroupId, kcCreatedGroups] = await opts.keycloakClient.seedGroup({
            userID: userId,
            organizationSlug,
            realm: opts.keycloakRealm,
          });

          await opts.db.transaction(async (tx) => {
            const orgRepo = new OrganizationRepository(req.log, tx, opts.defaultBillingPlanId);
            const orgGroupRepo = new OrganizationGroupRepository(tx);

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

            const namespaceRepo = new NamespaceRepository(tx, insertedOrg.id);
            const ns = await namespaceRepo.create({
              name: DefaultNamespace,
              createdBy: userId,
            });
            if (!ns) {
              throw new Error(`Could not create ${DefaultNamespace} namespace`);
            }
          });

          opts.platformWebhooks.send(PlatformEventName.USER_REGISTER_SUCCESS, {
            user_id: userId,
            user_email: userEmail,
            user_first_name: firstName,
            user_last_name: lastName,
          });
        }

        // Create a JWT token containing the session id and user id.
        const jwt = await encrypt<UserSession>({
          maxAgeInSeconds: sessionExpiresIn,
          token: {
            iss: userId,
            sessionId: insertedSession.id,
          },
          secret: opts.jwtSecret,
        });

        // Set the session cookie. The cookie value is encrypted.
        opts.authUtils.createSessionCookie(res, jwt, sessionExpiresDate);
        if (ssoSlug) {
          // Set the sso cookie.
          opts.authUtils.createSsoCookie(res, ssoSlug);
        }
        if (redirectURL) {
          if (redirectURL.startsWith(opts.webBaseUrl)) {
            res.redirect(redirectURL);
          } else {
            res.redirect(opts.webBaseUrl);
          }
        } else if (orgs.length === 0) {
          res.redirect(opts.webBaseUrl + '?migrate=true');
        } else {
          res.redirect(opts.webBaseUrl);
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
    },
  );

  fastify.get<{
    Querystring: { redirectURL?: string; provider?: string; sso?: string };
  }>('/login', async (req, res) => {
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

  fastify.get<{
    Querystring: { redirectURL?: string; provider?: string };
  }>('/signup', async (req, res) => {
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
