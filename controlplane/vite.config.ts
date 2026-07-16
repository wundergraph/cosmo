import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    // Create the shared Keycloak realm exactly once, before any worker spawns.
    // This removes the concurrent realm-creation race between parallel test files.
    globalSetup: ['./test/global-setup.ts'],
    // Increase the timeout for integration tests
    testTimeout: 20_000,
    teardownTimeout: 10_000,
    // Ensure always the CJS version is used otherwise we might conflict with multiple versions of graphql
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});
