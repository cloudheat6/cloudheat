import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { fmtDate, fmtNum, fmtPct, parseDay } from '../lib/format.js'
import { useToast } from '../lib/toast.jsx'
import { Badge, BadgeCell, Chips, ErrorBox, Kpi, PageHeader, useToggleSet } from '../components/ui.jsx'

const STATUSES = ['대기', '진행', '완료', '지연', '취소']

const addDays = (days = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return fmtDate(d)
}

const statusOf = (r) => {
  if (r.woStatus === '취소') return '취소'
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
  woDateStr: r.woDate,
  dueDateStr: r.dueDate,
  woDate: parseDay(r.woDate),
  dueDate: parseDay(r.dueDate),
  lineId: r.lineId,
  line: r.lineName,
  itemCode: r.itemCode,
  itemName: r.itemName,
  unit: r.unit,
  workerId: r.workerId,
  worker: r.workerName,
  soNo: r.soNo ?? '',
  woStatus: r.woStatus,
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
  const items = useApi('/master/items')
  const lines = useApi('/master/lines')
  const workers = useApi('/master/workers')
  const salesOrders = useApi('/orders/sales')

  const rowData = useMemo(() => data?.map(fromApi) ?? null, [data])
  const [quick, setQuick] = useState('')
  const [lineFilter, setLineFilter] = useState(() => new Set())
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  const [visible, setVisible] = useState([])
  const [form, setForm] = useState(null) // null: 닫힘, { id: number|null, ... }
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailVersion, setDetailVersion] = useState(0)

  const productItems = useMemo(() => (items.data ?? []).filter((i) => i.itemType === '제품' && i.useYn), [items.data])
  const activeLines = useMemo(() => (lines.data ?? []).filter((l) => l.useYn), [lines.data])
  const lineOptions = useMemo(() => (lines.data ?? []).map((l) => l.lineName), [lines.data])
  const workerList = workers.data ?? []
  const openSalesLines = useMemo(
    () => (salesOrders.data ?? []).filter((o) => o.erpStatus === '확정' && o.orderQty > o.doneQty),
    [salesOrders.data],
  )
  const byItem = useMemo(() => Object.fromEntries((items.data ?? []).map((i) => [i.itemCode, i])), [items.data])

  const openNew = () => {
    const firstItem = productItems[0]
    const defaultLine = firstItem?.lineId ?? activeLines[0]?.lineId ?? ''
    setForm({
      id: null,
      woNo: null,
      woStatus: '확정',
      prodQty: 0,
      defectQty: 0,
      soKey: '',
      soNo: '',
      itemCode: firstItem?.itemCode ?? '',
      lineId: defaultLine === '' ? '' : String(defaultLine),
      workerId: workerList[0]?.workerId ? String(workerList[0].workerId) : '',
      woDate: addDays(0),
      dueDate: addDays(7),
      planQty: '',
      remark: '',
    })
  }

  const openEdit = useCallback((r) => {
    setForm({
      id: r.id,
      woNo: r.woNo,
      woStatus: r.woStatus,
      prodQty: r.prodQty,
      defectQty: r.defectQty,
      soKey: '',
      soNo: r.soNo ?? '',
      itemCode: r.itemCode,
      lineId: r.lineId == null ? '' : String(r.lineId),
      workerId: String(r.workerId),
      woDate: r.woDateStr,
      dueDate: r.dueDateStr,
      planQty: String(r.planQty),
      remark: r.remark ?? '',
    })
  }, [])

  const pickSalesLine = (key) => {
    if (!key) {
      setForm((f) => ({ ...f, soKey: '', soNo: '' }))
      return
    }
    const found = openSalesLines.find((o) => `${o.orderNo}|${o.lineNo}` === key)
    if (!found) return
    const item = byItem[found.itemCode]
    const remain = Math.max(1, found.orderQty - found.doneQty)
    setForm((f) => ({
      ...f,
      soKey: key,
      soNo: found.orderNo,
      itemCode: found.itemCode,
      lineId: item?.lineId != null ? String(item.lineId) : f.lineId,
      dueDate: found.dueDate >= f.woDate ? found.dueDate : f.woDate,
      planQty: String(remain),
    }))
  }

  const pickItem = (itemCode) => {
    const item = byItem[itemCode]
    setForm((f) => ({
      ...f,
      itemCode,
      lineId: item?.lineId != null ? String(item.lineId) : f.lineId,
    }))
  }

  const saveForm = async (e) => {
    e.preventDefault()
    if (!form.itemCode) return notify('제품 품목을 선택하세요')
    if (!form.workerId) return notify('담당 작업자를 선택하세요')
    if (!(Number(form.planQty) > 0)) return notify('지시수량을 1 이상으로 입력하세요')

    const body = {
      itemCode: form.itemCode,
      lineId: form.lineId === '' ? null : Number(form.lineId),
      workerId: Number(form.workerId),
      woDate: form.woDate,
      dueDate: form.dueDate,
      planQty: Math.round(Number(form.planQty)),
      soNo: form.soNo || null,
      remark: form.remark,
    }
    setBusy(true)
    try {
      if (form.id) {
        const updated = await api(`/work-orders/${form.id}`, { method: 'PUT', body })
        notify(`${updated.woNo} 작업지시 수정됨`, 'ok')
        openEdit(fromApi(updated))
      } else {
        const created = await api('/work-orders', { method: 'POST', body })
        notify(`${created.woNo} 작업지시 등록됨`, 'ok')
        openEdit(fromApi(created))
      }
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const cancelWo = async () => {
    if (!form?.id) return
    if (!window.confirm(`${form.woNo} 작업지시를 취소할까요?`)) return
    setBusy(true)
    try {
      await api(`/work-orders/${form.id}/cancel`, { method: 'POST' })
      notify(`${form.woNo} 작업지시 취소됨`, 'ok')
      setForm(null)
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

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

  const editable = (p) => !p.node.rowPinned && p.data.woStatus === '확정'
  const editCls = (p) => (p.node.rowPinned || p.data.woStatus !== '확정' ? '' : 'editable')

  const columnDefs = useMemo(
    () => [
      { field: 'woNo', headerName: '작업지시번호', pinned: 'left', width: 140, cellClass: 'mono strong' },
      { field: 'woDate', headerName: '지시일', width: 110, valueFormatter: (p) => fmtDate(p.value), cellClass: 'mono' },
      { field: 'dueDate', headerName: '납기일', width: 110, filter: 'agDateColumnFilter', valueFormatter: (p) => fmtDate(p.value), cellClass: 'mono' },
      { field: 'soNo', headerName: '주문번호', width: 130, cellClass: 'mono muted' },
      { field: 'line', headerName: '라인', width: 105 },
      { field: 'itemCode', headerName: '품목코드', width: 115, cellClass: 'mono' },
      { field: 'itemName', headerName: '품목명', minWidth: 150, flex: 1 },
      { field: 'worker', headerName: '작업자', width: 90 },
      { field: 'planQty', headerName: '지시수량', width: 95, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: (p) => fmtNum(p.value), cellClass: 'strong' },
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
      { colId: 'rate', headerName: '달성률', width: 135, filter: 'agNumberColumnFilter', valueGetter: (p) => (p.data.planQty ? p.data.prodQty / p.data.planQty : null), cellRenderer: RateCell },
      { colId: 'status', headerName: '상태', width: 85, valueGetter: (p) => (p.node.rowPinned ? null : statusOf(p.data)), cellRenderer: BadgeCell },
      { field: 'remark', headerName: '비고', minWidth: 140, flex: 1 },
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
    const active = visible.filter((r) => r.woStatus !== '취소')
    const sum = (f) => active.reduce((s, r) => s + r[f], 0)
    const plan = sum('planQty')
    const prod = sum('prodQty')
    const defect = sum('defectQty')
    return {
      count: active.length, plan, prod, defect,
      rate: plan ? prod / plan : 0, defectRate: prod ? defect / prod : 0,
      delayed: active.filter((r) => statusOf(r) === '지연').length,
    }
  }, [visible])

  const pinnedBottomRowData = useMemo(
    () => [{ id: `t-${kpi.count}-${kpi.plan}-${kpi.prod}-${kpi.defect}`, woNo: `합계 ${fmtNum(kpi.count)}건`, woStatus: '합계', planQty: kpi.plan, prodQty: kpi.prod, defectQty: kpi.defect }],
    [kpi],
  )

  const onCellValueChanged = useCallback(
    async (e) => {
      const field = e.colDef.field
      collect()
      try {
        const res = await api(`/work-orders/${e.data.id}`, { method: 'PATCH', body: { [field]: e.newValue } })
        setDetailVersion((v) => v + 1)
        if (form?.id === e.data.id && res?.row) openEdit(fromApi(res.row))
        notify(res?.docNo ? `${e.data.woNo} 저장 · 생산실적 ${res.docNo} ERP 전송 대기` : `${e.data.woNo} 저장됨`, 'ok')
      } catch (err) {
        e.data[field] = e.oldValue
        e.api.refreshCells({ rowNodes: [e.node], force: true })
        collect()
        notify(err.message)
      }
    },
    [collect, form?.id, notify, openEdit],
  )

  useEffect(() => {
    if (!form?.id) return setDetail(null)
    let alive = true
    api(`/work-orders/${form.id}/detail`)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ error: true, process: [], defects: [] }))
    return () => (alive = false)
  }, [form?.id, detailVersion])

  useEffect(() => {
    if (!form) gridRef.current?.api?.deselectAll()
  }, [form])

  const toggleLine = useToggleSet(setLineFilter)
  const toggleStatus = useToggleSet(setStatusFilter)
  const readOnly = form && form.woStatus !== '확정'
  const selectedUnit = form ? byItem[form.itemCode]?.unit ?? 'EA' : 'EA'

  return (
    <>
      <PageHeader
        title="작업지시관리"
        desc="제품 · 라인 · 작업자 · 납기일을 지정해 작업지시를 직접 등록 · 수정 · 취소해요. 수신된 주문을 연결하거나 계획생산으로 지시를 내릴 수 있어요."
      >
        <Link className="btn ghost" to="/integration">
          ERP 송신 현황 →
        </Link>
        <button className="btn" onClick={openNew} disabled={!items.data || !workers.data}>
          + 새 작업지시
        </button>
      </PageHeader>
      <ErrorBox error={error || items.error || workers.error} onRetry={reload} />

      <section className="kpis">
        <Kpi label="진행 · 대기 지시" value={`${fmtNum(kpi.count)}건`} />
        <Kpi label="지시 수량" value={fmtNum(kpi.plan)} />
        <Kpi label="실적 수량" value={fmtNum(kpi.prod)} />
        <Kpi label="달성률" value={fmtPct(kpi.rate)} tone={kpi.rate >= 0.8 ? 'ok' : 'warn'} />
        <Kpi label="불량률" value={fmtPct(kpi.defectRate)} tone={kpi.defectRate >= 0.02 ? 'warn' : 'ok'} />
        <Kpi label="납기 지연" value={`${fmtNum(kpi.delayed)}건`} tone={kpi.delayed ? 'bad' : 'ok'} />
      </section>

      <section className="toolbar">
        <input className="search" type="search" placeholder="지시번호 · 주문번호 · 품목 · 작업자 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        {lineOptions.length > 0 && <Chips label="라인" options={lineOptions} value={lineFilter} onToggle={toggleLine} />}
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
            className="btn ghost"
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

      <div className={`split ${form ? 'with-side' : ''}`}>
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
          onRowClicked={(e) => !e.node.rowPinned && openEdit(e.data)}
          overlayNoRowsTemplate="아직 작업지시가 없어요. 오른쪽 위 '+ 새 작업지시' 버튼으로 등록해 보세요."
        />

        {form && (
          <aside className="side-panel wo-panel" aria-label="작업지시 등록 및 상세">
            <div className="side-head">
              <div>
                <div className="mono strong">{form.woNo ?? '새 작업지시 등록'}</div>
                <div className="muted small">
                  {form.id ? (
                    <>
                      상태 <Badge>{form.woStatus}</Badge> · 실적 {fmtNum(form.prodQty)}
                    </>
                  ) : (
                    '저장하면 WO-YYMM-0001 형식으로 채번돼요'
                  )}
                </div>
              </div>
              <button className="icon-btn" aria-label="닫기" onClick={() => setForm(null)}>
                ×
              </button>
            </div>

            <form className="wo-form" onSubmit={saveForm}>
              <fieldset disabled={readOnly || busy} className="wo-fields">
                {!form.id && (
                  <label className="wide">
                    <span>연결 주문 (선택)</span>
                    <select value={form.soKey} onChange={(e) => pickSalesLine(e.target.value)}>
                      <option value="">(연결 안 함 · 계획생산)</option>
                      {openSalesLines.map((o) => {
                        const key = `${o.orderNo}|${o.lineNo}`
                        const remain = o.orderQty - o.doneQty
                        return (
                          <option key={key} value={key}>
                            {o.orderNo} #{o.lineNo} · {o.partnerName} · {o.itemName} (잔량 {fmtNum(remain)})
                          </option>
                        )
                      })}
                    </select>
                  </label>
                )}

                {form.id && form.soNo && (
                  <label className="wide">
                    <span>연결 주문번호</span>
                    <input value={form.soNo} disabled />
                  </label>
                )}

                <label className="wide">
                  <span>제품 품목</span>
                  <select value={form.itemCode} disabled={form.prodQty > 0} onChange={(e) => pickItem(e.target.value)} required>
                    {!form.itemCode && <option value="">품목 선택</option>}
                    {productItems.map((it) => (
                      <option key={it.itemCode} value={it.itemCode}>
                        {it.itemCode} · {it.itemName}
                      </option>
                    ))}
                    {form.itemCode && !productItems.some((it) => it.itemCode === form.itemCode) && (
                      <option value={form.itemCode}>{form.itemCode}</option>
                    )}
                  </select>
                </label>

                <label>
                  <span>생산 라인</span>
                  <select value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })}>
                    <option value="">(미지정)</option>
                    {activeLines.map((l) => (
                      <option key={l.lineId} value={String(l.lineId)}>
                        {l.lineName}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>담당 작업자</span>
                  <select value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })} required>
                    {workerList.map((w) => (
                      <option key={w.workerId} value={String(w.workerId)}>
                        {w.workerName}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>지시일</span>
                  <input type="date" value={form.woDate} onChange={(e) => setForm({ ...form, woDate: e.target.value })} required />
                </label>

                <label>
                  <span>납기일</span>
                  <input type="date" value={form.dueDate} min={form.woDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required />
                </label>

                <label className="wide">
                  <span>지시수량 ({selectedUnit})</span>
                  <input
                    type="number"
                    min={Math.max(1, form.prodQty)}
                    step="1"
                    placeholder="수량 입력"
                    value={form.planQty}
                    onChange={(e) => setForm({ ...form, planQty: e.target.value })}
                    required
                  />
                </label>

                <label className="wide">
                  <span>비고</span>
                  <input type="text" maxLength={200} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
                </label>
              </fieldset>

              <div className="wo-actions">
                {form.id && !readOnly && form.prodQty === 0 && (
                  <button type="button" className="btn ghost" disabled={busy} onClick={cancelWo}>
                    지시 취소
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setForm(null)}>
                  닫기
                </button>
                {!readOnly && (
                  <button type="submit" className="btn" disabled={busy}>
                    {form.id ? '수정 저장' : '작업지시 등록'}
                  </button>
                )}
              </div>
            </form>

            {form.id && detail && !detail.error && (
              <div className="wo-detail">
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
                          <span style={{ width: `${form.defectQty ? (d.qty / form.defectQty) * 100 : 0}%` }} />
                        </span>
                        <span className="mono">{fmtNum(d.qty)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  )
}
