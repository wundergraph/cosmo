import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    alias: [
      { find: /^graphql$/, replacement: 'graphql/index.js' },
      // Matches the `@/*` path alias in tsconfig.json, so tests import modules
      // the same way the application does.
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
    ],
  },
});
