import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { ago, fmtNum } from '../lib/format.js'
import { BadgeCell, Chips, ErrorBox, Kpi, PageHeader, useToggleSet } from '../components/ui.jsx'

export default function Stock() {
  const gridRef = useRef(null)
  const { data, error, reload } = useApi('/inventory/stock', { refreshMs: 10000 })
  const [quick, setQuick] = useState('')
  const [whFilter, setWhFilter] = useState(() => new Set())
  const [visible, setVisible] = useState([])

  const warehouses = useMemo(() => [...new Set((data ?? []).map((r) => r.whName))], [data])

  const columnDefs = useMemo(
    () => [
      { field: 'itemType', headerName: '구분', width: 95, cellRenderer: BadgeCell },
      { field: 'itemCode', headerName: '품목코드', width: 125, cellClass: 'mono strong' },
      { field: 'itemName', headerName: '품목명', flex: 1, minWidth: 170 },
      { field: 'whName', headerName: '창고', width: 120 },
      {
        field: 'qty', headerName: '현재고', width: 120, type: 'rightAligned', filter: 'agNumberColumnFilter',
        valueFormatter: (p) => fmtNum(p.value), cellClassRules: { 'warn-text': (p) => p.value === 0 }, cellClass: 'strong',
      },
      { field: 'unit', headerName: '단위', width: 75 },
      { field: 'updatedAt', headerName: '최근 변동', width: 120, valueFormatter: (p) => ago(p.value), filter: false },
      {
        colId: 'tx', headerName: '', width: 90, sortable: false, filter: false,
        cellRenderer: (p) => <Link className="link" to={`/inventory/transactions?item=${p.data.itemCode}`}>재고수불</Link>,
      },
    ],
    [],
  )

  const filterRef = useRef(whFilter)
  filterRef.current = whFilter
  const isExternalFilterPresent = useCallback(() => filterRef.current.size > 0, [])
  const doesExternalFilterPass = useCallback((n) => filterRef.current.has(n.data.whName), [])
  useEffect(() => gridRef.current?.api?.onFilterChanged(), [whFilter])

  const collect = useCallback(() => {
    const rows = []
    gridRef.current?.api?.forEachNodeAfterFilter((n) => n.data && rows.push(n.data))
    setVisible(rows)
  }, [])

  const rm = visible.filter((r) => r.itemType === '원자재')
  const fg = visible.filter((r) => r.itemType === '제품')

  return (
    <>
      <PageHeader title="현재고조회" desc="품목 × 창고별 현재고예요. 모든 증감은 재고수불에 남고, 마이너스 재고는 DB 함수에서 막아요." />
      <ErrorBox error={error} onRetry={reload} />
      <section className="kpis">
        <Kpi label="재고 품목" value={`${fmtNum(visible.length)}건`} />
        <Kpi label="원자재 수량" value={fmtNum(rm.reduce((s, r) => s + r.qty, 0))} sub={`${rm.length}개 품목`} />
        <Kpi label="제품 수량" value={fmtNum(fg.reduce((s, r) => s + r.qty, 0))} sub={`${fg.length}개 품목`} />
        <Kpi label="재고 0" value={`${visible.filter((r) => r.qty === 0).length}건`} tone={visible.some((r) => r.qty === 0) ? 'warn' : 'ok'} />
      </section>
      <section className="toolbar">
        <input className="search" type="search" placeholder="품목 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <Chips label="창고" options={warehouses} value={whFilter} onToggle={useToggleSet(setWhFilter)} />
      </section>
      <DataGrid
        gridRef={gridRef}
        height={560}
        rowData={data}
        getRowId={(p) => `${p.data.itemCode}|${p.data.whCode}`}
        columnDefs={columnDefs}
        quickFilterText={quick}
        isExternalFilterPresent={isExternalFilterPresent}
        doesExternalFilterPass={doesExternalFilterPass}
        onRowDataUpdated={collect}
        onFilterChanged={collect}
      />
    </>
  )
}
