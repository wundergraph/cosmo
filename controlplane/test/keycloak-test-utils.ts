import { NetworkError } from '@keycloak/keycloak-admin-client';

// Keycloak helpers shared by global-setup.ts and test-util.ts so they always use the
// same realm, client, and error handling.
export const TEST_REALM = 'test';

/** HTTP status of a keycloak-admin-client {@link NetworkError}, or `undefined` for any other error. */
function keycloakErrorStatus(error: unknown): number | undefined {
  return error instanceof NetworkError ? error.response.status : undefined;
}

/** True when Keycloak rejected a create because the resource already exists (HTTP 409). */
export function isAlreadyExistsError(error: unknown): boolean {
  return keycloakErrorStatus(error) === 409;
}

/** True when Keycloak hasn't caught up to a just-created realm yet (HTTP 404 / "Realm not found"). */
export function isRealmNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return keycloakErrorStatus(error) === 404 || /realm not found/i.test(message);
}

export const keycloakClientOptions = {
  apiUrl: process.env.KC_API_URL || 'http://localhost:8080',
  realm: process.env.KC_LOGIN_REALM || 'master',
  clientId: process.env.KC_CLIENT_ID || 'studio',
  adminUser: process.env.KC_ADMIN_USER || 'admin',
  adminPassword: process.env.KC_ADMIN_PASSWORD || 'changeme',
};
