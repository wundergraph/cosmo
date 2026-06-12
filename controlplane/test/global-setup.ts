import { pino } from 'pino';
import Keycloak from '../src/core/services/Keycloak.js';
import { retryWithBackoff } from '../src/core/util/poll-with-backoff.js';
import { TEST_REALM, keycloakClientOptions, isAlreadyExistsError } from './keycloak-test-utils.js';

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
}
