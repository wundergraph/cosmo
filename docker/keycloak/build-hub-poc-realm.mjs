// Generates realm.hub-poc.json from realm.json. Rerun after realm.json changes:
//   node docker/keycloak/build-hub-poc-realm.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./realm.json', import.meta.url));
const targetPath = fileURLToPath(new URL('./realm.hub-poc.json', import.meta.url));

const realm = JSON.parse(readFileSync(sourcePath, 'utf8'));

const findClient = (clientId) => {
  const client = realm.clients.find((candidate) => candidate.clientId === clientId);
  if (!client) {
    throw new Error(`realm.json has no client ${clientId}`);
  }
  return client;
};

const hubAudienceMapper = {
  name: 'hub audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  consentRequired: false,
  config: {
    'included.client.audience': 'hub',
    'id.token.claim': 'false',
    'access.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
};

const cosmoCli = findClient('cosmo-cli');
const groupsMapper = cosmoCli.protocolMappers.find((mapper) => mapper.name === 'groups');

realm.clients.push({
  clientId: 'hub',
  name: 'WunderGraph Hub',
  enabled: true,
  publicClient: false,
  clientAuthenticatorType: 'client-secret',
  secret: '${HUB_KEYCLOAK_CLIENT_SECRET:changeme}',
  redirectUris: ['${HUB_WEB_URL:http://localhost:5173}/*'],
  webOrigins: ['+'],
  standardFlowEnabled: true,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: false,
  frontchannelLogout: true,
  protocol: 'openid-connect',
  attributes: { 'post.logout.redirect.uris': '+', 'pkce.code.challenge.method': 'S256' },
  fullScopeAllowed: true,
  protocolMappers: [{ ...groupsMapper, id: undefined }, hubAudienceMapper],
  defaultClientScopes: cosmoCli.defaultClientScopes,
  optionalClientScopes: cosmoCli.optionalClientScopes,
});

cosmoCli.protocolMappers.push(hubAudienceMapper);

for (const clientId of ['cosmo-cli', 'studio']) {
  findClient(clientId).directAccessGrantsEnabled = false;
}

realm.registrationAllowed = false;
realm.resetPasswordAllowed = false;

realm.identityProviders = [
  {
    alias: 'google',
    displayName: 'Google',
    providerId: 'google',
    enabled: true,
    trustEmail: true,
    storeToken: false,
    addReadTokenRoleOnCreate: false,
    authenticateByDefault: false,
    linkOnly: false,
    firstBrokerLoginFlowAlias: 'first broker login',
    config: {
      clientId: '${GOOGLE_CLIENT_ID}',
      clientSecret: '${GOOGLE_CLIENT_SECRET}',
      hostedDomain: 'wundergraph.com',
      defaultScope: 'openid profile email',
      syncMode: 'IMPORT',
      guiOrder: '1',
    },
  },
];

realm.authenticatorConfig.push({ alias: 'google redirector', config: { defaultProvider: 'google' } });

// Password login off: the browser flows send every sign-in straight to Google.
for (const flowAlias of ['browser', 'browser alt']) {
  const flow = realm.authenticationFlows.find((candidate) => candidate.alias === flowAlias);
  for (const execution of flow.authenticationExecutions) {
    if (execution.authenticator === 'identity-provider-redirector') {
      execution.authenticatorConfig = 'google redirector';
    }
    if (execution.authenticatorFlow) {
      execution.requirement = 'DISABLED';
    }
  }
}

writeFileSync(targetPath, `${JSON.stringify(realm, null, 2)}\n`);
console.log(`Wrote ${targetPath}`);
