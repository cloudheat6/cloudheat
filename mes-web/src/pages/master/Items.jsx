import { useMemo, useState } from 'react'
import { api, useApi } from '../../lib/api.js'
import { useCodes } from '../../lib/codes.js'
import { DataGrid } from '../../lib/grid.jsx'
import { fmtDateTime, fmtNum } from '../../lib/format.js'
import { useToast } from '../../lib/toast.jsx'
import { Badge, Chips, ErrorBox, Kpi, PageHeader, useToggleSet } from '../../components/ui.jsx'

const DEFAULT_TYPES = ['제품', '원자재']

// 품목: 코드 · 이름 · 구분 · 단위는 ERP 값(수정 불가), 나머지는 MES 전용 속성
export default function Items() {
  const notify = useToast()
  const { data, error, reload } = useApi('/master/items')
  const { data: whs } = useApi('/master/warehouses')
  const { data: lines } = useApi('/master/lines')
  const { codesOf, mapOf, reload: reloadCodes } = useCodes()
  const [quick, setQuick] = useState('')
  const [types, setTypes] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const itemTypeMap = mapOf('ITEM_TYPE')
  const itemTypeOptions = useMemo(() => {
    const list = codesOf('ITEM_TYPE').map((c) => c.codeName)
    return list.length ? list : DEFAULT_TYPES
  }, [codesOf])

  const whRef = useMemo(() => ({ '': '(없음)', ...Object.fromEntries((whs ?? []).map((w) => [w.whCode, w.whName])) }), [whs])
  const lineRef = useMemo(() => ({ '': '(없음)', ...Object.fromEntries((lines ?? []).map((l) => [String(l.lineId), l.lineName])) }), [lines])

  const rows = useMemo(
    () =>
      (data ?? [])
        .map((r) => ({
          ...r,
          itemTypeName: itemTypeMap[r.itemType] ?? r.itemType,
          wh: r.defaultWhCode ?? '',
          line: r.lineId == null ? '' : String(r.lineId),
        }))
        .filter((r) => !types.size || types.has(r.itemTypeName)),
    [data, itemTypeMap, types],
  )

  const erpHeader = (name) => ({ headerName: name, headerClass: 'erp-col', headerTooltip: 'ERP 값 (MES에서 수정 불가)' })

  const columnDefs = useMemo(
    () => [
      {
        field: 'itemTypeName',
        ...erpHeader('구분'),
        width: 95,
        cellRenderer: (p) => (p.value ? <Badge tone={p.data.itemType === '제품' ? 'info' : 'muted'}>{p.value}</Badge> : null),
      },
      { field: 'itemCode', ...erpHeader('품목코드'), width: 125, pinned: 'left', cellClass: 'mono strong' },
      { field: 'itemName', ...erpHeader('품목명'), flex: 1, minWidth: 180 },
      { field: 'unit', ...erpHeader('단위'), width: 75 },
      {
        field: 'wh', headerName: '기본 창고 ✎', width: 130, editable: true, refData: whRef,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: Object.keys(whRef) }, cellClass: 'editable',
      },
      {
        field: 'line', headerName: '라인 ✎', width: 120, refData: lineRef,
        editable: (p) => p.data.itemType === '제품', cellClass: (p) => (p.data.itemType === '제품' ? 'editable' : 'muted'),
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: Object.keys(lineRef) },
      },
      {
        field: 'safetyQty', headerName: '안전재고 ✎', width: 110, editable: true, type: 'rightAligned',
        cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 0, precision: 0 }, valueFormatter: (p) => fmtNum(p.value),
        valueParser: (p) => Math.max(0, Math.round(Number(p.newValue) || 0)), cellClass: 'editable',
      },
      { field: 'useYn', headerName: '사용 ✎', width: 85, editable: true, cellDataType: 'boolean' },
      { field: 'routingCount', headerName: '라우팅', width: 90, type: 'rightAligned', valueFormatter: (p) => (p.data.itemType === '제품' ? `${p.value}공정` : '-') },
      { field: 'bomCount', headerName: 'BOM', width: 85, type: 'rightAligned', valueFormatter: (p) => (p.data.itemType === '제품' ? `${p.value}개` : '-') },
      { field: 'erpSyncedAt', headerName: 'ERP 수신', width: 130, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono muted', filter: false },
    ],
    [whRef, lineRef],
  )

  const onCellValueChanged = async (e) => {
    const r = e.data
    try {
      await api(`/master/items/${encodeURIComponent(r.itemCode)}`, {
        method: 'PUT',
        body: { defaultWhCode: r.wh || null, lineId: r.line === '' ? null : Number(r.line), safetyQty: r.safetyQty, useYn: r.useYn },
      })
      notify(`${r.itemCode} 저장됨`, 'ok')
    } catch (err) {
      r[e.colDef.field] = e.oldValue
      e.api.refreshCells({ rowNodes: [e.node], force: true })
      notify(err.message)
    }
  }

  const sync = async () => {
    setBusy(true)
    try {
      const logs = await api('/master/sync', { method: 'POST' })
      const failed = logs.some((l) => l.status === '실패')
      notify(`ERP 수신: ${logs.map((l) => `${l.kind} ${l.status}${l.applied ? ` ${l.applied}건` : ''}`).join(', ')}`, failed ? 'error' : 'ok')
      reload()
      reloadCodes()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const all = data ?? []
  return (
    <>
      <PageHeader
        title="품목관리"
        desc="품목은 ERP가 원본이에요. 코드 · 이름 · 구분 · 단위는 ERP에서 1분마다 받아오고, MES에서는 기본 창고 · 라인 · 안전재고 · 사용 여부만 관리해요."
      >
        <button className="btn ghost" disabled={busy} onClick={sync}>
          ERP에서 지금 수신
        </button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      <section className="kpis">
        <Kpi label="품목" value={`${fmtNum(all.length)}개`} />
        <Kpi label="제품" value={`${all.filter((r) => r.itemType === '제품').length}개`} />
        <Kpi label="원자재" value={`${all.filter((r) => r.itemType === '원자재').length}개`} />
        <Kpi
          label="라우팅 없는 제품"
          value={`${all.filter((r) => r.itemType === '제품' && !r.routingCount).length}개`}
          tone={all.some((r) => r.itemType === '제품' && !r.routingCount) ? 'warn' : 'ok'}
        />
        <Kpi
          label="BOM 없는 제품"
          value={`${all.filter((r) => r.itemType === '제품' && !r.bomCount).length}개`}
          tone={all.some((r) => r.itemType === '제품' && !r.bomCount) ? 'warn' : 'ok'}
        />
      </section>
      <section className="toolbar">
        <input className="search" type="search" placeholder="품목코드 · 품목명 검색" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <Chips label="구분" options={itemTypeOptions} value={types} onToggle={useToggleSet(setTypes)} />
        <span className="muted small legend">
          <i className="legend-erp" /> ERP 값
          <i className="legend-mes" /> MES에서 수정
        </span>
      </section>
      <DataGrid
        height={560}
        rowData={rows}
        getRowId={(p) => p.data.itemCode}
        columnDefs={columnDefs}
        quickFilterText={quick}
        stopEditingWhenCellsLoseFocus
        onCellValueChanged={onCellValueChanged}
      />
    </>
  )
}
