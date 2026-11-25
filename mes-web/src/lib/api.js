import { useCallback, useEffect, useRef, useState } from 'react'

// /api 호출. 실패하면 서버 메시지를 담은 Error 를 던짐
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
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

// GET 데이터 + 로딩/오류 상태. refreshMs 를 주면 주기적으로 다시 불러옴 (탭이 보일 때만)
export function useApi(path, { refreshMs } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const d = await api(path)
      if (!alive.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (alive.current) setError(e.message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    alive.current = true
    reload()
    if (!refreshMs) return () => (alive.current = false)
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), refreshMs)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [reload, refreshMs])

  return { data, error, loading, reload, setData }
}
