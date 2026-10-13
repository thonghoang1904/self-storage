import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Where the ASP.NET Core backend runs during development (override in .env.development.local).
  const backend = env.BACKEND_URL || 'http://localhost:5080'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // The browser calls /api on this dev server and Vite forwards it to the backend,
      // so the backend's CORS list and the frontend's port do not matter while developing.
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
  }
})
