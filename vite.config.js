import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: resolve(__dirname, 'index.html')
    },
    // Keep the original asset structure
    assetsInlineLimit: 0
  }
});