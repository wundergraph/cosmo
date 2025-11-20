import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import ApiKeyAuthenticator, { ApiKeyAuthContext } from '../services/ApiKeyAuthenticator.js';
import Keycloak from '../services/Keycloak.js';
import { ApiKeyRepository } from '../repositories/ApiKeyRepository.js';
import Mailer from '../services/Mailer.js';
import { AddAuditLogInput, AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { UserInviteService } from '../services/UserInviteService.js';
import { isPublicError } from '../errors/errors.js';

export type ScimControllerOptions = {
  db: PostgresJsDatabase<typeof schema>;
  organizationRepository: OrganizationRepository;
  userRepository: UserRepository;
  apiKeyRepository: ApiKeyRepository;
  authenticator: ApiKeyAuthenticator;
  keycloakClient: Keycloak;
  keycloakRealm: string;
  mailer?: Mailer;
};

type ListUsersRequest = FastifyRequest<{
  Querystring: {
    filter?: string;
    startIndex?: number;
    count?: number;
  };
}>;

type GetUserRequest = FastifyRequest<{
  Params: { userID: string };
}>;

type CreateUserRequest = FastifyRequest<{
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
}>;

type UpdateUserRequest = FastifyRequest<{
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
}>;

type PatchOperationType = 'add' | 'replace' | 'remove';

type PatchOperation =
  | { op: PatchOperationType; path: string; value: string }
  | { op: PatchOperationType; value: Record<string, unknown> };

type PatchUserRequest = FastifyRequest<{
  Params: { userID: string };
  Body: {
    schemas: string[];
    Operations: PatchOperation[];
  };
}>;

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
  fastify.addContentTypeParser('application/scim+json', { parseAs: 'string' }, function (_, body, done) {
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

  fastify.get('/', (_: FastifyRequest, res: FastifyReply) => {
    return res.code(200).send('SCIM');
  });

  // list existing users
  fastify.get('/Users', async (req: ListUsersRequest, res: FastifyReply) => {
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

  // fetch user
  fastify.get('/Users/:userID', async (req: GetUserRequest, res: FastifyReply) => {
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
      active: user.active,
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
  fastify.post('/Users', async (req: CreateUserRequest, res: FastifyReply) => {
    const authContext = req.authContext;

    const { userName, name, emails, password, displayName, groups, active, locale, externalId } = req.body;
    const email = emails.find((e) => e.primary)?.value || userName;

    try {
      const userId = await opts.db.transaction((tx) => {
        const service = new UserInviteService({
          db: tx,
          logger: req.log,
          keycloakRealm: opts.keycloakRealm,
          keycloak: opts.keycloakClient,
          mailer: opts.mailer,
        });

        return service.inviteUser({
          organizationId: authContext.organizationId,
          inviterUserId: authContext.userId,
          email,
          firstName: name.givenName,
          lastName: name.familyName,
          password,
        });
      });

      const auditLogRepo = new AuditLogRepository(opts.db);
      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'scim.organization_invitation_created',
        action: 'created',
        actorId: authContext.userId,
        auditableDisplayName: email,
        auditableType: 'user',
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });

      return res.code(201).send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: userId,
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
    } catch (err: unknown) {
      if (isPublicError(err)) {
        return res.code(400).send(
          ScimError({
            detail: err.message,
            status: err.code === EnumStatusCode.ERR_ALREADY_EXISTS ? 409 : 500,
          }),
        );
      } else if (err instanceof Error) {
        return res.code(500).send(
          ScimError({
            detail: err.message,
            status: 500,
          }),
        );
      }
    }

    return res.code(500).send(
      ScimError({
        detail: 'Oh no! Something went wrong while creating the user.',
        status: 500,
      }),
    );
  });

  // update a user
  fastify.put('/Users/:userID', async (req: UpdateUserRequest, res: FastifyReply) => {
    const authContext = req.authContext;

    const userID = req.params.userID;
    const { name, emails, groups, active } = req.body;

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

    // Update user details in Keycloak
    const auditLogRepo = new AuditLogRepository(opts.db);
    await opts.keycloakClient.updateKeycloakUser({
      id: userID,
      firstName: name.givenName,
      lastName: name.familyName,
      realm: opts.keycloakRealm,
      groups,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'scim.update_organization_member',
      action: 'updated',
      actorId: authContext.userId,
      auditableDisplayName: user.email,
      auditableType: 'user',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    // If the active status has changed, update the organization member's active status to reflect it
    if (user.active !== active) {
      await opts.organizationRepository.setOrganizationMemberActive({
        id: user.orgMemberID,
        organizationId: authContext.organizationId,
        active,
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: active ? 'scim.activate_organization_member' : 'scim.deactivate_organization_member',
        action: 'updated',
        actorId: authContext.userId,
        auditableDisplayName: user.email,
        auditableType: 'user',
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
    }

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
  });

  // remove the user from the org
  fastify.patch('/Users/:userID', async (req: PatchUserRequest, res: FastifyReply) => {
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

    const auditLogs: AddAuditLogInput[] = [];
    const partialAudit: Omit<AddAuditLogInput, 'auditAction' | 'action'> = {
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      actorId: authContext.userId,
      actorDisplayName: authContext.userDisplayName,
      auditableDisplayName: orgMember.email,
      auditableType: 'user',
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    };

    const operations = req.body.Operations;
    if (!operations || operations.length === 0) {
      return res.code(204).send();
    }

    for (const operation of operations) {
      if (operation.op?.toLowerCase() !== 'replace') {
        // We only care about the `replace` operation
        continue;
      }

      if ('path' in operation) {
        if (operation.path.toLowerCase() === 'active') {
          const active = operation.value?.toLowerCase() === 'true';
          await opts.organizationRepository.setOrganizationMemberActive({
            id: orgMember.orgMemberID,
            organizationId: authContext.organizationId,
            active,
          });

          auditLogs.push({
            ...partialAudit,
            auditAction: active ? 'scim.activate_organization_member' : 'scim.deactivate_organization_member',
            action: 'updated',
          });
        }
      } else if ('active' in operation.value && typeof operation.value.active === 'boolean') {
        const active = operation.value.active;
        await opts.organizationRepository.setOrganizationMemberActive({
          id: orgMember.orgMemberID,
          organizationId: authContext.organizationId,
          active,
        });

        auditLogs.push({
          ...partialAudit,
          auditAction: active ? 'scim.activate_organization_member' : 'scim.deactivate_organization_member',
          action: 'updated',
        });
      }
    }

    if (auditLogs.length > 0) {
      const auditLogRepo = new AuditLogRepository(opts.db);
      await auditLogRepo.addAuditLog(...auditLogs);
    }

    return res.code(204).send();
  });

  done();
};

export default fp(plugin, {
  encapsulate: true,
});
