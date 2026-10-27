import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Read the repository's single .env. Only VITE_-prefixed values reach the browser.
  envDir: '..',
  server: {
    port: 5173,
    // Same-origin requests in development keep cookies SameSite=Strict-friendly.
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than our code; a separate file stays cached
        // across deploys.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'zod', 'react-hook-form', '@hookform/resolvers/zod'],
        },
      },
    },
  },
});
