import { useMemo, useState } from 'react'
import { api, fmtDateTime, fmtNum, today, useApi } from '../lib/api.js'
import { useToast } from '../lib/toast.jsx'

const TEXT = {
  purchase: { label: '발주', partner: '매입처', partnerType: '매입처', itemType: '원자재', due: 7, mes: 'MES 발주조회 → 입고' },
  sales: { label: '수주', partner: '고객사', partnerType: '매출처', itemType: '제품', due: 14, mes: 'MES 주문조회 → 생산 · 출고' },
}

const emptyLine = (itemCode = '') => ({ lineNo: null, itemCode, qty: '', unitPrice: '' })

// 발주 · 수주 입력: 왼쪽 목록, 오른쪽 입력 · 수정. 저장하면 MES 가 1분 안에 받아감
export default function Orders({ kind }) {
  const t = TEXT[kind]
  const notify = useToast()
  const orders = useApi(`/orders/${kind}`)
  const items = useApi('/items')
  const partners = useApi('/partners')
  const [form, setForm] = useState(null) // null: 닫힘, { orderNo?: string, ... }
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState('')
  const [status, setStatus] = useState('전체')

  const itemList = (items.data ?? []).filter((i) => i.itemType === t.itemType)
  const partnerList = (partners.data ?? []).filter((p) => p.partnerType === t.partnerType)
  const byItem = Object.fromEntries((items.data ?? []).map((i) => [i.itemCode, i]))

  const rows = useMemo(() => {
    const q = quick.trim().toLowerCase()
    return (orders.data ?? []).filter(
      (o) =>
        (status === '전체' || o.status === status) &&
        (!q || [o.orderNo, o.partnerName, ...o.lines.map((l) => `${l.itemCode} ${l.itemName}`)].join(' ').toLowerCase().includes(q)),
    )
  }, [orders.data, quick, status])

  const openNew = () =>
    setForm({
      orderNo: null,
      status: '확정',
      partnerCode: partnerList[0]?.partnerCode ?? '',
      orderDate: today(),
      dueDate: today(t.due),
      remark: '',
      lines: [emptyLine(itemList[0]?.itemCode)],
    })

  const openEdit = (o) =>
    setForm({
      orderNo: o.orderNo,
      status: o.status,
      partnerCode: o.partnerCode,
      orderDate: o.orderDate,
      dueDate: o.dueDate,
      remark: o.remark ?? '',
      updatedAt: o.updatedAt,
      lines: o.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, qty: String(l.qty), unitPrice: String(l.unitPrice) })),
    })

  const readOnly = form && form.status !== '확정'
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }))
  const total = form ? form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0) : 0

  const save = async () => {
    const bad = form.lines.findIndex((l) => !l.itemCode || !(Number(l.qty) > 0) || l.unitPrice === '' || Number(l.unitPrice) < 0)
    if (bad >= 0) return notify(`${bad + 1}행: 품목 · 수량 · 단가를 확인하세요`)
    const body = {
      partnerCode: form.partnerCode,
      orderDate: form.orderDate,
      dueDate: form.dueDate,
      remark: form.remark,
      lines: form.lines.map((l) => ({ lineNo: l.lineNo, itemCode: l.itemCode, qty: Math.round(Number(l.qty)), unitPrice: Number(l.unitPrice) })),
    }
    setBusy(true)
    try {
      let no = form.orderNo
      if (no) await api(`/orders/${kind}/${encodeURIComponent(no)}`, { method: 'PUT', body })
      else no = (await api(`/orders/${kind}`, { method: 'POST', body })).orderNo
      notify(`${no} 저장됨 · MES 가 1분 안에 받아가요`, 'ok')
      setForm(null)
      orders.reload()
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!window.confirm(`${form.orderNo} 를 취소할까요? 취소한 ${t.label}는 다시 살릴 수 없어요.`)) return
    setBusy(true)
    try {
      await api(`/orders/${kind}/${encodeURIComponent(form.orderNo)}/cancel`, { method: 'POST' })
      notify(`${form.orderNo} 취소됨 · MES 에도 '취소' 로 전달돼요`, 'ok')
      setForm(null)
      orders.reload()
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
    }
  }

  const error = orders.error || items.error || partners.error

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.label}등록</h1>
          <p>
            여기서 저장한 {t.label}는 MES 가 1분마다 받아가요 ({t.mes}). 수정 · 취소도 그대로 전달돼요.
          </p>
        </div>
        <button className="btn" onClick={openNew} disabled={!items.data || !partners.data}>
          + 새 {t.label}
        </button>
      </div>
      {error && (
        <div className="error-box">
          불러오지 못했어요: {error}{' '}
          <button className="btn ghost sm" onClick={() => (orders.reload(), items.reload(), partners.reload())}>
            다시 시도
          </button>
        </div>
      )}

      <div className={`split ${form ? 'with-form' : ''}`}>
        <section className="panel">
          <div className="panel-bar">
            <input className="search" type="search" placeholder={`번호 · ${t.partner} · 품목 검색`} value={quick} onChange={(e) => setQuick(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
              {['전체', '확정', '취소'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <span className="muted small">{rows.length}건</span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t.label}번호</th>
                  <th>{t.label}일</th>
                  <th>{t.partner}</th>
                  <th>납기일</th>
                  <th>품목</th>
                  <th className="num">금액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const amount = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
                  return (
                    <tr key={o.orderNo} className={form?.orderNo === o.orderNo ? 'sel' : ''} onClick={() => openEdit(o)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openEdit(o)}>
                      <td className="mono strong">{o.orderNo}</td>
                      <td className="mono">{o.orderDate}</td>
                      <td>{o.partnerName}</td>
                      <td className="mono">{o.dueDate}</td>
                      <td>
                        {o.lines[0]?.itemName}
                        {o.lines.length > 1 && <span className="muted"> 외 {o.lines.length - 1}</span>}
                      </td>
                      <td className="num">{fmtNum(amount)}</td>
                      <td>
                        <span className={`tag ${o.status === '취소' ? 'bad' : 'ok'}`}>{o.status}</span>
                      </td>
                    </tr>
                  )
                })}
                {orders.data && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty">
                      {orders.data.length ? '조건에 맞는 문서가 없어요' : `아직 ${t.label}가 없어요. '+ 새 ${t.label}' 로 입력해 보세요`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {form && (
          <section className="panel form">
            <div className="form-head">
              <div>
                <h2>{form.orderNo ?? `새 ${t.label}`}</h2>
                <span className="muted small">
                  {form.orderNo ? `최종 수정 ${fmtDateTime(form.updatedAt)}` : '저장하면 번호가 매겨져요'}
                  {readOnly && ' · 취소된 문서라 수정할 수 없어요'}
                </span>
              </div>
              <button className="icon-btn" aria-label="닫기" onClick={() => setForm(null)}>
                ×
              </button>
            </div>

            <fieldset disabled={readOnly || busy}>
              <div className="fields">
                <label>
                  <span>{t.partner}</span>
                  <select value={form.partnerCode} onChange={(e) => set({ partnerCode: e.target.value })}>
                    {partnerList.map((p) => (
                      <option key={p.partnerCode} value={p.partnerCode}>
                        {p.partnerCode} · {p.partnerName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t.label}일</span>
                  <input type="date" value={form.orderDate} onChange={(e) => set({ orderDate: e.target.value })} />
                </label>
                <label>
                  <span>납기일</span>
                  <input type="date" value={form.dueDate} min={form.orderDate} onChange={(e) => set({ dueDate: e.target.value })} />
                </label>
                <label className="wide">
                  <span>비고</span>
                  <input type="text" maxLength={200} value={form.remark} onChange={(e) => set({ remark: e.target.value })} />
                </label>
              </div>

              <div className="table-wrap">
                <table className="tbl lines">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>행</th>
                      <th>품목</th>
                      <th style={{ width: 50 }}>단위</th>
                      <th className="num" style={{ width: 100 }}>
                        수량
                      </th>
                      <th className="num" style={{ width: 110 }}>
                        단가
                      </th>
                      <th className="num" style={{ width: 120 }}>
                        금액
                      </th>
                      <th style={{ width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="mono muted">{l.lineNo ?? '새'}</td>
                        <td>
                          <select value={l.itemCode} onChange={(e) => setLine(i, { itemCode: e.target.value })} aria-label={`${i + 1}행 품목`}>
                            {!l.itemCode && <option value="">품목 선택</option>}
                            {itemList.map((it) => (
                              <option key={it.itemCode} value={it.itemCode}>
                                {it.itemCode} · {it.itemName}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="muted">{byItem[l.itemCode]?.unit}</td>
                        <td>
                          <input className="num" type="number" min="1" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`${i + 1}행 수량`} />
                        </td>
                        <td>
                          <input className="num" type="number" min="0" step="10" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-label={`${i + 1}행 단가`} />
                        </td>
                        <td className="num">{fmtNum((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
                        <td>
                          <button
                            className="icon-btn sm"
                            aria-label={`${i + 1}행 삭제`}
                            disabled={form.lines.length === 1}
                            onClick={() => set({ lines: form.lines.filter((_, k) => k !== i) })}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        <button className="btn ghost sm" disabled={form.lines.length >= 50} onClick={() => set({ lines: [...form.lines, emptyLine(itemList[0]?.itemCode)] })}>
                          + 행 추가
                        </button>
                      </td>
                      <td className="num strong">{fmtNum(form.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0))}</td>
                      <td className="muted num">합계</td>
                      <td className="num strong">{fmtNum(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </fieldset>

            <div className="form-actions">
              {form.orderNo && !readOnly && (
                <button className="btn danger ghost" disabled={busy} onClick={cancel}>
                  {t.label} 취소
                </button>
              )}
              <span className="grow" />
              <button className="btn ghost" disabled={busy} onClick={() => setForm(null)}>
                닫기
              </button>
              {!readOnly && (
                <button className="btn" disabled={busy} onClick={save}>
                  {form.orderNo ? '수정 저장' : '저장'}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
