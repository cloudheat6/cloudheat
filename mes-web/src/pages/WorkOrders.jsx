import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { fmtDate, fmtNum, fmtPct, parseDay } from '../lib/format.js'
import { useToast } from '../lib/toast.jsx'
import { BadgeCell, Chips, ErrorBox, Kpi, PageHeader, useToggleSet } from '../components/ui.jsx'

const LINES = ['L1 프레스', 'L2 용접', 'L3 도장', 'L4 조립']
const STATUSES = ['대기', '진행', '완료', '지연']

const statusOf = (r) => {
  if (r.prodQty >= r.planQty) return '완료'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (r.dueDate < today) return '지연'
  if (r.prodQty === 0) return '대기'
  return '진행'
}

const fromApi = (r) => ({
  id: r.woId,
  woNo: r.woNo,
  dueDate: parseDay(r.dueDate),
  line: r.lineName,
  itemCode: r.itemCode,
  itemName: r.itemName,
  worker: r.workerName,
  planQty: r.planQty,
  prodQty: r.prodQty,
  defectQty: r.defectQty,
  remark: r.remark,
})

function RateCell({ value }) {
  if (value == null) return null
  const tone = value >= 1 ? 'done' : value >= 0.7 ? 'good' : value >= 0.3 ? 'mid' : 'low'
  return (
    <div className="rate">
      <div className="rate-bar">
        <div className={`rate-fill ${tone}`} style={{ width: `${Math.min(1, value) * 100}%` }} />
      </div>
      <span className="rate-text">{fmtPct(value)}</span>
    </div>
  )
}

