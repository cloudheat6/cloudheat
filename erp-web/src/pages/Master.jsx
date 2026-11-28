import { useMemo, useState } from 'react'
import { fmtDateTime, useApi } from '../lib/api.js'

const META = {
  items: {
    title: '품목등록',
    desc: '기준정보의 원본은 ERP 예요. MES 는 1분마다 바뀐 것만 받아가서 품목관리에 반영해요.',
    plannedNote: '품목 추가 · 수정 등록 기능은 준비 중이에요.',
    path: '/items',
    typeGroup: 'ITEM_TYPE',
    typeLabel: '품목구분',
    placeholder: '품목코드 · 품목명 검색',
  },
  partners: {
    title: '거래처등록',
    desc: '기준정보의 원본은 ERP 예요. MES 는 1분마다 바뀐 것만 받아가서 거래처관리에 반영해요.',
    plannedNote: '거래처 추가 · 수정 등록 기능은 준비 중이에요.',
    path: '/partners',
    typeGroup: 'PARTNER_TYPE',
    typeLabel: '거래처구분',
    placeholder: '거래처코드 · 거래처명 검색',
  },
}

// 품목등록 · 거래처등록: ERP 가 원본, 구분 선택 목록은 관리내역등록(/codes)에서 가져옴
export default function Master({ kind }) {
  const m = META[kind]
  const { data, error, reload } = useApi(m.path)
  const codeGroups = useApi('/codes')
  const [quick, setQuick] = useState('')
  const [typeFilter, setTypeFilter] = useState('전체')

  const typeCodes = useMemo(() => {
    return (codeGroups.data ?? []).find((g) => g.groupCode === m.typeGroup)?.codes ?? []
  }, [codeGroups.data, m.typeGroup])

  const typeMap = useMemo(() => Object.fromEntries(typeCodes.map((c) => [c.code, c.codeName])), [typeCodes])

  const rows = useMemo(() => {
    const q = quick.trim().toLowerCase()
    const list = data ?? []
    if (kind === 'items') {
      return list
        .filter((i) => (typeFilter === '전체' || i.itemType === typeFilter) && (!q || `${i.itemCode} ${i.itemName} ${i.itemType}`.toLowerCase().includes(q)))
        .toSorted((a, b) => b.itemType.localeCompare(a.itemType) || a.itemCode.localeCompare(b.itemCode))
    }
    return list
      .filter((p) => (typeFilter === '전체' || p.partnerType === typeFilter) && (!q || `${p.partnerCode} ${p.partnerName} ${p.partnerType}`.toLowerCase().includes(q)))
      .toSorted((a, b) => a.partnerCode.localeCompare(b.partnerCode))
  }, [data, kind, quick, typeFilter])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{m.title}</h1>
          <p>{m.desc}</p>
        </div>
        <span className="planned-stage" title={m.plannedNote}>
          등록 기능 준비 중
        </span>
      </div>

      {error && (
        <div className="error-box">
          불러오지 못했어요: {error}{' '}
          <button className="btn ghost sm" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}

      <section className="panel">
        <div className="panel-bar">
          <input className="search" type="search" placeholder={m.placeholder} value={quick} onChange={(e) => setQuick(e.target.value)} />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={m.typeLabel}>
            <option value="전체">{m.typeLabel}: 전체</option>
            {typeCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.codeName}
              </option>
            ))}
          </select>
          <span className="muted small">{rows.length}건</span>
        </div>
        <div className="table-wrap">
          {kind === 'items' ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>품목코드</th>
                  <th>품목명</th>
                  <th>구분</th>
                  <th>단위</th>
                  <th>최종 수정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.itemCode}>
                    <td className="mono strong">{i.itemCode}</td>
                    <td>{i.itemName}</td>
                    <td>
                      <span className="tag">{typeMap[i.itemType] ?? i.itemType}</span>
                    </td>
                    <td>{i.unit}</td>
                    <td className="mono muted">{fmtDateTime(i.updatedAt)}</td>
                  </tr>
                ))}
                {data && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      조건에 맞는 품목이 없어요
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>거래처명</th>
                  <th>구분</th>
                  <th>최종 수정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.partnerCode}>
                    <td className="mono strong">{p.partnerCode}</td>
                    <td>{p.partnerName}</td>
                    <td>
                      <span className="tag">{typeMap[p.partnerType] ?? p.partnerType}</span>
                    </td>
                    <td className="mono muted">{fmtDateTime(p.updatedAt)}</td>
                  </tr>
                ))}
                {data && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      조건에 맞는 거래처가 없어요
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  )
}
