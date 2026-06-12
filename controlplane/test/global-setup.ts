import { setTimeout as sleep } from 'node:timers/promises';
import { NetworkError } from '@keycloak/keycloak-admin-client';
import { pino } from 'pino';
import Keycloak from '../src/core/services/Keycloak.js';
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
  await retry(() => keycloakClient.authenticateClient(), { attempts: 180, delayMs: 1000 });

  await retry(
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
    { attempts: 10, delayMs: 1000 },
  );

  // The realm can be acknowledged before it is readable; wait until it is.
  await retry(
    async () => {
      const found = await keycloakClient.client.realms.findOne({ realm: TEST_REALM });
      if (!found) {
        throw new Error(`Realm "${TEST_REALM}" is not yet readable`);
      }
    },
    { attempts: 30, delayMs: 500 },
  );
}

async function retry<T>(
  task: () => Promise<T>,
  { attempts, delayMs }: { attempts: number; delayMs: number },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}