export default function WorkOrders() {
  const gridRef = useRef(null)
  const notify = useToast()
  const { data, error, reload } = useApi('/work-orders')
  const rowData = useMemo(() => data?.map(fromApi) ?? null, [data])
  const [quick, setQuick] = useState('')
  const [lineFilter, setLineFilter] = useState(() => new Set())
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  const [visible, setVisible] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailVersion, setDetailVersion] = useState(0)

  // 수량 입력 검증 (서버에서도 한 번 더 검증)
  const qtySetter = useCallback(
    (field) => (p) => {
      const v = Number(p.newValue)
      const r = p.data
      if (!Number.isInteger(v) || v < 0) return notify('0 이상의 정수만 입력할 수 있어요'), false
      if (field === 'prodQty' && v > r.planQty * 1.2) return notify(`실적은 계획(${fmtNum(r.planQty)})의 120%를 넘을 수 없어요`), false
      if (field === 'prodQty' && v < r.defectQty) return notify(`실적은 불량(${fmtNum(r.defectQty)})보다 작을 수 없어요`), false
      if (field === 'defectQty' && v > r.prodQty) return notify(`불량은 실적(${fmtNum(r.prodQty)})보다 클 수 없어요`), false
      if (r[field] === v) return false
      r[field] = v
      return true
    },
    [notify],
  )

  const editable = (p) => !p.node.rowPinned
  const editCls = (p) => (p.node.rowPinned ? '' : 'editable')

  const columnDefs = useMemo(
    () => [
      { field: 'woNo', headerName: '작업지시', pinned: 'left', width: 140, cellClass: 'mono strong' },
      { field: 'dueDate', headerName: '납기일', width: 115, filter: 'agDateColumnFilter', valueFormatter: (p) => fmtDate(p.value), cellClass: 'mono' },
      { field: 'line', headerName: '라인', width: 105 },
      { field: 'itemCode', headerName: '품목코드', width: 115, cellClass: 'mono' },
      { field: 'itemName', headerName: '품목명', minWidth: 150, flex: 1 },
      { field: 'worker', headerName: '작업자', width: 90 },
      { field: 'planQty', headerName: '계획', width: 90, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: (p) => fmtNum(p.value) },
      {
        field: 'prodQty', headerName: '실적 ✎', headerTooltip: '더블클릭해서 수정 → 제품 재고 · ERP 생산실적 반영',
        width: 95, type: 'rightAligned', filter: 'agNumberColumnFilter', editable, cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0 }, valueSetter: qtySetter('prodQty'), valueFormatter: (p) => fmtNum(p.value), cellClass: editCls,
      },
      {
        field: 'defectQty', headerName: '불량 ✎', headerTooltip: '더블클릭해서 수정',
        width: 88, type: 'rightAligned', filter: 'agNumberColumnFilter', editable, cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0 }, valueSetter: qtySetter('defectQty'), valueFormatter: (p) => fmtNum(p.value), cellClass: editCls,
      },
      { colId: 'rate', headerName: '달성률', width: 140, filter: 'agNumberColumnFilter', valueGetter: (p) => (p.data.planQty ? p.data.prodQty / p.data.planQty : null), cellRenderer: RateCell },
      {
        colId: 'defectRate', headerName: '불량률', width: 88, type: 'rightAligned', filter: 'agNumberColumnFilter',
        valueGetter: (p) => (p.data.prodQty ? p.data.defectQty / p.data.prodQty : null), valueFormatter: (p) => fmtPct(p.value),
        cellClassRules: { 'warn-text': (p) => !p.node.rowPinned && p.value >= 0.03 },
      },
      { colId: 'status', headerName: '상태', width: 85, valueGetter: (p) => (p.node.rowPinned ? null : statusOf(p.data)), cellRenderer: BadgeCell },
      { field: 'remark', headerName: '비고 ✎', minWidth: 140, flex: 1, editable, cellClass: editCls },
    ],
    [qtySetter],
  )

  // 외부 필터 (라인 · 상태 칩)
  const filterRef = useRef({ lineFilter, statusFilter })
  filterRef.current = { lineFilter, statusFilter }
  const isExternalFilterPresent = useCallback(() => filterRef.current.lineFilter.size > 0 || filterRef.current.statusFilter.size > 0, [])
  const doesExternalFilterPass = useCallback((node) => {
    const { lineFilter: lf, statusFilter: sf } = filterRef.current
    if (lf.size && !lf.has(node.data.line)) return false
    if (sf.size && !sf.has(statusOf(node.data))) return false
    return true
  }, [])
  useEffect(() => gridRef.current?.api?.onFilterChanged(), [lineFilter, statusFilter])

  const collect = useCallback(() => {
    const rows = []
    gridRef.current?.api?.forEachNodeAfterFilterAndSort((n) => n.data && rows.push(n.data))
    setVisible(rows)
  }, [])

  const kpi = useMemo(() => {
    const sum = (f) => visible.reduce((s, r) => s + r[f], 0)
    const plan = sum('planQty')
    const prod = sum('prodQty')
    const defect = sum('defectQty')
    return {
      count: visible.length, plan, prod, defect,
      rate: plan ? prod / plan : 0, defectRate: prod ? defect / prod : 0,
      delayed: visible.filter((r) => statusOf(r) === '지연').length,
    }
  }, [visible])

  const pinnedBottomRowData = useMemo(
    () => [{ id: `t-${kpi.count}-${kpi.prod}-${kpi.defect}`, woNo: `합계 ${fmtNum(kpi.count)}건`, planQty: kpi.plan, prodQty: kpi.prod, defectQty: kpi.defect }],
    [kpi],
  )

  const onCellValueChanged = useCallback(
    async (e) => {
      const field = e.colDef.field
      collect()
      try {
        const res = await api(`/work-orders/${e.data.id}`, { method: 'PATCH', body: { [field]: e.newValue } })
        setDetailVersion((v) => v + 1)
        notify(res?.docNo ? `${e.data.woNo} 저장 · 생산실적 ${res.docNo} ERP 전송 대기` : `${e.data.woNo} 저장됨`, 'ok')
      } catch (err) {
        e.data[field] = e.oldValue
        e.api.refreshCells({ rowNodes: [e.node], force: true })
        collect()
        notify(err.message)
      }
    },
    [collect, notify],
  )

  useEffect(() => {
    if (!selected) return setDetail(null)
    let alive = true
    api(`/work-orders/${selected.id}/detail`)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ error: true, process: [], defects: [] }))
    return () => (alive = false)
  }, [selected, detailVersion])

  // 패널을 닫으면 행 선택도 해제 (행을 다시 그리지 않아 셀 포커스 · Ctrl+C 가 유지됨)
  useEffect(() => {
    if (!selected) gridRef.current?.api?.deselectAll()
  }, [selected])

  const toggleLine = useToggleSet(setLineFilter)
  const toggleStatus = useToggleSet(setStatusFilter)

  return (
    <>
      <PageHeader
        title="작업지시관리"
        desc="실적·불량을 수정하면 양품 증감만큼 제품창고 재고가 바뀌고, ERP로 보낼 생산실적이 송신 대기열에 쌓여요."
      >
        <Link className="btn ghost" to="/integration">
          ERP 송신 현황 →
        </Link>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />

      <section className="kpis">
        <Kpi label="작업지시" value={`${fmtNum(kpi.count)}건`} />
        <Kpi label="계획 수량" value={fmtNum(kpi.plan)} />
        <Kpi label="실적 수량" value={fmtNum(kpi.prod)} />
        <Kpi label="달성률" value={fmtPct(kpi.rate)} tone={kpi.rate >= 0.8 ? 'ok' : 'warn'} />
        <Kpi label="불량률" value={fmtPct(kpi.defectRate)} tone={kpi.defectRate >= 0.02 ? 'warn' : 'ok'} />
        <Kpi label="납기 지연" value={`${fmtNum(kpi.delayed)}건`} tone={kpi.delayed ? 'bad' : 'ok'} />
      </section>

      <section className="toolbar">
        <input className="search" type="search" placeholder="지시번호 · 품목 · 작업자 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <Chips label="라인" options={LINES} value={lineFilter} onToggle={toggleLine} />
        <Chips label="상태" options={STATUSES} value={statusFilter} onToggle={toggleStatus} />
        <div className="toolbar-actions">
          <button
            className="btn ghost"
            onClick={() => {
              setQuick('')
              setLineFilter(new Set())
              setStatusFilter(new Set())
              gridRef.current?.api?.setFilterModel(null)
            }}
          >
            필터 초기화
          </button>
          <button
            className="btn"
            onClick={() =>
              gridRef.current?.api?.exportDataAsCsv({
                fileName: `작업지시_${fmtDate(new Date())}.csv`,
                processCellCallback: (p) => (p.value instanceof Date ? fmtDate(p.value) : p.value),
                skipPinnedBottom: true,
              })
            }
          >
            CSV
          </button>
        </div>
      </section>

      <div className={`split ${selected ? 'with-side' : ''}`}>
        <DataGrid
          gridRef={gridRef}
          height={600}
          rowData={rowData}
          getRowId={(p) => String(p.data.id)}
          columnDefs={columnDefs}
          quickFilterText={quick}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          pinnedBottomRowData={pinnedBottomRowData}
          pagination
          paginationPageSize={50}
          paginationPageSizeSelector={[20, 50, 100]}
          stopEditingWhenCellsLoseFocus
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onGridReady={collect}
          onRowDataUpdated={collect}
          onFilterChanged={collect}
          onSortChanged={collect}
          onCellValueChanged={onCellValueChanged}
          onRowClicked={(e) => !e.node.rowPinned && setSelected(e.data)}
        />

        {selected && (
          <aside className="side-panel" aria-label="작업지시 상세">
            <div className="side-head">
              <div>
                <div className="mono strong">{selected.woNo}</div>
                <div className="muted small">
                  {selected.itemName} · {selected.line} · 납기 {fmtDate(selected.dueDate)}
                </div>
              </div>
              <button className="icon-btn" aria-label="닫기" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {!detail ? (
              <p className="muted small">불러오는 중…</p>
            ) : detail.error ? (
              <p className="muted small">상세 정보를 불러오지 못했어요</p>
            ) : (
              <>
                <h3>공정별 실적</h3>
                <table className="mini">
                  <thead>
                    <tr>
                      <th>공정</th>
                      <th>투입</th>
                      <th>양품</th>
                      <th>손실</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.process.map((s) => (
                      <tr key={s.seq}>
                        <td>{s.stepName}</td>
                        <td>{fmtNum(s.inQty)}</td>
                        <td>{fmtNum(s.outQty)}</td>
                        <td className={s.lossQty ? 'warn-text' : 'muted'}>{fmtNum(s.lossQty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>불량 유형</h3>
                {detail.defects.length === 0 ? (
                  <p className="muted small">불량 없음</p>
                ) : (
                  <ul className="bars">
                    {detail.defects.map((d) => (
                      <li key={d.defectName}>
                        <span>{d.defectName}</span>
                        <span className="bar">
                          <span style={{ width: `${(d.qty / selected.defectQty) * 100}%` }} />
                        </span>
                        <span className="mono">{fmtNum(d.qty)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted small side-note">공정별 손실 · 불량 유형은 PostgreSQL 함수(윈도 함수)로 계산돼요.</p>
              </>
            )}
          </aside>
        )}
      </div>
    </>
  )
}
