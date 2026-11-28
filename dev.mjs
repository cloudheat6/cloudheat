// 루트 개발 서버 실행기: MES(:5173) + 가상 ERP(:5174) 를 동시에 띄우고 브라우저로 접속
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const arg = process.argv[2]

const noOpenAll = process.env.NO_OPEN === '1'

const targets =
  arg === 'mes'
    ? [{ name: 'MES', dir: 'mes-web', open: !noOpenAll }]
    : arg === 'erp'
      ? [{ name: 'ERP', dir: 'erp-web', open: !noOpenAll }]
      : arg === 'site'
        ? [{ name: 'SITE', dir: 'site', open: !noOpenAll }]
        : [
            { name: 'MES', dir: 'mes-web', open: !noOpenAll },
            { name: 'ERP', dir: 'erp-web', open: false },
          ]

console.log('==> 개발 서버 시작: MES http://localhost:5173 · 가상 ERP http://localhost:5174 (종료: Ctrl+C)')

const procs = targets.map((t) => {
  const cwd = join(root, t.dir)
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NO_OPEN: t.open ? '' : '1' },
  })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
  return child
})

const stop = () => {
  for (const p of procs) {
    if (!p.killed) p.kill('SIGINT')
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
