import KeycloakAdminClient from '@keycloak/keycloak-admin-client';
import { RequiredActionAlias } from '@keycloak/keycloak-admin-client/lib/defs/requiredActionProviderRepresentation.js';
import { uid } from 'uid';
import { FastifyBaseLogger } from 'fastify';
import { MemberRole } from '../../db/models.js';
import { organizationRoleEnum } from '../../db/schema.js';

export default class Keycloak {
  client: KeycloakAdminClient;
  adminUser = '';
  adminPassword = '';
  clientId = '';
  realm = '';

  private logger: FastifyBaseLogger;

  constructor(options: {
    apiUrl: string;
    realm: string;
    clientId: string;
    adminUser: string;
    adminPassword: string;
    logger: FastifyBaseLogger;
  }) {
    this.client = new KeycloakAdminClient({
      baseUrl: options.apiUrl,
      realmName: options.realm,
    });

    this.realm = options.realm;
    this.clientId = options.clientId;
    this.adminUser = options.adminUser;
    this.adminPassword = options.adminPassword;
    this.logger = options.logger;
  }

  public async authenticateClient() {
    await this.client.auth({
      grantType: 'password',
      username: this.adminUser,
      password: this.adminPassword,
      clientId: 'admin-cli',
    });
  }

  public async roleExists({ realm, roleName }: { realm?: string; roleName: string }): Promise<boolean> {
    const role = await this.client.roles.findOneByName({
      realm: realm || this.realm,
      name: roleName,
    });
    return !!role;
  }

  // creates a user in keycloak and returns the id
  public async addKeycloakUser({
    email,
    realm,
    password,
    isPasswordTemp,
    groups,
    firstName,
    lastName,
    id,
  }: {
    email: string;
    realm?: string;
    password?: string;
    isPasswordTemp: boolean;
    groups?: string[];
    firstName?: string;
    lastName?: string;
    id?: string;
  }): Promise<string> {
    const createUserResp = await this.client.users.create({
      email,
      enabled: true,
      emailVerified: true,
      realm: realm || this.realm,
      groups,
      firstName,
      lastName,
      credentials: [
        {
          type: 'password',
          // must follow the password policy on keycloak
          value: password || uid(12) + '@123',
          temporary: isPasswordTemp,
        },
      ],
      id,
    });
    return createUserResp.id;
  }

  public async updateKeycloakUser({
    realm,
    id,
    password,
    firstName,
    lastName,
    groups,
    enabled,
  }: {
    id: string;
    realm?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    groups?: string[];
    enabled?: boolean;
  }) {
    const payload: {
      credentials?: { type: string; value: string; temporary: boolean }[];
      firstName?: string;
      lastName?: string;
      groups?: string[];
      enabled?: boolean;
    } = {};
    if (password) {
      payload.credentials = [
        {
          type: 'password',
          // must follow the password policy on keycloak
          value: password,
          temporary: false,
        },
      ];
    }
    if (firstName) {
      payload.firstName = firstName;
    }
    if (lastName) {
      payload.lastName = lastName;
    }
    if (enabled !== undefined) {
      payload.enabled = enabled;
    }
    if (groups) {
      payload.groups = groups;
    }
    await this.client.users.update({ id, realm: realm || this.realm }, payload);
  }

  public async createRole({ realm, roleName }: { realm?: string; roleName: string }) {
    await this.client.roles.create({
      name: roleName,
      realm: realm || this.realm,
      clientRole: false,
    });
  }

  public async addRealmRoleMappings({
    realm,
    userID,
    roles,
  }: {
    userID: string;
    realm?: string;
    roles: {
      id: string;
      clientRole: boolean;
      name: string;
    }[];
  }) {
    await this.client.users.addRealmRoleMappings({
      realm: realm || this.realm,
      id: userID,
      roles,
    });
  }

  public async executeActionsEmail({
    realm,
    userID,
    redirectURI,
  }: {
    realm?: string;
    userID: string;
    redirectURI: string;
  }) {
    await this.client.users.executeActionsEmail({
      id: userID,
      actions: [RequiredActionAlias.UPDATE_PASSWORD],
      redirectUri: redirectURI,
      realm: realm || this.realm,
      clientId: this.clientId,
    });
  }

  public async getKeycloakSsoLoggedInUsers({ realm, alias }: { realm?: string; alias: string }) {
    const users = await this.client.users.find({
      exact: true,
      idpAlias: alias,
      realm: realm || this.realm,
    });
    return users;
  }

  public async getKeycloakUserGroups({ realm, userID }: { realm?: string; userID: string }) {
    const groups = await this.client.users.listGroups({
      id: userID,
      realm: realm || this.realm,
    });
    return groups;
  }

  public async createOIDCProvider({
    realm,
    clientId,
    clientSecret,
    name,
    alias,
    discoveryEndpoint,
  }: {
    realm?: string;
    clientId: string;
    clientSecret: string;
    name: string;
    alias: string;
    discoveryEndpoint: string;
  }) {
    const oidcUrls = await this.client.identityProviders.importFromUrl({
      realm: realm || this.realm,
      fromUrl: discoveryEndpoint,
      providerId: 'oidc',
    });

    await this.client.identityProviders.create({
      alias,
      displayName: name,
      enabled: true,
      config: {
        clientId,
        clientSecret,
        hideOnLoginPage: true,
        syncMode: 'FORCE',
        validateSignature: 'true',
        tokenUrl: oidcUrls.tokenUrl,
        authorizationUrl: oidcUrls.authorizationUrl,
        jwksUrl: oidcUrls.jwksUrl,
        logoutUrl: oidcUrls.logoutUrl,
        issuer: oidcUrls.issuer,
        useJwksUrl: 'true',
        defaultScope: 'openid email profile',
      },
      realm: realm || this.realm,
      providerId: 'oidc',
    });
  }

