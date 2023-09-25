import type { Options } from 'tsup';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

export const tsup: Options = {
  splitting: false,
  clean: true,
  dts: true,
  globalName: 'shim',
  format: ['iife'],
  minify: false,
  esbuildPlugins: [polyfillNode()],
  noExternal: [/(.*)/],
  entryPoints: ['src/index.ts'],
  watch: false,
  target: 'es6',
  outDir: 'dist',
  entry: ['src/**/*.ts'],
};
