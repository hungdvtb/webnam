import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['quill-resize-module', 'react-quill-new'],
  },
  server: {
    host: 'localhost',
    port: 3003,
    strictPort: true,
    hmr: {
      host: 'localhost',
      port: 3003,
      clientPort: 3003,
      protocol: 'ws',
    },
  },
})
