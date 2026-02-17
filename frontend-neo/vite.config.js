import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { startServer } from '@react-grab/claude-code/server'

if (process.env.NODE_ENV === 'development') {
  startServer()
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
})