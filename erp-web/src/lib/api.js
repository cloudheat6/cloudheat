import { useCallback, useEffect, useRef, useState } from 'react'

// /erp/ui 호출. 실패하면 서버 메시지를 담은 Error 를 던짐
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/erp/ui${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `요청 실패 (HTTP ${res.status})`
    if (res.status === 429) message = '요청이 너무 많아요. 잠시 후 다시 시도하세요'
    else {
      try {
        const j = await res.json()
        if (j?.message) message = j.message
      } catch {
        /* 본문 없음 */
      }
    }
    throw new Error(message)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export function useApi(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const d = await api(path)
      if (alive.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e.message)
    }
  }, [path])

  useEffect(() => {
    alive.current = true
    reload()
    return () => (alive.current = false)
  }, [reload])

  return { data, error, reload }
}

const nf = new Intl.NumberFormat('ko-KR')
export const fmtNum = (v) => (v == null || v === '' ? '' : nf.format(v))

const pad = (n) => String(n).padStart(2, '0')
export const today = (addDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + addDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const fmtDateTime = (iso) => {
  if (!iso) return ''
  const x = new Date(iso)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`
}

// MES 화면 주소: 도메인이면 mes.<도메인>, 내부망(:8090)이면 같은 호스트 :8080
export const mesWebUrl = (path = '') => {
  const { protocol, hostname, port } = window.location
  if (hostname.startsWith('erp.')) return `${protocol}//mes.${hostname.slice(4)}${path}`
  if (port === '8090') return `${protocol}//${hostname}:8080${path}`
  return `https://mes.cloudheat.kr${path}`
}
