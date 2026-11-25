import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { fmtDateTime, fmtSigned } from '../lib/format.js'
import { BadgeCell, ErrorBox, PageHeader } from '../components/ui.jsx'

export default function StockTx() {
  const [params, setParams] = useSearchParams()
  const item = params.get('item')
  const { data, error, reload } = useApi(`/inventory/transactions?limit=1000${item ? `&itemCode=${encodeURIComponent(item)}` : ''}`, { refreshMs: 10000 })
  const [quick, setQuick] = useState('')

  const columnDefs = useMemo(
    () => [
      { field: 'txId', headerName: 'No', width: 80, type: 'rightAligned', cellClass: 'mono muted' },
      { field: 'txAt', headerName: '일시', width: 130, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono', filter: false },
      { field: 'txType', headerName: '유형', width: 100, cellRenderer: BadgeCell },
      { field: 'itemCode', headerName: '품목코드', width: 120, cellClass: 'mono' },
      { field: 'itemName', headerName: '품목명', flex: 1, minWidth: 150 },
      { field: 'whName', headerName: '창고', width: 110 },
      {
        field: 'qty', headerName: '증감', width: 100, type: 'rightAligned', filter: 'agNumberColumnFilter',
        valueFormatter: (p) => fmtSigned(p.value), cellClassRules: { 'plus-text': (p) => p.value > 0, 'minus-text': (p) => p.value < 0 },
      },
      { field: 'unit', headerName: '단위', width: 70 },
      { field: 'refType', headerName: '근거', width: 100 },
      { field: 'refNo', headerName: '근거 번호', width: 150, cellClass: 'mono' },
      { field: 'note', headerName: '비고', flex: 1, minWidth: 140 },
    ],
    [],
  )

  return (
    <>
      <PageHeader title="재고수불조회" desc="재고가 바뀐 모든 기록이에요. 현재고는 이 기록의 합계와 항상 같아요.">
        {item && (
          <button className="btn ghost" onClick={() => setParams({})}>
            {item} 필터 해제
          </button>
        )}
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      <section className="toolbar">
        <input className="search" type="search" placeholder="품목 · 근거 번호 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <span className="muted small">최근 1,000건 · 10초마다 갱신</span>
      </section>
      <DataGrid
        height={600}
        rowData={data}
        getRowId={(p) => String(p.data.txId)}
        columnDefs={columnDefs}
        quickFilterText={quick}
        pagination
        paginationPageSize={50}
        paginationPageSizeSelector={[50, 100, 200]}
      />
    </>
  )
}
