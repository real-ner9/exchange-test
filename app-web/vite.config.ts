import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// В разработке /api проксируется в app-api; в Docker то же делает nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:4000',
    },
  },
})
