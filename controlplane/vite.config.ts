/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config/)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10_000,
    // Ensure always the CJS version is used otherwise we might conflict with multiple versions of graphql
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});
