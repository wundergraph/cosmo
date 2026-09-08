/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config/)

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /* for example, use global to avoid globals imports (describe, test, expect): */
    // globals: true,
    restoreMocks: true,
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
