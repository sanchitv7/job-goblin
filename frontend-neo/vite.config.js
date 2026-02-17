import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

if (process.env.NODE_ENV === 'development') {
  const { startServer } = await import('@react-grab/claude-code/server')
  startServer()
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
})