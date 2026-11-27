import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.mjs'

// 가상 ERP 화면 (erp.cloudheat.kr)
export default defineConfig({
  plugins: [react()],
  // 개발 서버에서 /erp 는 실제 서버로 전달
  server: { proxy: { '/erp': 'http://192.168.0.10:8090' } },
  preview: { proxy: { '/erp': 'http://192.168.0.10:8090' } },
  define: buildInfo(),
})
