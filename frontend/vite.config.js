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
      // Use 127.0.0.1 for HMR to avoid IPv6/localhost resolution instability on some Windows machines.
      host: true,
      port: 3003,
      strictPort: true,
      hmr: {
        host: '127.0.0.1',
      },
      // Polling can be heavy on resources; disabling it unless strictly needed.
      watch: {
        usePolling: false,
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
