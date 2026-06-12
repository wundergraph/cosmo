import { pino } from 'pino';
import Keycloak from '../src/core/services/Keycloak.js';

// The realm every test shares. Must match `realm` in test/test-util.ts.
const realm = 'test';
const loginRealm = 'master';

/**
 * Vitest global setup. Runs once in the main process before the worker pool is
 * spawned, so it is the single point where we:
 *   1. Wait for Keycloak to become reachable (CI starts it in the background with
 *      no readiness gate), and
 *   2. Create the shared `test` realm exactly once.
 *
 * Doing this here removes the race where ~16 parallel test files each call
 * `realms.create('test')` in their first `SetupKeycloak`, and the loser of the
 * create-vs-durably-readable window fails its first test with "Realm not found".
 */
export default async function setup() {
  const logger = pino({ level: 'silent' });
  const keycloakClient = new Keycloak({
    apiUrl: process.env.KC_API_URL || 'http://localhost:8080',
    realm: loginRealm,
    clientId: 'studio',
    adminUser: 'admin',
    adminPassword: 'changeme',
    logger,
  });

  // This setup gates the entire suite — if it throws, vitest runs zero tests. CI
  // starts Keycloak in the background (download + unzip + boot takes ~80s), so the
  // budgets below are generous: the only cost of a high timeout is failing slower
  // when Keycloak is genuinely broken.

  // 1. Wait for Keycloak to accept admin authentication. ~180s budget.
  await retry(() => keycloakClient.authenticateClient(), { attempts: 180, delayMs: 1000 });

  // 2. Create the shared realm once, idempotently. 409 means it already exists
  //    (succeed); any other error may be transient while Keycloak is still warming
  //    up, so retry before treating it as fatal.
  await retry(
    async () => {
      try {
        await keycloakClient.client.realms.create({
          realm,
          enabled: true,
          displayName: realm,
          registrationEmailAsUsername: true,
        });
      } catch (e: any) {
        if (e.response?.status === 409) {
          return;
        }
        e.message = `Failed to create keycloak realm: ${realm}.` + e.message;
        throw e;
      }
    },
    { attempts: 10, delayMs: 1000 },
  );

  // 3. Wait until the realm is durably readable before any test runs, closing the
  //    window between create and the realm being visible to subsequent requests.
  await retry(
    async () => {
      const found = await keycloakClient.client.realms.findOne({ realm });
      if (!found) {
        throw new Error(`Realm ${realm} not yet readable`);
      }
    },
    { attempts: 30, delayMs: 500 },
  );
}

async function retry(task: () => Promise<unknown>, { attempts, delayMs }: { attempts: number; delayMs: number }) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await task();
      return;
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
