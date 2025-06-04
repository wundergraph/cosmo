import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import ApiKeyAuthenticator, { ApiKeyAuthContext } from '../services/ApiKeyAuthenticator.js';
import Keycloak from '../services/Keycloak.js';
import { ApiKeyRepository } from '../repositories/ApiKeyRepository.js';

export type ScimControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  organizationRepository: OrganizationRepository;
  userRepository: UserRepository;
  apiKeyRepository: ApiKeyRepository;
  authenticator: ApiKeyAuthenticator;
  keycloakClient: Keycloak;
  keycloakRealm: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    authContext: ApiKeyAuthContext;
  }
}

const ScimError = ({ detail, status }: { detail: string; status: number }) => {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail,
    status,
  };
};

// https://developer.okta.com/docs/reference/scim/scim-20/
const plugin: FastifyPluginCallback<ScimControllerOptions> = function Scim(fastify, opts, done) {
  fastify.addContentTypeParser('application/scim+json', { parseAs: 'string' }, function (req, body, done) {
    try {
      const json = JSON.parse(body.toString());
      done(null, json);
    } catch (err: any) {
      done(err);
    }
  });

  fastify.addHook('preHandler', async (req, res) => {
    try {
      const authorization = req.headers.authorization;
      if (!authorization) {
        return res.code(401).send(
          ScimError({
            detail: 'Missing Authorization header.',
            status: 401,
          }),
        );
      }
      const token = authorization.replace(/^bearer\s+/i, '');
      const authContext = await opts.authenticator.authenticate(token);

      const feature = await opts.organizationRepository.getFeature({
        organizationId: authContext.organizationId,
        featureId: 'scim',
      });
      if (!feature?.enabled) {
        return res.code(400).send(
          ScimError({
            detail: 'Scim feature is not enabled for this organization.',
            status: 400,
          }),
        );
      }

      const isAuthorized = await opts.apiKeyRepository.verifyAPIKeyPermissions({ apiKey: token, permission: 'scim' });
      if (!isAuthorized) {
        return res.code(400).send(
          ScimError({
            detail: 'API key doesnt have the permission to perform scim operations.',
            status: 400,
          }),
        );
      }

      await opts.keycloakClient.authenticateClient();

      req.authContext = authContext;
    } catch (err: any) {
      return res.code(401).send(
        ScimError({
          detail: err.message,
          status: 401,
        }),
      );
    }
  });

  fastify.get('/', (req, res) => {
    return res.code(200).send('SCIM');
  });

  fastify.get<{ Querystring: { filter?: string; startIndex?: number; count?: number } }>('/Users', async (req, res) => {
    const authContext = req.authContext;

    const filter = req.query?.filter;
    const startIndex = req.query?.startIndex;
    const count = req.query?.count;

    const users: {
      id: string;
      emails: { value: string }[];
      userName: string;
      active: boolean;
      name: { givenName: string; familyName: string };
    }[] = [];

    if (filter) {
      // filter=userName eq "${email}"
      const emailFilters = filter.split(' ');
      if (emailFilters.length !== 3) {
        return res.code(400).send(
          ScimError({
            detail: 'Wrong filter value.',
            status: 400,
          }),
        );
      }
      const emailFilter = emailFilters[2];
      const email = emailFilter.replaceAll('"', '');
      const user = await opts.organizationRepository.getOrganizationMemberByEmail({
        organizationID: authContext.organizationId,
        userEmail: email,
      });
      if (!user) {
        return res.code(200).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
        });
      }
      const keycloakUsers = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email: user.email,
      });
      if (keycloakUsers.length === 0) {
        return res.code(200).send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
        });
      }
      users.push({
        id: user.userID,
        emails: [{ value: user.email }],
        userName: user.email,
        active: keycloakUsers[0].enabled ?? true,
        name: {
          givenName: keycloakUsers[0].firstName || '',
          familyName: keycloakUsers[0].lastName || '',
        },
      });
    } else {
      const filters: { organizationID: string; startIndex?: number; count?: number } = {
        organizationID: authContext.organizationId,
      };
      if (startIndex !== undefined) {
        // subtracting 1 as they send 1 for the 1st index
        filters.startIndex = startIndex - 1;
      }
      if (count !== undefined) {
        filters.count = count;
      }
      const members = await opts.organizationRepository.getMembers(filters);
      for (const member of members) {
        const keycloakUsers = await opts.keycloakClient.client.users.find({
          realm: opts.keycloakRealm,
          email: member.email,
        });
        if (keycloakUsers.length === 0) {
          continue;
        }
        users.push({
          id: member.userID,
          emails: [{ value: member.email }],
          userName: member.email,
          active: keycloakUsers[0].enabled ?? true,
          name: {
            givenName: keycloakUsers[0].firstName || '',
            familyName: keycloakUsers[0].lastName || '',
          },
        });
      }
    }

    return res.code(200).send({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: users.length,
      startIndex: startIndex || 1,
      itemsPerPage: users.length,
      Resources: users,
    });
  });

  fastify.get('/Users/:userID', async (req: FastifyRequest<{ Params: { userID: string } }>, res) => {
    const authContext = req.authContext;

    const userID = req.params.userID;

    const user = await opts.organizationRepository.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID,
    });

    if (!user) {
      return res.code(404).send(
        ScimError({
          detail: 'User not found',
          status: 404,
        }),
      );
    }

    const keycloakUsers = await opts.keycloakClient.client.users.find({
      realm: opts.keycloakRealm,
      email: user.email,
    });
    if (keycloakUsers.length === 0) {
      return res.code(404).send(
        ScimError({
          detail: 'User not found',
          status: 404,
        }),
      );
    }

    return res.code(200).send({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.userID,
      userName: user.email,
      name: {
        givenName: keycloakUsers[0].firstName || '',
        familyName: keycloakUsers[0].lastName || '',
      },
      active: keycloakUsers[0].enabled,
      emails: [
        {
          primary: true,
          value: user.email,
        },
      ],
      groups: [],
      meta: {
        resourceType: 'User',
      },
    });
  });

  // create a user
  fastify.post(
    '/Users',
    async (
      req: FastifyRequest<{
        Body: {
          schemas: string[];
          userName: string;
          name: { givenName: string; familyName: string };
          emails: { primary: boolean; value: string }[];
          password: string;
          displayName: string;
          groups: string[];
          active: boolean;
          locale: string;
          externalId: string;
        };
      }>,
      res,
    ) => {
      const authContext = req.authContext;

      const { userName, name, emails, password, displayName, groups, active, locale, externalId } = req.body;

      const email = emails.find((e) => e.primary)?.value || userName;

      const org = await opts.organizationRepository.byId(authContext.organizationId);
      if (!org) {
        return res.code(404).send(
          ScimError({
            detail: 'Organization not found.',
            status: 404,
          }),
        );
      }

      // Ensure that the organization has been linked to a Keycloak group
      if (!org.kcGroupId) {
        return res.code(500).send(
          ScimError({
            detail: `Organization group "${org.slug}" not found`,
            status: 500,
          }),
        );
      }

      // Make sure that the group exists in Keycloak
      const kcGroup = await opts.keycloakClient.client.groups.findOne({
        realm: opts.keycloakRealm,
        id: org.kcGroupId,
      });

      if (!kcGroup) {
        return res.code(500).send(
          ScimError({
            detail: `Organization group "${org.slug}" not found`,
            status: 500,
          }),
        );
      }

      // Check whether the organization member already exists
      const orgMember = await opts.organizationRepository.getOrganizationMemberByEmail({
        organizationID: authContext.organizationId,
        userEmail: email,
      });

      if (orgMember) {
        return res.code(409).send(
          ScimError({
            detail: 'User is already a part of the organization.',
            status: 409,
          }),
        );
      }

      // fetching the org from keycloak
      const user = await opts.userRepository.byEmail(email);
      const keycloakUsers = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email,
        exact: true,
      });

      if (user) {
        if (keycloakUsers.length === 0) {
          // return 500 as the user should exist on keycloak if it exists in the db
          return res.code(500).send(
            ScimError({
              detail: `User '${user.email}' not found on keycloak`,
              status: 500,
            }),
          );
        } else {
          await opts.keycloakClient.client.users.addToGroup({
            id: user.id,
            realm: opts.keycloakRealm,
            groupId: org.kcGroupId!,
          });

          await opts.organizationRepository.addOrganizationMember({
            userID: user.id,
            organizationID: authContext.organizationId,
          });

          return res.code(201).send({
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            id: user.id,
            userName: email,
            name,
            emails,
            displayName,
            locale,
            externalId,
            active,
            groups,
            meta: {
              resourceType: 'User',
            },
          });
        }
      }

      let keycloakUserID = '';
      try {
        if (keycloakUsers.length === 0) {
          keycloakUserID = await opts.keycloakClient.addKeycloakUser({
            realm: opts.keycloakRealm,
            firstName: name.givenName,
            lastName: name.familyName,
            email,
            password,
            isPasswordTemp: false,
          });
        } else {
          keycloakUserID = keycloakUsers[0].id!;
        }
      } catch (err: any) {
        return res.code(500).send(
          ScimError({
            detail: err.responseData.errorMessage || err.message,
            status: 500,
          }),
        );
      }

      await opts.keycloakClient.client.users.addToGroup({
        id: keycloakUserID,
        realm: opts.keycloakRealm,
        groupId: org.kcGroupId!,
      });

      await opts.userRepository.addUser({ id: keycloakUserID, email });
      await opts.organizationRepository.addOrganizationMember({
        userID: keycloakUserID,
        organizationID: authContext.organizationId,
      });

      return res.code(201).send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: keycloakUserID,
        userName: email,
        name,
        emails,
        displayName,
        locale,
        externalId,
        active,
        groups,
        meta: {
          resourceType: 'User',
        },
      });
    },
  );

  // update a user
  fastify.put(
    '/Users/:userID',
    async (
      req: FastifyRequest<{
        Params: { userID: string };
        Body: {
          schemas: string[];
          id: string;
          userName: string;
          name: { givenName?: string; familyName?: string };
          emails: { primary: boolean; value: string }[];
          password: string;
          groups: string[];
          active: boolean;
        };
      }>,
      res,
    ) => {
      const authContext = req.authContext;

      const userID = req.params.userID;
      const { name, emails, password, groups, active } = req.body;

      const user = await opts.organizationRepository.getOrganizationMember({
        organizationID: authContext.organizationId,
        userID,
      });

      if (!user) {
        return res.code(404).send(
          ScimError({
            detail: 'User not found',
            status: 404,
          }),
        );
      }

      const keycloakUsers = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email: user.email,
      });
      if (keycloakUsers.length === 0) {
        return res.code(404).send(
          ScimError({
            detail: 'User not found',
            status: 404,
          }),
        );
      }

      await opts.keycloakClient.updateKeycloakUser({
        id: userID,
        enabled: active,
        firstName: name.givenName,
        lastName: name.familyName,
        realm: opts.keycloakRealm,
        groups,
        password,
      });

      await opts.userRepository.updateUser({ id: userID, active });

      return res.code(200).send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: userID,
        userName: user.email,
        name,
        emails,
        active,
        groups,
        meta: {
          resourceType: 'User',
        },
      });
    },
  );

  // remove the user from the org
  fastify.patch(
    '/Users/:userID',
    async (
      req: FastifyRequest<{
        Params: { userID: string };
        Body: { schemas: string[]; Operations: { op: string; value: { active: boolean } }[] };
      }>,
      res,
    ) => {
      const authContext = req.authContext;

      const userID = req.params.userID;

      const orgMember = await opts.organizationRepository.getOrganizationMember({
        organizationID: authContext.organizationId,
        userID,
      });
      if (!orgMember) {
        return res.code(404).send(
          ScimError({
            detail: 'User not found',
            status: 404,
          }),
        );
      }

      const operations = req.body.Operations;

      for (const operation of operations) {
        const value = operation.value;
        if ('active' in value) {
          const active = value.active;

          await opts.keycloakClient.updateKeycloakUser({
            id: userID,
            enabled: active,
            realm: opts.keycloakRealm,
          });

          await opts.userRepository.updateUser({ id: userID, active });
        }
      }

      return res.code(204).send();
    },
  );

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
