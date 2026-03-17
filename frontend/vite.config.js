import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['quill-image-resize-module-react', 'react-quill-new'],
  },
  server: {
    port: 3003,
  }
})
