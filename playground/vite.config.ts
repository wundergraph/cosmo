import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import react from '@vitejs/plugin-react';
import path from 'path';
import dts from 'vite-plugin-dts';

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  const singleFileOutput = process.env.VITE_SINGLE_FILE_OUTPUT === 'true';

  // https://vitejs.dev/config/
  return defineConfig({
    build: {
      minify: 'terser',
      // Required to make require() work e.g for graphql-ws
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      lib: !singleFileOutput
        ? {
            entry: path.resolve(__dirname, './src/index.ts'),
            name: '@wundergraph/playground',
            fileName: (format) => `index.${format}.js`,
          }
        : false,
      sourcemap: !singleFileOutput,
      emptyOutDir: true,
      rollupOptions: !singleFileOutput
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
    plugins: [react(), !singleFileOutput ? dts() : viteSingleFile()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  });
};
