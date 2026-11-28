import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.mjs'

// 포트폴리오 사이트 (cloudheat.kr · 개발 서버 http://localhost:5175)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    open: !process.env.NO_OPEN,
  },
  define: buildInfo(),
})
