import KeycloakAdminClient from '@keycloak/keycloak-admin-client';
import { RequiredActionAlias } from '@keycloak/keycloak-admin-client/lib/defs/requiredActionProviderRepresentation.js';
import { uid } from 'uid';

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
  }: {
    email: string;
    realm?: string;
    password?: string;
    isPasswordTemp: boolean;
    groups?: string[];
  }): Promise<string> {
    const createUserResp = await this.client.users.create({
      email,
      enabled: true,
      emailVerified: true,
      realm: realm || this.realm,
      groups,
      credentials: [
        {
          type: 'password',
          // must follow the password policy on keycloak
          value: password || uid(12) + '@123',
          temporary: isPasswordTemp,
        },
      ],
    });
    return createUserResp.id;
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

  public async fetchAdminChildGroup({
    realm,
    orgSlug,
    kcGroupId,
  }: {
    realm?: string;
    orgSlug: string;
    kcGroupId: string;
  }) {
    const orgGroups = await this.client.groups.find({
      search: 'admin',
      realm: realm || this.realm,
    });

    if (orgGroups.length === 0) {
      throw new Error(`Organization group '${orgSlug}' does not have any child groups`);
    }

    const adminOrgGroup = orgGroups.find((group) => group.id === kcGroupId);
    const adminChildGroup = adminOrgGroup?.subGroups?.find((group) => group.path === `/${orgSlug}/admin`);

    if (!adminChildGroup) {
      throw new Error(`Organization child group '/${orgSlug}/admin' not found`);
    }

    return adminChildGroup;
  }

  public async fetchDevChildGroup({
    realm,
    orgSlug,
    kcGroupId,
  }: {
    realm?: string;
    orgSlug: string;
    kcGroupId: string;
  }) {
    const orgGroups = await this.client.groups.find({
      search: 'developer',
      realm: realm || this.realm,
    });

    if (orgGroups.length === 0) {
      throw new Error(`Organization group '${orgSlug}' does not have any child groups`);
    }

    const devOrgGroup = orgGroups.find((group) => group.id === kcGroupId);
    const devChildGroup = devOrgGroup?.subGroups?.find((group) => group.path === `/${orgSlug}/developer`);

    if (!devChildGroup) {
      throw new Error(`Organization child group '/${orgSlug}/developer' not found`);
    }

    return devChildGroup;
  }

  public async fetchViewerChildGroup({
    realm,
    orgSlug,
    kcGroupId,
  }: {
    realm?: string;
    orgSlug: string;
    kcGroupId: string;
  }) {
    const orgGroups = await this.client.groups.find({
      search: 'viewer',
      realm: realm || this.realm,
    });

    if (orgGroups.length === 0) {
      throw new Error(`Organization group '${orgSlug}' does not have any child groups`);
    }

    const viewerOrgGroup = orgGroups.find((group) => group.id === kcGroupId);
    const viewerChildGroup = viewerOrgGroup?.subGroups?.find((group) => group.path === `/${orgSlug}/viewer`);

    if (!viewerChildGroup) {
      throw new Error(`Organization child group '/${orgSlug}/viewer' not found`);
    }

    return viewerChildGroup;
  }
}
