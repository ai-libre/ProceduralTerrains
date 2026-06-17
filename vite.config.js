import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6061,
    strictPort: true,   // fail loudly instead of silently moving to another port
    host: true,         // listen on all interfaces -> reachable on the network
  },
  build: {
    // Split the rarely-changing heavy deps (three, react) into their own hashed
    // chunks so the browser keeps them in HTTP cache across app updates — only
    // the small app chunk re-downloads when our code changes.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
