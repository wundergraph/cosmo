import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    // Increase the timeout for integration tests
    testTimeout: 20_000,
    teardownTimeout: 10_000,
    // Ensure always the CJS version is used otherwise we might conflict with multiple versions of graphql
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});
