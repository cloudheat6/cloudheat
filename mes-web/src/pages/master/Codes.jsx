import { useEffect, useMemo, useState } from 'react'
import { api, useApi } from '../../lib/api.js'
import { DataGrid } from '../../lib/grid.jsx'
import { fmtDateTime, fmtNum } from '../../lib/format.js'
import { useToast } from '../../lib/toast.jsx'
import { Badge, ErrorBox, Kpi, PageHeader } from '../../components/ui.jsx'

// 공통코드관리: ERP 관리내역등록의 코드를 1분마다 증분 수신, MES 화면 전반의 선택 목록 · 구분 표시에서 사용
export default function Codes() {
  const notify = useToast()
  const { data, error, reload } = useApi('/master/codes')
  const [picked, setPicked] = useState(null)
  const [groupQuery, setGroupQuery] = useState('')
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)

  const groups = data ?? []
  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase()
    return groups.filter((g) => !q || `${g.groupCode} ${g.groupName} ${g.remark}`.toLowerCase().includes(q))
  }, [groups, groupQuery])

  const current = groups.find((g) => g.groupCode === picked) ?? groups[0] ?? null

  useEffect(() => {
    if (!picked && groups.length) setPicked(groups[0].groupCode)
  }, [picked, groups])

  const columnDefs = useMemo(
    () => [
      { field: 'code', headerName: '코드', width: 120, cellClass: 'mono strong' },
      { field: 'codeName', headerName: '코드명', width: 170, cellClass: 'strong' },
      { field: 'sortNo', headerName: '정렬', width: 80, type: 'rightAligned' },
      {
        field: 'useYn',
        headerName: '사용',
        width: 90,
        cellRenderer: (p) => <Badge tone={p.value ? 'ok' : 'muted'}>{p.value ? '사용' : '미사용'}</Badge>,
      },
      { field: 'remark', headerName: '비고', flex: 1, minWidth: 180 },
      { field: 'erpSyncedAt', headerName: 'ERP 수신', width: 135, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono muted', filter: false },
    ],
    [],
  )

  const sync = async () => {
    setBusy(true)
    try {
      const logs = await api('/master/sync', { method: 'POST' })
      const failed = logs.some((l) => l.status === '실패')
      notify(
        `ERP 수신: ${logs.map((l) => `${l.kind} ${l.status}${l.applied ? ` ${l.applied}건` : ''}`).join(', ')}`,
        failed ? 'error' : 'ok',
      )
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const totalCodes = groups.reduce((s, g) => s + g.codes.length, 0)
  const activeCodes = groups.reduce((s, g) => s + g.codes.filter((c) => c.useYn).length, 0)

  return (
    <>
      <PageHeader
        title="공통코드관리"
        desc="ERP 관리내역등록에 등록된 코드를 1분마다 받아와요. 발주 · 주문 구분, 통화, 품목 · 거래처 · 창고 구분 등 MES 화면 전반에서 사용해요."
      >
        <button className="btn ghost" disabled={busy} onClick={sync}>
          ERP에서 지금 수신
        </button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />

      <section className="kpis">
        <Kpi label="코드 분류" value={`${fmtNum(groups.length)}개`} />
        <Kpi label="전체 코드" value={`${fmtNum(totalCodes)}개`} />
        <Kpi label="사용 중" value={`${fmtNum(activeCodes)}개`} tone="ok" />
      </section>

      <div className="md">
        <aside className="picker">
          <input className="search" type="search" placeholder="분류코드 · 분류명 검색" value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} />
          <ul>
            {filteredGroups.map((g) => (
              <li key={g.groupCode}>
                <button className={`pick ${current?.groupCode === g.groupCode ? 'on' : ''} ${g.useYn ? '' : 'off'}`} onClick={() => setPicked(g.groupCode)}>
                  <span className="pick-main">
                    <span className="mono strong">{g.groupCode}</span>
                    <span className="pick-name">{g.groupName}</span>
                  </span>
                  <span className={`pick-count ${g.codes.length === 0 ? 'zero' : ''}`}>{g.codes.length}개</span>
                </button>
              </li>
            ))}
            {data && filteredGroups.length === 0 && <li className="pick-empty muted small">조건에 맞는 코드 분류가 없어요</li>}
          </ul>
        </aside>

        <section className="editor">
          {current ? (
            <>
              <div className="editor-head">
                <div>
                  <strong>
                    {current.groupCode} · {current.groupName}
                  </strong>
                  <div className="muted small">
                    {current.remark || 'ERP 관리내역등록에서 동기화된 코드 목록'} · 최근 수신 {fmtDateTime(current.erpSyncedAt)}
                  </div>
                </div>
                <input className="search" type="search" placeholder="코드 · 코드명 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
              </div>
              <DataGrid
                height={460}
                rowData={current.codes}
                getRowId={(p) => `${p.data.groupCode}|${p.data.code}`}
                columnDefs={columnDefs}
                quickFilterText={quick}
                overlayNoRowsTemplate="등록된 코드가 없어요"
              />
            </>
          ) : (
            <p className="muted">왼쪽에서 코드 분류를 선택하세요.</p>
          )}
        </section>
      </div>
    </>
  )
}
