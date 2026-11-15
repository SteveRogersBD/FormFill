import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(root, 'dashboard.html'),
        sidepanel: resolve(root, 'sidepanel.html'),
        offscreen: resolve(root, 'offscreen.html'),
        authHelper: resolve(root, 'auth-helper.html'),
        background: resolve(root, 'src/background.ts'),
        content: resolve(root, 'src/content.ts'),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'background' || chunk.name === 'content' ? '[name].js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
