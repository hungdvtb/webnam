import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiProxyTarget = String(env.VITE_DEV_API_PROXY_TARGET || 'http://127.0.0.1:8003').trim().replace(/\/+$/, '')
  const ignoredTempArtifacts = ['**/.tmp-*', '**/.chrome-*']

  return {
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
      // Ignore Codex/browser automation artifacts so temporary HTML or screenshots
      // do not trigger full-page reloads while long-running uploads are in flight.
      watch: {
        ignored: ignoredTempArtifacts,
      },
      proxy: {
        '/api': {
          target: devApiProxyTarget,
          changeOrigin: true,
        },
        '/media': {
          target: devApiProxyTarget,
          changeOrigin: true,
        },
        '/storage': {
          target: devApiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
