import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { fmtDateTime, fmtNum } from '../lib/format.js'
import { useToast } from '../lib/toast.jsx'
import { Badge, BadgeCell, ErrorBox, Kpi, PageHeader } from '../components/ui.jsx'

// 기초재고: 시스템을 처음 쓸 때 창고별 품목 재고를 등록.
// 입고 · 생산 · 출고 같은 수불이 한 번이라도 생긴 품목은 잠기고, 그 뒤 차이는 재고조정으로 맞춤
export default function Opening() {
  const notify = useToast()
  const gridRef = useRef(null)
  const whs = useApi('/master/warehouses')
  const [wh, setWh] = useState(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [edits, setEdits] = useState(() => new Map())
  const [onlyDefault, setOnlyDefault] = useState(true)
  const [quick, setQuick] = useState('')
  const [busy, setBusy] = useState(false)

  const warehouses = (whs.data ?? []).filter((w) => w.useYn)
  const current = warehouses.find((w) => w.whCode === wh)

  useEffect(() => {
    if (!wh && warehouses.length) setWh(warehouses[0].whCode)
  }, [wh, warehouses])

  const load = useCallback(async () => {
    if (!wh) return
    try {
      setRows(await api(`/inventory/opening/${encodeURIComponent(wh)}`))
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [wh])

  useEffect(() => {
    setRows(null)
    setEdits(new Map())
    load()
  }, [load])

  const pickWh = (code) => {
    if (code === wh) return
    if (edits.size && !window.confirm('저장하지 않은 변경이 있어요. 버릴까요?')) return
    setWh(code)
  }

  const editsRef = useRef(edits)
  editsRef.current = edits

  const columnDefs = useMemo(
    () => [
      { field: 'itemType', headerName: '구분', width: 90, cellRenderer: BadgeCell },
      { field: 'itemCode', headerName: '품목코드', width: 125, cellClass: 'mono strong' },
      { field: 'itemName', headerName: '품목명', flex: 1, minWidth: 170 },
      { field: 'unit', headerName: '단위', width: 70 },
      {
        colId: 'qty', headerName: '기초재고', width: 130, type: 'rightAligned', filter: 'agNumberColumnFilter',
        editable: (p) => p.data.otherTxCount === 0,
        cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 0, precision: 0 },
        valueGetter: (p) => (editsRef.current.has(p.data.itemCode) ? editsRef.current.get(p.data.itemCode) : p.data.openingQty),
        valueSetter: (p) => {
          const v = p.newValue == null || p.newValue === '' ? 0 : Math.round(Number(p.newValue))
          if (!Number.isFinite(v) || v < 0) return false
          setEdits((prev) => {
            const next = new Map(prev)
            v === p.data.openingQty ? next.delete(p.data.itemCode) : next.set(p.data.itemCode, v)
            return next
          })
          return true
        },
        valueFormatter: (p) => fmtNum(p.value),
        cellClass: (p) => (p.data.otherTxCount === 0 ? 'editable strong' : 'strong'),
        cellClassRules: { 'cell-changed': (p) => editsRef.current.has(p.data.itemCode) },
      },
      { field: 'stockQty', headerName: '현재고', width: 110, type: 'rightAligned', valueFormatter: (p) => fmtNum(p.value) },
      {
        colId: 'state', headerName: '상태', width: 120, filter: false,
        valueGetter: (p) => (p.data.otherTxCount > 0 ? '잠김' : p.data.openedAt ? '등록됨' : '미등록'),
        cellRenderer: (p) => (
          <span title={p.data.otherTxCount > 0 ? `기초 외 수불 ${p.data.otherTxCount}건 → 재고조정으로 맞추세요` : undefined}>
            <Badge tone={p.value === '잠김' ? 'warn' : p.value === '등록됨' ? 'ok' : 'muted'}>{p.value}</Badge>
          </span>
        ),
      },
      { field: 'openedAt', headerName: '등록 일시', width: 130, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono muted', filter: false },
      {
        colId: 'tx', headerName: '', width: 90, sortable: false, filter: false,
        cellRenderer: (p) => (p.data.openedAt ? <Link className="link" to={`/inventory/transactions?item=${p.data.itemCode}`}>재고수불</Link> : null),
      },
    ],
    [],
  )

  // 편집 내용이 바뀌면 기초재고 칸만 다시 그림
  useEffect(() => {
    gridRef.current?.api?.refreshCells({ columns: ['qty'], force: true })
  }, [edits])

  const filterRef = useRef(onlyDefault)
  filterRef.current = onlyDefault
  const isExternalFilterPresent = useCallback(() => filterRef.current, [])
  const doesExternalFilterPass = useCallback((n) => n.data.isDefaultWh || n.data.openingQty !== 0 || n.data.stockQty !== 0, [])
  useEffect(() => gridRef.current?.api?.onFilterChanged(), [onlyDefault])

  const save = async () => {
    setBusy(true)
    try {
      const body = [...edits].map(([itemCode, qty]) => ({ itemCode, qty }))
      const res = await api(`/inventory/opening/${encodeURIComponent(wh)}`, { method: 'PUT', body })
      notify(`${current?.whName ?? wh} 기초재고 ${res.changed}건 저장됨`, 'ok')
      setEdits(new Map())
      await load()
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
    }
  }

  const list = rows ?? []
  const registered = list.filter((r) => r.openedAt).length
  const locked = list.filter((r) => r.otherTxCount > 0).length
  const total = list.reduce((s, r) => s + (edits.has(r.itemCode) ? edits.get(r.itemCode) : r.openingQty), 0)

  return (
    <>
      <PageHeader
        title="기초재고관리"
        desc="시스템을 처음 쓰기 시작할 때 창고별 품목 재고를 등록해요. 입고 · 생산 · 출고 등 수불이 생긴 품목은 잠기고, 그 뒤 차이는 재고조정으로 맞춰요."
      >
        <button className="btn ghost" disabled={!edits.size || busy} onClick={() => setEdits(new Map())}>
          되돌리기
        </button>
        <button className="btn" disabled={!edits.size || busy} onClick={save}>
          저장{edits.size ? ` (${edits.size})` : ''}
        </button>
      </PageHeader>
      <ErrorBox error={whs.error || error} onRetry={whs.error ? whs.reload : load} />

      <div className="tabs" role="tablist" aria-label="창고">
        {warehouses.map((w) => (
          <button key={w.whCode} role="tab" aria-selected={w.whCode === wh} className={`tab ${w.whCode === wh ? 'on' : ''}`} onClick={() => pickWh(w.whCode)}>
            {w.whName}
            <span className="muted small"> {w.whType}</span>
          </button>
        ))}
      </div>

      <section className="kpis">
        <Kpi label="등록 품목" value={`${registered}건`} sub={`표시 ${list.length}개 품목 중`} />
        <Kpi label="기초재고 합계" value={fmtNum(total)} sub={edits.size ? '저장 전 값 포함' : current?.whName} />
        <Kpi label="잠긴 품목" value={`${locked}건`} tone={locked ? 'warn' : 'ok'} sub="수불 발생 → 재고조정" />
        <Kpi label="저장 안 한 변경" value={`${edits.size}건`} tone={edits.size ? 'warn' : undefined} />
      </section>

      <section className="toolbar">
        <input className="search" type="search" placeholder="품목 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyDefault} onChange={(e) => setOnlyDefault(e.target.checked)} />
          기본 창고가 여기인 품목만
        </label>
        <span className="muted small toolbar-actions">기초재고 칸을 눌러 수량을 입력하세요</span>
      </section>

      <DataGrid
        gridRef={gridRef}
        height={520}
        rowData={rows}
        getRowId={(p) => p.data.itemCode}
        columnDefs={columnDefs}
        quickFilterText={quick}
        isExternalFilterPresent={isExternalFilterPresent}
        doesExternalFilterPass={doesExternalFilterPass}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        overlayNoRowsTemplate="표시할 품목이 없어요"
      />
    </>
  )
}
