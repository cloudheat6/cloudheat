import { useMemo, useState } from 'react'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { useToast } from '../lib/toast.jsx'
import { ErrorBox } from './ui.jsx'

/**
 * MES 에서 직접 관리하는 기준정보 목록 (공정 · 창고 · 라인)
 *  - 셀을 고치면 바로 저장 (PUT), 실패하면 원래 값으로 되돌림
 *  - 위쪽 입력줄로 추가 (POST), 행 끝 버튼으로 삭제 (DELETE)
 *
 * props
 *  path      '/master/processes'
 *  idField   'processCode'
 *  columns   AG Grid 컬럼 (editable 지정)
 *  toBody    행 → PUT 본문
 *  fields    추가 입력칸 [{ name, label, type: 'text'|'number'|'select', options, width }]
 *  label     '공정'
 */
export default function EditableList({ path, idField, columns, toBody, fields, label, height = 480 }) {
  const notify = useToast()
  const { data, error, reload } = useApi(path)
  const empty = useMemo(() => Object.fromEntries(fields.map((f) => [f.name, f.default ?? ''])), [fields])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)

  const add = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = Object.fromEntries(fields.map((f) => [f.name, f.type === 'number' ? Number(form[f.name] || 0) : form[f.name]]))
      await api(path, { method: 'POST', body: { ...body, useYn: true } })
      notify(`${label} ${form[fields[0].name]} 추가됨`, 'ok')
      setForm(empty)
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row) => {
    const id = row[idField]
    if (!window.confirm(`${label} ${id} 을(를) 삭제할까요?`)) return
    try {
      await api(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      notify(`${label} ${id} 삭제됨`, 'ok')
      reload()
    } catch (err) {
      notify(err.message)
    }
  }

  const onCellValueChanged = async (e) => {
    try {
      await api(`${path}/${encodeURIComponent(e.data[idField])}`, { method: 'PUT', body: toBody(e.data) })
      notify(`${label} ${e.data[idField]} 저장됨`, 'ok')
    } catch (err) {
      e.data[e.colDef.field] = e.oldValue
      e.api.refreshCells({ rowNodes: [e.node], force: true })
      notify(err.message)
    }
  }

  const cols = useMemo(
    () => [
      ...columns,
      {
        colId: 'del', headerName: '', width: 80, sortable: false, filter: false, resizable: false,
        cellRenderer: (p) => (
          <button className="btn ghost sm" onClick={() => remove(p.data)}>
            삭제
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns],
  )

  return (
    <>
      <form className="add-row" onSubmit={add}>
        {fields.map((f) =>
          f.type === 'select' ? (
            <select
              key={f.name}
              value={form[f.name]}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              style={{ width: f.width }}
              aria-label={f.label}
              required
            >
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              key={f.name}
              type={f.type === 'number' ? 'number' : 'text'}
              placeholder={f.label}
              value={form[f.name]}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              style={{ width: f.width }}
              maxLength={f.maxLength}
              required={f.required !== false}
            />
          ),
        )}
        <button className="btn" disabled={busy}>
          {label} 추가
        </button>
        <span className="muted small">셀을 더블클릭하면 바로 고쳐서 저장돼요. 사용 중인 항목은 삭제 대신 ‘사용’을 끄세요.</span>
      </form>
      <ErrorBox error={error} onRetry={reload} />
      <DataGrid
        height={height}
        rowData={data}
        getRowId={(p) => String(p.data[idField])}
        columnDefs={cols}
        defaultColDef={{ sortable: true, resizable: true, filter: false, suppressHeaderMenuButton: true }}
        singleClickEdit={false}
        stopEditingWhenCellsLoseFocus
        onCellValueChanged={onCellValueChanged}
      />
    </>
  )
}
