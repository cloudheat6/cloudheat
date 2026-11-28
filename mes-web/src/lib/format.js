const nf = new Intl.NumberFormat('ko-KR')

export const fmtNum = (v) => (v == null || v === '' ? '' : nf.format(v))
export const fmtSigned = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${nf.format(v)}`)
export const fmtPct = (v) => (v == null || Number.isNaN(v) ? '-' : `${(v * 100).toFixed(1)}%`)

const pad = (n) => String(n).padStart(2, '0')

export const fmtDate = (d) => {
  if (!d) return ''
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

export const fmtDateTime = (iso) => {
  if (!iso) return ''
  const x = new Date(iso)
  return `${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`
}

// 'YYYY-MM-DD' → 로컬 Date
export const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const ago = (iso) => {
  if (!iso) return '-'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}

// ERP 화면 주소: 도메인이면 erp.<도메인>, 내부망(:8080)이면 같은 호스트 :8090
export const erpWebUrl = (path = '') => {
  const { protocol, hostname, port } = window.location
  if (hostname.startsWith('mes.')) return `${protocol}//erp.${hostname.slice(4)}${path}`
  if (port === '8080') return `${protocol}//${hostname}:8090${path}`
  return `https://erp.cloudheat.kr${path}`
}
