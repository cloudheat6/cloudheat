import { useMemo, useState } from 'react'
import { api, useApi } from '../../lib/api.js'
import { DataGrid } from '../../lib/grid.jsx'
import { fmtDateTime } from '../../lib/format.js'
import { useToast } from '../../lib/toast.jsx'
import { BadgeCell, ErrorBox, Kpi, PageHeader } from '../../components/ui.jsx'

// 거래처: ERP 가 원본, MES 는 조회만
export default function Partners() {
  const notify = useToast()
  const { data, error, reload } = useApi('/master/partners')
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)

  const columnDefs = useMemo(
    () => [
      { field: 'partnerType', headerName: '구분', width: 100, cellRenderer: BadgeCell },
      { field: 'partnerCode', headerName: '거래처 코드', width: 130, cellClass: 'mono strong' },
      { field: 'partnerName', headerName: '거래처명', flex: 1, minWidth: 200 },
      { field: 'erpSyncedAt', headerName: 'ERP 수신', width: 140, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono muted', filter: false },
    ],
    [],
  )

  const sync = async () => {
    setBusy(true)
    try {
      const logs = await api('/master/sync', { method: 'POST' })
      const failed = logs.some((l) => l.status === '실패')
      notify(`ERP 수신: ${logs.map((l) => `${l.kind} ${l.status}`).join(', ')}`, failed ? 'error' : 'ok')
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const all = data ?? []
  return (
    <>
      <PageHeader title="거래처관리" desc="거래처는 ERP가 원본이라 MES에서는 조회만 해요. ERP에서 1분마다 받아와요.">
        <button className="btn ghost" disabled={busy} onClick={sync}>
          ERP에서 지금 수신
        </button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      <section className="kpis">
        <Kpi label="거래처" value={`${all.length}곳`} />
        <Kpi label="매입처" value={`${all.filter((p) => p.partnerType === '매입처').length}곳`} />
        <Kpi label="매출처" value={`${all.filter((p) => p.partnerType === '매출처').length}곳`} />
      </section>
      <section className="toolbar">
        <input className="search" type="search" placeholder="거래처 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
      </section>
      <DataGrid height={480} rowData={data} getRowId={(p) => p.data.partnerCode} columnDefs={columnDefs} quickFilterText={quick} />
    </>
  )
}
