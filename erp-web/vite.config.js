import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.mjs'

const erpTarget = process.env.ERP_API_URL || 'http://192.168.0.10:8090'

// 가상 ERP 화면 (erp.cloudheat.kr · 개발 서버 http://localhost:5174)
export default defineConfig({
  plugins: [react()],
  // 개발 서버: :5174 고정, 단독 실행 시 브라우저 자동 열기, /erp 는 서버로 프록시
  server: {
    port: 5174,
    strictPort: true,
    open: !process.env.NO_OPEN,
    proxy: { '/erp': erpTarget },
  },
  preview: {
    port: 4174,
    proxy: { '/erp': erpTarget },
  },
  define: buildInfo(),
})
