// 빌드 정보: 루트 VERSION 파일 + Git 커밋. site · mes-web 의 vite.config.js 에서 사용
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

export function buildInfo() {
  const version = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim()
  const sha = git('rev-parse --short HEAD') || 'nogit'
  const dirty = git('status --porcelain') ? '-dirty' : ''
  return {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_SHA__: JSON.stringify(sha + dirty),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  }
}
