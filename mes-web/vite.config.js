import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.mjs'

// MES 웹 (mes.cloudheat.kr)
export default defineConfig({
  plugins: [react()],
  // AG Grid 가 커서 경고 기준을 올림 (gzip ~440KB)
  build: { chunkSizeWarningLimit: 1600 },
  // 개발 서버에서 /api 는 실제 서버로 전달
  server: { proxy: { '/api': 'http://192.168.0.10:8080' } },
  preview: { proxy: { '/api': 'http://192.168.0.10:8080' } },
  define: buildInfo(),
})
