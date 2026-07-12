import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['browser'],
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@wundergraph/cosmo-shared/playground/defer-schema': new URL(
        '../shared/src/playground/defer-schema.ts',
        import.meta.url,
      ).pathname,
      '@wundergraph/cosmo-shared/playground/incremental-delivery': new URL(
        '../shared/src/playground/incremental-delivery.ts',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    alias: [{ find: /^graphql$/, replacement: 'graphql/index.js' }],
  },
});
