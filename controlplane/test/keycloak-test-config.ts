// Shared by global-setup.ts and test-util.ts so they always use the same realm and client.
export const TEST_REALM = 'test';

export const keycloakClientOptions = {
  apiUrl: process.env.KC_API_URL || 'http://localhost:8080',
  realm: process.env.KC_LOGIN_REALM || 'master',
  clientId: process.env.KC_CLIENT_ID || 'studio',
  adminUser: process.env.KC_ADMIN_USER || 'admin',
  adminPassword: process.env.KC_ADMIN_PASSWORD || 'changeme',
};
