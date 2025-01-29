import { CreateOIDCProviderRequest, GroupMapper } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { uid } from 'uid';
import * as schema from '../../db/schema.js';
import { OidcRepository } from '../repositories/OidcRepository.js';
import Keycloak from './Keycloak.js';

export default class OidcProvider {
  constructor() {}

  // creates the provider in keycloak, adds an entry into the db and then add the mappers in keycloak
  public async createOidcProvider({
    kcClient,
    kcRealm,
    organizationId,
    organizationSlug,
    alias,
    db,
    input,
  }: {
    kcClient: Keycloak;
    kcRealm: string;
    organizationId: string;
    organizationSlug: string;
    alias: string;
    db: PostgresJsDatabase<typeof schema>;
    input: CreateOIDCProviderRequest;
  }) {
    const oidcRepo = new OidcRepository(db);

    await kcClient.createOIDCProvider({
      clientId: input.clientID,
      clientSecret: input.clientSecrect,
      discoveryEndpoint: input.discoveryEndpoint,
      name: input.name,
      realm: kcRealm,
      alias,
    });

    const endpoint = input.discoveryEndpoint.split('/')[2];

    await oidcRepo.addOidcProvider({ name: input.name, organizationId, endpoint, alias });

    await this.addIDPMappers({
      kcClient,
      kcRealm,
      mappers: input.mappers,
      organizationSlug,
      alias,
      endpoint,
    });
  }

  public async addIDPMappers({
    kcClient,
    kcRealm,
    mappers,
    organizationSlug,
    endpoint,
    alias,
  }: {
    kcClient: Keycloak;
    kcRealm: string;
    mappers: GroupMapper[];
    organizationSlug: string;
    alias: string;
    endpoint: string;
  }) {
    for (const mapper of mappers) {
      let key = 'ssoGroups';
      // using a different claim name for microsoft entra as it doesnt allow us to change the name of the claim.
      if (endpoint === 'login.microsoftonline.com') {
        key = 'groups';
      }
      const claims = `[{ "key": "${key}", "value": "${mapper.ssoGroup.trim()}" }]`;
      let keycloakGroupName;

      switch (mapper.role) {
        case 'Admin': {
          keycloakGroupName = `/${organizationSlug}/admin`;
          break;
        }
        case 'Developer': {
          keycloakGroupName = `/${organizationSlug}/developer`;
          break;
        }
        case 'Viewer': {
          keycloakGroupName = `/${organizationSlug}/viewer`;
          break;
        }
        default: {
          throw new Error(`The role ${mapper.role} doesn't exist.`);
        }
      }

      await kcClient.createIDPMapper({
        realm: kcRealm,
        alias,
        claims,
        keycloakGroupName,
      });
    }
  }

  public async fetchIDPMappers({ kcClient, kcRealm, alias }: { kcClient: Keycloak; kcRealm: string; alias: string }) {
    const mappers = await kcClient.client.identityProviders.findMappers({
      alias,
      realm: kcRealm,
    });

    const idpMappers: GroupMapper[] = [];
    for (const mapper of mappers) {
      if (mapper.identityProviderMapper !== 'oidc-advanced-group-idp-mapper') {
        continue;
      }
      const keycloakGroup = mapper.config.group;
      const splitKCGroup = keycloakGroup.split('/');
      if (splitKCGroup.length !== 3) {
        continue;
      }
      const roleInCosmo: string = splitKCGroup[2];

      const stringifiedClaims = mapper.config.claims;
      const claims = JSON.parse(stringifiedClaims);
      if (!claims || claims.length === 0) {
        continue;
      }
      // this is a default mapper that is created, so skipping it
      if (claims[0].value === '.*') {
        continue;
      }

      idpMappers.push(
        new GroupMapper({
          role: roleInCosmo[0].toUpperCase() + roleInCosmo.slice(1),
          ssoGroup: claims[0].value,
        }),
      );
    }
    return [
      ...idpMappers.filter((mapper) => mapper.role === 'Admin'),
      ...idpMappers.filter((mapper) => mapper.role === 'Developer'),
      ...idpMappers.filter((mapper) => mapper.role === 'Viewer'),
    ];
  }

  public async deleteIDPMappers({ kcClient, kcRealm, alias }: { kcClient: Keycloak; kcRealm: string; alias: string }) {
    const mappers = await kcClient.client.identityProviders.findMappers({
      alias,
      realm: kcRealm,
    });

    for (const mapper of mappers) {
      await kcClient.client.identityProviders.delMapper({
        alias,
        id: mapper.id!,
        realm: kcRealm,
      });
    }
  }

  // deletes the roles of all the user of that org that use the sso to login and
  // log them out and then delete the entry in the db
  public async deleteOidcProvider({
    kcClient,
    kcRealm,
    organizationSlug,
    orgCreatorUserId,
    alias,
  }: {
    kcClient: Keycloak;
    kcRealm: string;
    organizationSlug: string;
    orgCreatorUserId?: string;
    alias: string;
  }) {
    const keycloakUsers = await kcClient.getKeycloakSsoLoggedInUsers({
      realm: kcRealm,
      alias,
    });

    for (const user of keycloakUsers) {
      if (user.id === orgCreatorUserId) {
        continue;
      }
      const keycloakUserGroups = await kcClient.getKeycloakUserGroups({
        realm: kcRealm,
        userID: user.id || '',
      });

      for (const group of keycloakUserGroups) {
        if (!group.path?.includes(organizationSlug) || group.path?.includes('viewer')) {
          continue;
        }
        await kcClient.client.users.delFromGroup({
          id: user.id || '',
          groupId: group.id || '',
          realm: kcRealm,
        });
      }

      await kcClient.client.users.logout({
        id: user.id || '',
        realm: kcRealm,
      });
    }

    await kcClient.deleteOIDCProvider({
      realm: kcRealm,
      alias,
    });
  }
}
