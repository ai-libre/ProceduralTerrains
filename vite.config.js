import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // Relative base for production so the build works under a GitHub Pages project
  // subpath (https://<owner>.github.io/<repo>/) without hardcoding the repo name.
  // Dev server stays at '/'. There is no client-side router, so no SPA fallback
  // is needed — a single index.html + relative assets is enough.
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    port: 6061,
    strictPort: false,  // allow port shifting if 6061 is in use
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
}));
