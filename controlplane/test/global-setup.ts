import { NetworkError } from '@keycloak/keycloak-admin-client';
import { pino } from 'pino';
import Keycloak from '../src/core/services/Keycloak.js';
import { retryWithBackoff } from '../src/core/util/poll-with-backoff.js';
import { TEST_REALM, keycloakClientOptions } from './keycloak-test-config.js';

/**
 * Creates the shared test realm once, before any test worker spawns. Otherwise the
 * parallel test files race to create it and whichever loses fails its first test
 * with "Realm not found".
 */
export default async function setup() {
  // Silence the admin client; setup failures surface via the retries below.
  const logger = pino({ level: 'silent' });
  const keycloakClient = new Keycloak({ ...keycloakClientOptions, logger });

  // Generous budget: CI boots Keycloak in the background, so it may not be ready yet.
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
        // 409 means the realm already exists; anything else may be transient — retry.
        if (e instanceof NetworkError && e.response.status === 409) {
          return;
        }
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
