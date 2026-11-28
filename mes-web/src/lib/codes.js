import { useMemo } from 'react'
import { useApi } from './api.js'

// ERP 관리내역등록에서 동기화된 공통코드 조회 훅
export function useCodes() {
  const { data, error, reload } = useApi('/master/codes')
  return useMemo(() => {
    const groups = data ?? []
    const byGroup = Object.fromEntries(groups.map((g) => [g.groupCode, g.codes ?? []]))
    const codesOf = (groupCode, { activeOnly = true } = {}) => {
      const list = byGroup[groupCode] ?? []
      return activeOnly ? list.filter((c) => c.useYn) : list
    }
    const mapOf = (groupCode) =>
      Object.fromEntries((byGroup[groupCode] ?? []).map((c) => [String(c.code), c.codeName]))
    return { groups, codesOf, mapOf, error, reload }
  }, [data, error, reload])
}
