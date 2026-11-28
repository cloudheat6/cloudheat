import { useMemo, useState } from 'react'
import EditableList from '../../components/EditableList.jsx'
import { PageHeader } from '../../components/ui.jsx'
import { useCodes } from '../../lib/codes.js'

const DEFAULT_WH_TYPES = ['원자재', '현장', '제품', '일반']

const useCol = { field: 'useYn', headerName: '사용', width: 80, editable: true, cellDataType: 'boolean' }

export default function ProcessWarehouse() {
  const [tab, setTab] = useState('process')
  const { codesOf, mapOf } = useCodes()

  const whTypeOptions = useMemo(() => {
    const list = codesOf('WH_TYPE').map((c) => ({ value: c.code, label: c.codeName }))
    return list.length ? list : DEFAULT_WH_TYPES.map((x) => ({ value: x, label: x }))
  }, [codesOf])

  const whTypeValues = useMemo(() => whTypeOptions.map((o) => o.value), [whTypeOptions])

  const whTypeRef = useMemo(() => {
    const base = Object.fromEntries(DEFAULT_WH_TYPES.map((x) => [x, x]))
    return { ...base, ...mapOf('WH_TYPE') }
  }, [mapOf])

  const tabs = useMemo(
    () => ({
      process: {
        label: '공정',
        path: '/master/processes',
        idField: 'processCode',
        columns: [
          { field: 'processCode', headerName: '공정 코드', width: 120, cellClass: 'mono strong' },
          { field: 'processName', headerName: '공정명', flex: 1, minWidth: 160, editable: true },
          { field: 'sortNo', headerName: '정렬', width: 90, editable: true, cellDataType: 'number', type: 'rightAligned' },
          useCol,
          { field: 'usedBy', headerName: '사용 품목', width: 110, type: 'rightAligned', valueFormatter: (p) => `${p.value}개` },
        ],
        toBody: (r) => ({ processName: r.processName, sortNo: Number(r.sortNo) || 0, useYn: r.useYn }),
        fields: [
          { name: 'processCode', label: '공정 코드', width: 110, maxLength: 10 },
          { name: 'processName', label: '공정명', width: 180, maxLength: 30 },
          { name: 'sortNo', label: '정렬', type: 'number', width: 80, required: false },
        ],
      },
      warehouse: {
        label: '창고',
        path: '/master/warehouses',
        idField: 'whCode',
        columns: [
          { field: 'whCode', headerName: '창고 코드', width: 120, cellClass: 'mono strong' },
          { field: 'whName', headerName: '창고명', flex: 1, minWidth: 160, editable: true },
          {
            field: 'whType',
            headerName: '구분',
            width: 110,
            editable: true,
            refData: whTypeRef,
            cellEditor: 'agSelectCellEditor',
            cellEditorParams: (p) => ({
              values: p.value && !whTypeValues.includes(p.value) ? [...whTypeValues, p.value] : whTypeValues,
            }),
          },
          useCol,
          { field: 'stockItems', headerName: '재고 품목', width: 110, type: 'rightAligned', valueFormatter: (p) => `${p.value}개` },
        ],
        toBody: (r) => ({ whName: r.whName, whType: r.whType, useYn: r.useYn }),
        fields: [
          { name: 'whCode', label: '창고 코드', width: 110, maxLength: 10 },
          { name: 'whName', label: '창고명', width: 180, maxLength: 30 },
          { name: 'whType', label: '구분', type: 'select', options: whTypeOptions, width: 110 },
        ],
      },
      line: {
        label: '라인',
        path: '/master/lines',
        idField: 'lineId',
        columns: [
          { field: 'lineId', headerName: '라인 번호', width: 110, cellClass: 'mono strong' },
          { field: 'lineName', headerName: '라인명', flex: 1, minWidth: 160, editable: true },
          useCol,
          { field: 'usedBy', headerName: '사용 품목', width: 110, type: 'rightAligned', valueFormatter: (p) => `${p.value}개` },
        ],
        toBody: (r) => ({ lineName: r.lineName, useYn: r.useYn }),
        fields: [
          { name: 'lineId', label: '라인 번호', type: 'number', width: 100 },
          { name: 'lineName', label: '라인명', width: 180, maxLength: 30 },
        ],
      },
    }),
    [whTypeOptions, whTypeValues, whTypeRef],
  )

  const t = tabs[tab]
  return (
    <>
      <PageHeader title="공정 · 창고관리" desc="MES에서 직접 관리하는 기준정보예요. 공정은 라우팅에서, 창고는 재고에서(창고 구분은 공통코드관리와 연동), 라인은 품목과 작업지시에서 사용해요." />
      <div className="tabs" role="tablist">
        {Object.entries(tabs).map(([id, x]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {x.label}
          </button>
        ))}
      </div>
      <EditableList key={tab} {...t} />
    </>
  )
}
