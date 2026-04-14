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

          // ── Everything else in node_modules → generic vendor chunk ─────────
          if (id.includes('node_modules/')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },
})
