import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Ensure always the CJS version is used otherwise we might conflict with multiple versions of graphql
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});