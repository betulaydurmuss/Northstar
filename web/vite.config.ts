import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin requests in development keep cookies SameSite=Strict-friendly.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