  public async deleteOIDCProvider({ realm, alias }: { realm?: string; alias: string }) {
    await this.client.identityProviders.del({ alias, realm: realm || this.realm });
  }

  public createIDPMapper({
    realm,
    claims,
    alias,
    keycloakGroupName,
  }: {
    realm?: string;
    claims: string;
    alias: string;
    keycloakGroupName: string;
  }) {
    return this.client.identityProviders.createMapper({
      alias,
      realm: realm || this.realm,
      identityProviderMapper: {
        name: uid(10),
        identityProviderMapper: 'oidc-advanced-group-idp-mapper',
        identityProviderAlias: alias,
        config: {
          claims,
          syncMode: 'INHERIT',
          group: keycloakGroupName,
          'are.claim.values.regex': true,
        },
      },
    });
  }

  public async deleteGroupById({ realm, groupId }: { realm?: string; groupId: string }) {
    try {
      await this.client.groups.del({
        realm: realm || this.realm,
        id: groupId,
      });
    } catch (e: unknown) {
      this.logger?.error(e, `Failed to delete group id "${groupId}" from Keycloak`);
      throw e;
    }
  }

  public seedRoles({ realm, organizationSlug }: { realm?: string; organizationSlug: string }) {
    return Promise.all(
      organizationRoleEnum.enumValues.map(async (role) => {
        const roleName = `${organizationSlug}:${role}`;
        if (!(await this.roleExists({ realm: realm || this.realm, roleName }))) {
          await this.createRole({
            realm: realm || this.realm,
            roleName,
          });
        }
      }),
    );
  }

  public async seedGroup({
    realm,
    userID,
    organizationSlug,
  }: {
    realm?: string;
    userID: string;
    organizationSlug: string;
  }): Promise<[string, { id: string; name: string }[]]> {
    const organizationGroup = await this.client.groups.create({
      realm: realm || this.realm,
      name: organizationSlug,
    });

    await this.seedRoles({ realm, organizationSlug });

    const createdGroups: { id: string; name: string }[] = [];
    for (const name of ['admin', 'developer', 'viewer']) {
      const roleName = `${organizationSlug}:organization-${name}`;
      const kcRole = await this.client.roles.findOneByName({
        realm,
        name: roleName,
      });

      const kcGroup = await this.client.groups.createChildGroup(
        {
          realm: realm || this.realm,
          id: organizationGroup.id,
        },
        { name },
      );

      if (kcGroup && kcRole) {
        await this.client.groups.addRealmRoleMappings({
          realm,
          id: kcGroup.id,
          roles: [
            {
              id: kcRole.id!,
              name: roleName,
            },
          ],
        });

        if (name === 'admin') {
          await this.client.users.addToGroup({
            id: userID,
            realm: realm || this.realm,
            groupId: kcGroup.id,
          });
        }

        createdGroups.push({ id: kcGroup.id!, name });
      }
    }

    return [organizationGroup.id, createdGroups];
  }

  public async createSubGroup({ realm, parentId, groupName }: { realm?: string; parentId: string; groupName: string }) {
    const newGroup = await this.client.groups.createChildGroup(
      { realm: realm || this.realm, id: parentId },
      { name: groupName },
    );

    return newGroup?.id;
  }

  public fetchAllSubGroups({ realm, kcGroupId }: { realm?: string; kcGroupId: string }) {
    return this.client.groups.listSubGroups({
      parentId: kcGroupId,
      realm: realm || this.realm,
    });
  }

  public async fetchChildGroup({
    realm,
    orgSlug,
    kcGroupId,
    childGroupType,
  }: {
    realm?: string;
    orgSlug: string;
    kcGroupId: string;
    childGroupType: MemberRole;
  }) {
    const orgGroups = await this.client.groups.listSubGroups({
      search: childGroupType,
      parentId: kcGroupId,
      realm: realm || this.realm,
    });

    const childGroup = orgGroups?.find((group) => group.path === `/${orgSlug}/${childGroupType}`);
    if (!childGroup) {
      throw new Error(`Organization child group '/${orgSlug}/${childGroupType}' not found`);
    }

    return childGroup;
  }

  public async removeUserFromOrganization({
    realm,
    groupId,
    userID,
  }: {
    realm?: string;
    groupId: string;
    userID: string;
  }) {
    // Delete from the root organization group
    await this.client.users.delFromGroup({ id: userID, groupId, realm: realm || this.realm });

    // And any subgroup
    const subGroups = await this.fetchAllSubGroups({ realm: realm || this.realm, kcGroupId: groupId });
    for (const subGroup of subGroups) {
      await this.client.users.delFromGroup({
        id: userID,
        groupId: subGroup.id!,
        realm: realm || this.realm,
      });
    }
  }
}
