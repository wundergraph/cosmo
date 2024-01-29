import * as fs from 'fs';
import type { Options } from 'tsup';
import type { Plugin } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

const polyfillPlugin: Plugin = {
  name: 'Polyfill',
  setup(build) {
    build.onEnd((result) => {
      for (const file of result.outputFiles ?? []) {
        if (!file.path.endsWith('polyfill.js')) {
          const polyfill = fs.readFileSync('src/polyfill.js', 'utf-8');
          const replaced = polyfill + file.text;
          file.contents = new TextEncoder().encode(replaced);
        }
      }
    });
  },
};

const stringHashPLugin: Plugin = {
  name: 'stringHash',
  setup(build) {
    build.onEnd((result) => {
      // Replace hashing with a shim function that we provide
      // in the runtime
      const needle = /[A-Za-z][A-Za-z0-9]+?\.createHash\("sha1"\).update\((.*?)\).digest\("hex"\)/g;
      for (const file of result.outputFiles ?? []) {
        const replaced = file.text.replace(needle, 'stringHash($1)');
        file.contents = new TextEncoder().encode(replaced);
      }
    });
  },
};

const polyfillNodePlugin = polyfillNode({}) as any;

export const tsup: Options = {
  splitting: false,
  clean: true,
  dts: true,
  globalName: 'shim',
  format: ['iife'],
  minify: true,
  esbuildPlugins: [polyfillNodePlugin, polyfillPlugin, stringHashPLugin],
  noExternal: [/(.*)/],
  watch: false,
  target: 'es6', // goja supports only es6
  outDir: 'dist',
  entry: ['src/**/index.ts'],
};
