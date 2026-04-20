import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Keep warning slightly above default without forcing fragile manual chunking.
    chunkSizeWarningLimit: 900,
  },
})
