import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import ApiKeyAuthenticator, { ApiKeyAuthContext } from '../services/ApiKeyAuthenticator.js';
import Keycloak from '../services/Keycloak.js';

export type ScimControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  organizationRepository: OrganizationRepository;
  userRepository: UserRepository;
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

    await opts.keycloakClient.authenticateClient();

    req.authContext = authContext;
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
        middleName: '',
        familyName: keycloakUsers[0].lastName || '',
      },
      active: keycloakUsers[0].enabled,
      emails: [
        {
          primary: true,
          value: user.email,
          type: 'work',
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
          emails: { primary: boolean; value: string; type: string }[];
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

      const email = emails.find((e) => e.primary === true)?.value || userName;

      const user = await opts.userRepository.byEmail(email);
      if (user) {
        return res.code(409).send(
          ScimError({
            detail: 'User already exists in the database.',
            status: 409,
          }),
        );
      }

      const keycloakUsers = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email,
      });

      if (keycloakUsers.length > 0) {
        return res.code(409).send(
          ScimError({
            detail: 'User already exists in the database.',
            status: 409,
          }),
        );
      }

      const keycloakUserID = await opts.keycloakClient.addKeycloakUser({
        realm: opts.keycloakRealm,
        firstName: name.givenName,
        lastName: name.familyName,
        email,
        password,
        isPasswordTemp: false,
      });

      const organizationGroups = await opts.keycloakClient.client.groups.find({
        max: 1,
        search: authContext.organizationSlug,
        realm: opts.keycloakRealm,
      });

      if (organizationGroups.length === 0) {
        return res.code(400).send(
          ScimError({
            detail: `Organization group '${authContext.organizationSlug}' not found`,
            status: 400,
          }),
        );
      }

      const viewerGroup = await opts.keycloakClient.fetchChildGroup({
        realm: opts.keycloakRealm,
        kcGroupId: organizationGroups[0].id!,
        orgSlug: authContext.organizationSlug,
        childGroupType: 'viewer',
      });

      await opts.keycloakClient.client.users.addToGroup({
        id: keycloakUserID,
        realm: opts.keycloakRealm,
        groupId: viewerGroup.id!,
      });

      await opts.userRepository.addUser({ id: keycloakUserID, email });
      const orgMember = await opts.organizationRepository.addOrganizationMember({
        userID: keycloakUserID,
        organizationID: authContext.organizationId,
      });
      await opts.organizationRepository.addOrganizationMemberRoles({
        memberID: orgMember.id,
        roles: ['viewer'],
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
          name: { givenName?: string; familyName?: string; middleName?: string };
          emails: { primary: boolean; value: string; type: string }[];
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
