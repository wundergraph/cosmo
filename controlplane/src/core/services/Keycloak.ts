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
          value: password || uid(12),
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

  public async getKeycloakUsers({ realm, orgSlug }: { realm?: string; orgSlug: string }) {
    const users = await this.client.users.find({
      exact: true,
      idpAlias: orgSlug,
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
    orgSlug,
    discoveryEndpoint,
  }: {
    realm?: string;
    clientId: string;
    clientSecret: string;
    name: string;
    orgSlug: string;
    discoveryEndpoint: string;
  }) {
    const oidcUrls = await this.client.identityProviders.importFromUrl({
      realm: realm || this.realm,
      fromUrl: discoveryEndpoint,
      providerId: 'oidc',
    });

    await this.client.identityProviders.create({
      alias: orgSlug,
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
        defaultScope: 'openid email',
      },
      realm: realm || this.realm,
      providerId: 'oidc',
    });
  }

  public async deleteOIDCProvider({ realm, orgSlug }: { realm?: string; orgSlug: string }) {
    await this.client.identityProviders.del({ alias: orgSlug, realm: realm || this.realm });
  }

  public async createIDPMapper({
    realm,
    claims,
    orgSlug,
    keycloakGroupName,
  }: {
    realm?: string;
    claims: string;
    orgSlug: string;
    keycloakGroupName: string;
  }) {
    try {
      const a = await this.client.identityProviders.createMapper({
        alias: orgSlug,
        realm: realm || this.realm,
        identityProviderMapper: {
          name: uid(10),
          identityProviderMapper: 'oidc-advanced-group-idp-mapper',
          identityProviderAlias: orgSlug,
          config: {
            claims,
            syncMode: 'INHERIT',
            group: keycloakGroupName,
            'are.claim.values.regex': true,
          },
        },
      });
      console.log(a);
    } catch (e) {
      console.log(e);
    }
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

    await this.client.users.addToGroup({
      id: userID,
      realm: realm || this.realm,
      groupId: adminGroup.id,
    });
  }
}
