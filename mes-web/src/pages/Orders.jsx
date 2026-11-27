import { useMemo, useState } from 'react'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { ago, erpWebUrl, fmtDateTime, fmtNum } from '../lib/format.js'
import { useToast } from '../lib/toast.jsx'
import { Badge, BadgeCell, ErrorBox, Kpi, PageHeader } from '../components/ui.jsx'

const TEXT = {
  발주: { path: '/orders/purchase', erp: '/purchase', no: '발주번호', date: '발주일', partner: '매입처', done: '입고', next: '입고관리에서 이 발주로 입고를 등록해요.' },
  주문: { path: '/orders/sales', erp: '/sales', no: '주문번호', date: '주문일', partner: '고객사', done: '출고', next: '출고관리에서 이 주문으로 출고를 등록해요.' },
}

export default function Orders({ kind }) {
  const t = TEXT[kind]
  const notify = useToast()
  const { data, error, reload } = useApi(t.path, { refreshMs: 30000 })
  const { data: integ, reload: reloadInteg } = useApi('/integration/summary', { refreshMs: 30000 })
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)

  const lastSync = integ?.summary?.lastSync?.find((s) => s.kind === kind)

  const columnDefs = useMemo(
    () => [
      { field: 'orderNo', headerName: t.no, width: 135, pinned: 'left', cellClass: 'mono strong' },
      { field: 'orderDate', headerName: t.date, width: 110, cellClass: 'mono' },
      { field: 'partnerName', headerName: t.partner, width: 130 },
      { field: 'dueDate', headerName: '납기', width: 110, cellClass: 'mono' },
      { field: 'lineNo', headerName: '행', width: 60, type: 'rightAligned' },
      { field: 'itemCode', headerName: '품목코드', width: 120, cellClass: 'mono' },
      { field: 'itemName', headerName: '품목명', flex: 1, minWidth: 150 },
      { field: 'orderQty', headerName: '수량', width: 95, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: (p) => fmtNum(p.value) },
      { field: 'doneQty', headerName: t.done, width: 90, type: 'rightAligned', valueFormatter: (p) => fmtNum(p.value) },
      { colId: 'remain', headerName: '잔량', width: 90, type: 'rightAligned', valueGetter: (p) => p.data.orderQty - p.data.doneQty, valueFormatter: (p) => fmtNum(p.value), cellClass: 'strong' },
      { field: 'unit', headerName: '단위', width: 70 },
      { field: 'erpStatus', headerName: 'ERP 상태', width: 95, cellRenderer: BadgeCell },
      { field: 'syncedAt', headerName: '수신', width: 125, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono muted', filter: false },
    ],
    [t],
  )

  const orderCount = useMemo(() => new Set((data ?? []).map((r) => r.orderNo)).size, [data])
  const qty = (data ?? []).reduce((s, r) => s + r.orderQty, 0)

  const run = async (fn, okMsg) => {
    setBusy(true)
    try {
      const res = await fn()
      const msg = okMsg(res)
      notify(...(Array.isArray(msg) ? msg : [msg, 'ok']))
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
      reload()
      reloadInteg()
    }
  }

  return (
    <>
      <PageHeader title={`${kind}관리`} desc={`ERP에서 확정된 ${kind}을 1분마다 자동으로 받아와요. ${t.next}`}>
        <a className="btn ghost" href={erpWebUrl(t.erp)} target="_blank" rel="noreferrer">
          가상 ERP에서 {kind === '발주' ? '발주' : '수주'} 입력 ↗
        </a>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() =>
            run(
              () => api('/integration/sync', { method: 'POST' }),
              (logs) => [
                `수신: ${logs.map((l) => `${l.kind} ${l.status}${l.applied ? ` ${l.applied}건` : ''}`).join(', ') || '새 데이터 없음'}`,
                logs.some((l) => l.status === '실패') ? 'error' : 'ok',
              ],
            )
          }
        >
          지금 수신
        </button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />

      <section className="kpis">
        <Kpi label={`수신한 ${kind}`} value={`${fmtNum(orderCount)}건`} sub={`${fmtNum(data?.length ?? 0)}개 라인`} />
        <Kpi label="총 수량" value={fmtNum(qty)} />
        <Kpi
          label="마지막 수신"
          value={lastSync ? ago(lastSync.startedAt) : '-'}
          sub={lastSync ? <Badge>{lastSync.status}</Badge> : null}
        />
      </section>

      {lastSync && lastSync.status !== '성공' && (
        <div className="notice warn">
          <strong>최근 수신 {lastSync.status}</strong> · {lastSync.message}
          {lastSync.message.includes('품목 미등록') && <span className="muted"> — MES 품목 마스터에 없는 품목은 수신하지 않고 연동 모니터링에 남겨요.</span>}
        </div>
      )}

      <section className="toolbar">
        <input className="search" type="search" placeholder={`${t.no} · 품목 · ${t.partner} 검색`} value={quick} onChange={(e) => setQuick(e.target.value)} />
      </section>
      <DataGrid
        height={540}
        rowData={data}
        getRowId={(p) => `${p.data.orderNo}|${p.data.lineNo}`}
        columnDefs={columnDefs}
        quickFilterText={quick}
        pagination
        paginationPageSize={50}
      />
    </>
  )
}
