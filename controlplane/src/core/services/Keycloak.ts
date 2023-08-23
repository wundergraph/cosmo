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
}
