import KeycloakAdminClient from '@keycloak/keycloak-admin-client';
import { RequiredActionAlias } from '@keycloak/keycloak-admin-client/lib/defs/requiredActionProviderRepresentation.js';
import { uid } from 'uid';
import { MemberRole } from '../../db/models.js';

export default class Keycloak {
  client: KeycloakAdminClient;
  adminUser = '';
  adminPassword = '';
  clientId = '';
  realm = '';

  constructor(options: { apiUrl: string; realm: string; clientId: string; adminUser: string; adminPassword: string }) {
    this.client = new KeycloakAdminClient({
      baseUrl: options.apiUrl,
      realmName: options.realm,
    });

    this.realm = options.realm;
    this.clientId = options.clientId;
    this.adminUser = options.adminUser;
    this.adminPassword = options.adminPassword;
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

  public async createIDPMapper({
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
    await this.client.identityProviders.createMapper({
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

  public async deleteOrganizationGroup({ realm, organizationSlug }: { realm?: string; organizationSlug: string }) {
    const orgGroups = await this.client.groups.find({
      search: organizationSlug,
      realm: realm || this.realm,
      briefRepresentation: true,
      max: 1,
    });

    if (orgGroups.length === 0) {
      throw new Error(`Organization group '${organizationSlug}' not found`);
    }

    const orgGroup = orgGroups.find((group) => group.name === organizationSlug);

    if (!orgGroup) {
      throw new Error(`Organization group '${organizationSlug}' not found`);
    }

    await this.client.groups.del({
      id: orgGroup.id!,
      realm: realm || this.realm,
    });
  }

  public async seedGroup({
    realm,
    userID,
    organizationSlug,
  }: {
    realm?: string;
    userID: string;
    organizationSlug: string;
  }) {
    const organizationGroup = await this.client.groups.create({
      realm: realm || this.realm,
      name: organizationSlug,
    });

    const adminGroup = await this.client.groups.createChildGroup(
      {
        realm: realm || this.realm,
        id: organizationGroup.id,
      },
      {
        name: 'admin',
        realmRoles: ['admin'],
      },
    );

    await this.client.groups.createChildGroup(
      {
        realm,
        id: organizationGroup.id,
      },
      {
        name: 'developer',
        realmRoles: ['developer'],
      },
    );

    await this.client.groups.createChildGroup(
      {
        realm,
        id: organizationGroup.id,
      },
      {
        name: 'viewer',
        realmRoles: ['viewer'],
      },
    );

    await this.client.users.addToGroup({
      id: userID,
      realm: realm || this.realm,
      groupId: adminGroup.id,
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
    const orgGroups = await this.client.groups.find({
      search: childGroupType,
      realm: realm || this.realm,
    });

    if (orgGroups.length === 0) {
      throw new Error(`Organization group '${orgSlug}' does not have any child groups`);
    }

    const orgGroup = orgGroups.find((group) => group.id === kcGroupId);
    const childGroup = orgGroup?.subGroups?.find((group) => group.path === `/${orgSlug}/${childGroupType}`);

    if (!childGroup) {
      throw new Error(`Organization child group '/${orgSlug}/${childGroupType}' not found`);
    }

    return childGroup;
  }

  public async removeUserFromOrganization({
    realm,
    userID,
    groupName,
    roles,
  }: {
    realm?: string;
    userID: string;
    groupName: string;
    roles: string[];
  }) {
    const organizationGroup = await this.client.groups.find({
      max: 1,
      search: groupName,
      realm: realm || this.realm,
    });

    if (organizationGroup.length === 0) {
      throw new Error(`Organization group '${groupName}' not found`);
    }

    for (const role of roles) {
      const childGroup = await this.fetchChildGroup({
        realm: realm || this.realm,
        kcGroupId: organizationGroup[0].id!,
        orgSlug: groupName,
        childGroupType: role as MemberRole,
      });
      await this.client.users.delFromGroup({
        id: userID,
        groupId: childGroup.id!,
        realm: realm || this.realm,
      });
    }
  }
}
