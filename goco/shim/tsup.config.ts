import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: false,
  clean: true, 
  dts: true, 
  format: ['cjs'],
  minify: true,
  noExternal: [/(.*)/],
  entryPoints: ['src/index.ts'],
  watch: false,
  target: 'es5',
  outDir: 'dist',
  entry: ['src/**/*.ts'], //include all files under src
};
