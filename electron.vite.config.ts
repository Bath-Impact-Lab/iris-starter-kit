import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

// electron-vite bundles src/main into a single out/main/index.js, so
// pipeline-template.json -- read at runtime relative to that file's own
// location (see config.ts) -- has to be copied there explicitly; it isn't
// reachable through a static import.
function copyPipelineTemplate(): Plugin {
  return {
    name: 'copy-pipeline-template',
    closeBundle() {
      const from = resolve(__dirname, 'src/main/iris/pipeline-template.json');
      const to = resolve(__dirname, 'out/main/pipeline-template.json');
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyPipelineTemplate()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [vue()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
  },
});
