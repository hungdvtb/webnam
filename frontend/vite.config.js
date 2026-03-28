import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['quill-image-resize-module-react', 'react-quill-new'],
  },
  server: {
    // Listen on all interfaces so Vite can serve both localhost and LAN access.
    // Leaving HMR host unset lets the client reuse the actual browser origin
    // instead of always forcing ws://localhost:3003.
    host: true,
    port: 3003,
    strictPort: true,
  },
})
