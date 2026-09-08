import { pino } from 'pino';
import Keycloak from '../src/core/services/Keycloak.js';
import { retryWithBackoff } from '../src/core/util/timers.js';
import {
  TEST_DIRECT_GRANT_CLIENT_ID,
  TEST_REALM,
  keycloakClientOptions,
  isAlreadyExistsError,
} from './keycloak-test-utils.js';

/**
 * Creates the shared test realm once, before any test worker spawns. Otherwise the
 * parallel test files race to create it and whichever loses fails its first test
 * with "Realm not found".
 */
export default async function setup() {
  // Silence the admin client; setup failures surface via the retries below.
  const logger = pino({ level: 'silent' });
  const keycloakClient = new Keycloak({ ...keycloakClientOptions, logger });

  await retryWithBackoff(() => keycloakClient.authenticateClient(), {
    attempts: 180,
    baseInterval: 1000,
    maxInterval: 1000,
  });

  await retryWithBackoff(
    async () => {
      try {
        await keycloakClient.client.realms.create({
          realm: TEST_REALM,
          enabled: true,
          displayName: TEST_REALM,
          registrationEmailAsUsername: true,
        });
      } catch (e: unknown) {
        if (isAlreadyExistsError(e)) {
          return;
        }
        // Anything else may be transient
        throw e;
      }
    },
    { attempts: 10, baseInterval: 1000, maxInterval: 1000 },
  );

  // The realm can be acknowledged before it is readable; wait until it is.
  await retryWithBackoff(
    async () => {
      const found = await keycloakClient.client.realms.findOne({ realm: TEST_REALM });
      if (!found) {
        throw new Error(`Realm "${TEST_REALM}" is not yet readable`);
      }
    },
    { attempts: 30, baseInterval: 500, maxInterval: 500 },
  );

  // The client the tests sign users in through. A fresh realm only carries Keycloak's built-in
  // clients, and the obvious candidate (`admin-cli`) issues lightweight access tokens: they omit
  // `sub`, and the userinfo endpoint rejects them from Keycloak 26.6.2 onward, leaving the user
  // behind the token unresolvable. Owning the client keeps the token shape ours to guarantee, and
  // matches the clients production logs in through (`studio`, `hub-oidc`).
  const testClient = {
    clientId: TEST_DIRECT_GRANT_CLIENT_ID,
    enabled: true,
    publicClient: true,
    // The tests authenticate with a username and password, nothing else.
    directAccessGrantsEnabled: true,
    standardFlowEnabled: false,
    attributes: {
      // Explicit rather than inherited, so a future change to Keycloak's default cannot
      // quietly strip `sub` back out of the tokens these tests depend on.
      'client.use.lightweight.access.token.enabled': 'false',
    },
  };

  await retryWithBackoff(
    async () => {
      try {
        await keycloakClient.client.clients.create({ realm: TEST_REALM, ...testClient });
        return;
      } catch (e: unknown) {
        if (!isAlreadyExistsError(e)) {
          // Anything else may be transient
          throw e;
        }
      }

      const [existing] = await keycloakClient.client.clients.find({
        realm: TEST_REALM,
        clientId: TEST_DIRECT_GRANT_CLIENT_ID,
      });

      if (!existing?.id) {
        throw new Error(
          `Keycloak reported an existing "${TEST_DIRECT_GRANT_CLIENT_ID}" client, but no exact match was readable yet`,
        );
      }

      await keycloakClient.client.clients.update(
        { id: existing.id, realm: TEST_REALM },
        {
          ...testClient,
          // Keep any unrelated attributes the client already carries.
          attributes: { ...existing.attributes, ...testClient.attributes },
        },
      );
    },
    { attempts: 10, baseInterval: 1000, maxInterval: 1000 },
  );
}
