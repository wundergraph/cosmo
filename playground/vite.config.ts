import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import react from '@vitejs/plugin-react';
import path from 'path';
import dts from 'vite-plugin-dts';

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  const isLibrary = process.env.VITE_IS_LIBRARY === 'true';

  // https://vitejs.dev/config/
  return defineConfig({
    build: {
      minify: 'terser',
      // Required to make require() work e.g for graphql-ws
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      lib: isLibrary
        ? {
            entry: path.resolve(__dirname, './src/index.ts'),
            name: '@wundergraph/playground',
            fileName: (format) => `index.${format}.js`,
          }
        : false,
      sourcemap: isLibrary,
      emptyOutDir: true,
      rollupOptions: isLibrary
        ? {
            external: ['react', 'react-dom'],
            output: {
              globals: {
                react: 'React',
                'react-dom': 'ReactDOM',
              },
            },
          }
        : undefined,
    },
    plugins: [react(), isLibrary ? dts() : viteSingleFile()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  });
};
