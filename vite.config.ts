import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Improve compatibility with older mobile browsers.
    target: 'es2019',
    // Keep warning aligned with current project target.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
    rollupOptions: {
      output: {
        // Performance-only split strategy: no behavioral changes, only chunk layout.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor'
          if (id.includes('/aws-amplify/') || id.includes('/@aws-amplify/')) return 'amplify-vendor'
          if (id.includes('/@aws-sdk/')) return 'aws-sdk-vendor'
          if (id.includes('/xlsx/')) return 'xlsx-vendor'
          if (id.includes('/jspdf/')) return 'jspdf-vendor'
          if (id.includes('/html2canvas/')) return 'html2canvas-vendor'
          if (id.includes('/docx/')) return 'docx-vendor'
          if (id.includes('/@dnd-kit/')) return 'dnd-vendor'

          return 'vendor'
        },
      },
    },
  },
})
