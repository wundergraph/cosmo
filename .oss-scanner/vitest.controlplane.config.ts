import { defineConfig } from 'vitest/config';

// The stock globalSetup retries Keycloak, so it stalls without a network.
export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 20_000,
    teardownTimeout: 10_000,
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});
