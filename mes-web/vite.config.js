import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.mjs'

const apiTarget = process.env.MES_API_URL || 'http://192.168.0.10:8080'

// MES 웹 (mes.cloudheat.kr · 개발 서버 http://localhost:5173)
export default defineConfig({
  plugins: [react()],
  // AG Grid 가 커서 경고 기준을 올림 (gzip ~440KB)
  build: { chunkSizeWarningLimit: 1600 },
  // 개발 서버: :5173 고정, 실행 시 브라우저 자동 열기, /api 는 서버로 프록시
  server: {
    port: 5173,
    strictPort: true,
    open: !process.env.NO_OPEN,
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 4173,
    proxy: { '/api': apiTarget },
  },
  define: buildInfo(),
})
