import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Raise the single-chunk warning threshold slightly so minor splits aren't flagged
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Amplify category entry points (smaller, cache-friendly splits) ─
          if (
            id.includes('node_modules/aws-amplify/api') ||
            id.includes('node_modules/@aws-amplify/api') ||
            id.includes('node_modules/@aws-amplify/data-schema')
          ) {
            return 'vendor-amplify-api';
          }

          if (
            id.includes('node_modules/aws-amplify/data') ||
            id.includes('node_modules/@aws-amplify/data')
          ) {
            return 'vendor-amplify-data';
          }

          // ── Amplify core runtime ──────────────────────────────────────────
          if (
            id.includes('node_modules/aws-amplify') ||
            id.includes('node_modules/@aws-amplify/core') ||
            id.includes('node_modules/@aws-amplify/auth') ||
            id.includes('node_modules/@aws-amplify/api') ||
            id.includes('node_modules/@aws-amplify/storage') ||
            id.includes('node_modules/@aws-amplify/data-schema')
          ) {
            return 'vendor-amplify-core';
          }

          // ── Amplify UI components (large React component library) ─────────
          if (id.includes('node_modules/@aws-amplify/ui')) {
            return 'vendor-amplify-ui';
          }

          // ── AWS SDK clients (Cognito, etc.) ───────────────────────────────
          if (
            id.includes('node_modules/@aws-sdk') ||
            id.includes('node_modules/@smithy')
          ) {
            return 'vendor-aws-sdk';
          }

          // ── React + React-DOM → part of the main vendor-misc bundle
          // (keeping React separate causes circular chunk warnings because
          //  react-dom/scheduler has mutual deps with other vendor modules)

          // ── DnD kit ────────────────────────────────────────────────────────
          if (id.includes('node_modules/@dnd-kit')) {
            return 'vendor-dndkit';
          }

          // ── react-icons ────────────────────────────────────────────────────
          if (id.includes('node_modules/react-icons')) {
            return 'vendor-icons';
          }

          // ── vendor-misc heavy contributors (non-React groups) ─────────────
          if (id.includes('node_modules/lodash/')) {
            return 'vendor-lodash';
          }

          if (id.includes('node_modules/rxjs/')) {
            return 'vendor-rxjs';
          }

          if (
            id.includes('node_modules/xstate/') ||
            id.includes('node_modules/@xstate/react/') ||
            id.includes('node_modules/use-isomorphic-layout-effect/')
          ) {
            return 'vendor-xstate';
          }

          if (
            id.includes('node_modules/qrcode/') ||
            id.includes('node_modules/dijkstrajs/') ||
            id.includes('node_modules/encode-utf8/') ||
            id.includes('node_modules/crc-32/')
          ) {
            return 'vendor-qrcode';
          }

          // ── Everything else in node_modules → generic vendor chunk ─────────
          if (id.includes('node_modules/')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },
})
