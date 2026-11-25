import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from '../build-info.js'

// 포트폴리오 사이트 (cloudheat.kr)
export default defineConfig({
  plugins: [react()],
  define: buildInfo(),
})
