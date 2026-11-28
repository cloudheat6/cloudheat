import { useMemo, useState } from 'react'
import { api, fmtDateTime, fmtNum, today, useApi } from '../lib/api.js'
import { useToast } from '../lib/toast.jsx'

const TEXT = {
  purchase: {
    label: '발주',
    typeGroup: 'PO_TYPE',
    typeLabel: '발주구분',
    defaultTypes: [
      { code: '0', codeName: '국내발주', useYn: true },
      { code: '1', codeName: '수입영세', useYn: true },
    ],
    partner: '매입처',
    partnerType: '매입처',
    itemType: '원자재',
    due: 7,
    mes: 'MES 발주조회 → 입고',
  },
  sales: {
    label: '주문',
    typeGroup: 'SO_TYPE',
    typeLabel: '주문구분',
    defaultTypes: [
      { code: '0', codeName: '국내주문', useYn: true },
      { code: '1', codeName: '수출영세', useYn: true },
    ],
    partner: '고객사',
    partnerType: '매출처',
    itemType: '제품',
    due: 14,
    mes: 'MES 주문조회 → 생산 · 출고',
  },
}

const DEFAULT_CURRENCIES = [
  { code: 'KRW', codeName: '원화', useYn: true },
  { code: 'USD', codeName: '미국 달러', useYn: true },
  { code: 'EUR', codeName: '유로', useYn: true },
  { code: 'JPY', codeName: '일본 엔', useYn: true },
  { code: 'CNY', codeName: '중국 위안', useYn: true },
]

const emptyLine = (itemCode = '') => ({
  lineNo: null,
  itemCode,
  qty: '',
  unitPrice: '',
  supplyAmt: '0',
  vatAmt: '0',
  totalAmt: '0',
})

const roundPrice = (n) => String(Math.round(Math.max(0, n) * 100) / 100)
const isZeroRated = (orderType) => String(orderType) === '1'

// 영세('1')는 부가세 0, 그 외 국내 과세('0' 등)는 부가세 = 공급가의 10% 소수점 버림, 합계액 = 공급가 + 부가세
const calcFromPrice = (orderType, qty, unitPrice) => {
  const q = Number(qty) || 0
  const p = Number(unitPrice) || 0
  const supplyAmt = q > 0 && p >= 0 ? Math.trunc(q * p) : 0
  const vatAmt = isZeroRated(orderType) ? 0 : Math.trunc(supplyAmt / 10)
  return { supplyAmt, vatAmt, totalAmt: supplyAmt + vatAmt }
}

// 발주 · 주문 등록: 구분 · 통화 선택 목록은 관리내역등록(/codes) 데이터를 받아서 표시
export default function Orders({ kind }) {
  const t = TEXT[kind]
  const notify = useToast()
  const orders = useApi(`/orders/${kind}`)
  const items = useApi('/items')
  const partners = useApi('/partners')
  const codeGroups = useApi('/codes')
  const [form, setForm] = useState(null) // null: 닫힘, { orderNo?: string, ... }
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState('')
  const [typeFilter, setTypeFilter] = useState('전체')
  const [status, setStatus] = useState('전체')

  // 관리내역등록에서 가져온 코드 목록 (전체: 그리드 표시용, 사용 중: 입력 선택 목록용)
  const allTypeCodes = useMemo(() => {
    const found = (codeGroups.data ?? []).find((g) => g.groupCode === t.typeGroup)?.codes
    return found?.length ? found : t.defaultTypes
  }, [codeGroups.data, t])

  const activeTypeCodes = useMemo(() => allTypeCodes.filter((c) => c.useYn), [allTypeCodes])

  const allCurrencyCodes = useMemo(() => {
    const found = (codeGroups.data ?? []).find((g) => g.groupCode === 'CURRENCY')?.codes
    return found?.length ? found : DEFAULT_CURRENCIES
  }, [codeGroups.data])

  const activeCurrencyCodes = useMemo(() => allCurrencyCodes.filter((c) => c.useYn), [allCurrencyCodes])

  const typeMap = useMemo(() => Object.fromEntries(allTypeCodes.map((c) => [String(c.code), c.codeName])), [allTypeCodes])
  const typeName = (code) => typeMap[String(code)] ?? String(code)

  const itemList = (items.data ?? []).filter((i) => i.itemType === t.itemType)
  const partnerList = (partners.data ?? []).filter((p) => p.partnerType === t.partnerType)
  const byItem = Object.fromEntries((items.data ?? []).map((i) => [i.itemCode, i]))

  const rows = useMemo(() => {
    const q = quick.trim().toLowerCase()
    return (orders.data ?? []).filter(
      (o) =>
        (typeFilter === '전체' || String(o.orderType) === typeFilter) &&
        (status === '전체' || o.status === status) &&
        (!q ||
          [o.orderNo, typeName(o.orderType), o.currency, o.partnerName, ...o.lines.map((l) => `${l.itemCode} ${l.itemName}`)]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.data, quick, typeFilter, status, typeMap])

  const openNew = () => {
    const defaultType = activeTypeCodes[0]?.code ?? '0'
    const defaultCur = activeCurrencyCodes.find((c) => c.code === 'KRW')?.code ?? activeCurrencyCodes[0]?.code ?? 'KRW'
    setForm({
      orderNo: null,
      status: '확정',
      orderType: String(defaultType),
      currency: defaultCur,
      exchangeRate: '1',
      partnerCode: partnerList[0]?.partnerCode ?? '',
      orderDate: today(),
      dueDate: today(t.due),
      remark: '',
      lines: [emptyLine(itemList[0]?.itemCode)],
    })
  }

  const openEdit = (o) =>
    setForm({
      orderNo: o.orderNo,
      status: o.status,
      orderType: String(o.orderType ?? '0'),
      currency: o.currency || 'KRW',
      exchangeRate: String(o.exchangeRate ?? 1),
      partnerCode: o.partnerCode,
      orderDate: o.orderDate,
      dueDate: o.dueDate,
      remark: o.remark ?? '',
      updatedAt: o.updatedAt,
      lines: o.lines.map((l) => {
        const fallback = calcFromPrice(o.orderType ?? '0', l.qty, l.unitPrice)
        return {
          lineNo: l.lineNo,
          itemCode: l.itemCode,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
          supplyAmt: String(l.supplyAmt ?? fallback.supplyAmt),
          vatAmt: String(l.vatAmt ?? fallback.vatAmt),
          totalAmt: String(l.totalAmt ?? fallback.totalAmt),
        }
      }),
    })

  const readOnly = form && form.status !== '확정'
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }))

  // 발주/주문구분 변경 시 각 행의 현재 공급가 기준으로 부가세 · 합계액 재계산
  const changeOrderType = (nextType) =>
    setForm((f) => ({
      ...f,
      orderType: nextType,
      lines: f.lines.map((l) => {
        const s = Math.max(0, Math.trunc(Number(l.supplyAmt) || 0))
        const v = isZeroRated(nextType) ? 0 : Math.trunc(s / 10)
        return { ...l, vatAmt: String(v), totalAmt: String(s + v) }
      }),
    }))

  const changeCurrency = (currency) =>
    setForm((f) => ({
      ...f,
      currency,
      exchangeRate: currency === 'KRW' ? '1' : f.exchangeRate,
    }))

  // 1) 수량 변경 → 단가가 있으면 공급가 · 부가세 · 합계액 계산, 단가 없이 공급가만 먼저 넣었으면 단가 역산
  const changeQty = (i, rawQty) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, k) => {
        if (k !== i) return l
        const q = Number(rawQty) || 0
        if (l.unitPrice === '' && Number(l.supplyAmt) > 0 && q > 0) {
          return { ...l, qty: rawQty, unitPrice: roundPrice(Number(l.supplyAmt) / q) }
        }
        const c = calcFromPrice(f.orderType, rawQty, l.unitPrice)
        return { ...l, qty: rawQty, supplyAmt: String(c.supplyAmt), vatAmt: String(c.vatAmt), totalAmt: String(c.totalAmt) }
      }),
    }))

  // 2) 단가 변경 → 공급가 · 부가세 · 합계액 계산
  const changeUnitPrice = (i, rawPrice) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, k) => {
        if (k !== i) return l
        const c = rawPrice === '' ? { supplyAmt: 0, vatAmt: 0, totalAmt: 0 } : calcFromPrice(f.orderType, l.qty, rawPrice)
        return { ...l, unitPrice: rawPrice, supplyAmt: String(c.supplyAmt), vatAmt: String(c.vatAmt), totalAmt: String(c.totalAmt) }
      }),
    }))

  // 3) 공급가 수정 → 수량에 맞춰 단가 수정 + 부가세 · 합계액 수정
  const changeSupplyAmt = (i, rawSupply) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, k) => {
        if (k !== i) return l
        if (rawSupply === '') return { ...l, supplyAmt: '', unitPrice: '0', vatAmt: '0', totalAmt: '0' }
        const s = Math.max(0, Math.trunc(Number(rawSupply) || 0))
        const q = Number(l.qty) || 0
        const v = isZeroRated(f.orderType) ? 0 : Math.trunc(s / 10)
        return {
          ...l,
          supplyAmt: rawSupply,
          unitPrice: q > 0 ? roundPrice(s / q) : l.unitPrice,
          vatAmt: String(v),
          totalAmt: String(s + v),
        }
      }),
    }))

  // 4) 부가세 수정 → 공급가 + 부가세로 합계액만 수정 (단가 · 공급가 유지)
  const changeVatAmt = (i, rawVat) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, k) => {
        if (k !== i) return l
        const s = Math.max(0, Math.trunc(Number(l.supplyAmt) || 0))
        const v = rawVat === '' ? 0 : Math.max(0, Math.trunc(Number(rawVat) || 0))
        return { ...l, vatAmt: rawVat, totalAmt: String(s + v) }
      }),
    }))

  // 5) 합계액 수정 → 단가 · 공급가 · 부가세 역산 수정
  const changeTotalAmt = (i, rawTotal) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, k) => {
        if (k !== i) return l
        if (rawTotal === '') return { ...l, totalAmt: '', unitPrice: '0', supplyAmt: '0', vatAmt: '0' }
        const tot = Math.max(0, Math.trunc(Number(rawTotal) || 0))
        const s = isZeroRated(f.orderType) ? tot : Math.trunc((tot * 10 + 9) / 11)
        const v = tot - s
        const q = Number(l.qty) || 0
        return {
          ...l,
          totalAmt: rawTotal,
          supplyAmt: String(s),
          vatAmt: String(v),
          unitPrice: q > 0 ? roundPrice(s / q) : l.unitPrice,
        }
      }),
    }))

  const formSums = useMemo(() => {
    if (!form) return { qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0 }
    return form.lines.reduce(
      (acc, l) => ({
        qty: acc.qty + (Number(l.qty) || 0),
        supplyAmt: acc.supplyAmt + (Math.trunc(Number(l.supplyAmt)) || 0),
        vatAmt: acc.vatAmt + (Math.trunc(Number(l.vatAmt)) || 0),
        totalAmt: acc.totalAmt + (Math.trunc(Number(l.totalAmt)) || 0),
      }),
      { qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0 },
    )
  }, [form])

  const save = async () => {
    if (!form.currency || !(Number(form.exchangeRate) > 0)) return notify('통화 · 환율을 확인하세요')
    const bad = form.lines.findIndex(
      (l) =>
        !l.itemCode ||
        !(Number(l.qty) > 0) ||
        l.unitPrice === '' ||
        Number(l.unitPrice) < 0 ||
        l.supplyAmt === '' ||
        Number(l.supplyAmt) < 0 ||
        l.vatAmt === '' ||
        Number(l.vatAmt) < 0 ||
        l.totalAmt === '' ||
        Number(l.totalAmt) < 0,
    )
    if (bad >= 0) return notify(`${bad + 1}행: 품목 · 수량 · 단가 · 금액을 확인하세요`)
    const body = {
      orderType: String(form.orderType),
      currency: form.currency,
      exchangeRate: Number(form.exchangeRate),
      partnerCode: form.partnerCode,
      orderDate: form.orderDate,
      dueDate: form.dueDate,
      remark: form.remark,
      lines: form.lines.map((l) => ({
        lineNo: l.lineNo,
        itemCode: l.itemCode,
        qty: Math.round(Number(l.qty)),
        unitPrice: Number(l.unitPrice),
        supplyAmt: Math.trunc(Number(l.supplyAmt)),
        vatAmt: Math.trunc(Number(l.vatAmt)),
        totalAmt: Math.trunc(Number(l.totalAmt)),
      })),
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

  // 수정 중인 문서가 비활성화된 이전 코드 값을 갖고 있어도 선택창에서 보이게 포함
  const typeOptions = form && !activeTypeCodes.some((c) => String(c.code) === String(form.orderType))
    ? [...activeTypeCodes, { code: form.orderType, codeName: `${typeName(form.orderType)} (비활성)` }]
    : activeTypeCodes

  const currencyOptions = form && !activeCurrencyCodes.some((c) => c.code === form.currency)
    ? [...activeCurrencyCodes, { code: form.currency, codeName: form.currency }]
    : activeCurrencyCodes

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.label}등록</h1>
          <p>
            여기서 저장한 {t.label}는 MES 가 1분마다 받아가요 ({t.mes}). {t.typeLabel} · 통화 선택 목록은 <strong>관리내역등록</strong>에서 가져와요.
          </p>
        </div>
        <button className="btn" onClick={openNew} disabled={!items.data || !partners.data}>
          + 새 {t.label}
        </button>
      </div>
      {error && (
        <div className="error-box">
          불러오지 못했어요: {error}{' '}
          <button className="btn ghost sm" onClick={() => (orders.reload(), items.reload(), partners.reload(), codeGroups.reload())}>
            다시 시도
          </button>
        </div>
      )}

      <div className={`split ${form ? 'with-form' : ''}`}>
        <section className="panel">
          <div className="panel-bar">
            <input className="search" type="search" placeholder={`번호 · ${t.typeLabel} · ${t.partner} · 통화 · 품목 검색`} value={quick} onChange={(e) => setQuick(e.target.value)} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={t.typeLabel}>
              <option value="전체">{t.typeLabel}: 전체</option>
              {allTypeCodes.map((c) => (
                <option key={c.code} value={String(c.code)}>
                  {c.code}: {c.codeName}
                </option>
              ))}
            </select>
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
                  <th>{t.typeLabel}</th>
                  <th>{t.partner}</th>
                  <th>통화</th>
                  <th className="num">환율</th>
                  <th>납기일</th>
                  <th>품목</th>
                  <th className="num">단가</th>
                  <th className="num">공급가</th>
                  <th className="num">부가세</th>
                  <th className="num">합계액</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const supplyAmt = o.lines.reduce((s, l) => s + (l.supplyAmt ?? calcFromPrice(o.orderType, l.qty, l.unitPrice).supplyAmt), 0)
                  const vatAmt = o.lines.reduce((s, l) => s + (l.vatAmt ?? calcFromPrice(o.orderType, l.qty, l.unitPrice).vatAmt), 0)
                  const totalAmt = o.lines.reduce((s, l) => s + (l.totalAmt ?? calcFromPrice(o.orderType, l.qty, l.unitPrice).totalAmt), 0)
                  return (
                    <tr key={o.orderNo} className={form?.orderNo === o.orderNo ? 'sel' : ''} onClick={() => openEdit(o)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openEdit(o)}>
                      <td className="mono strong">{o.orderNo}</td>
                      <td className="mono">{o.orderDate}</td>
                      <td>
                        <span className="tag">{typeName(o.orderType)}</span>
                      </td>
                      <td>{o.partnerName}</td>
                      <td className="mono">{o.currency || 'KRW'}</td>
                      <td className="num mono">{fmtNum(o.exchangeRate ?? 1)}</td>
                      <td className="mono">{o.dueDate}</td>
                      <td>
                        {o.lines[0]?.itemName}
                        {o.lines.length > 1 && <span className="muted"> 외 {o.lines.length - 1}</span>}
                      </td>
                      <td className="num">{o.lines.length === 1 ? fmtNum(o.lines[0]?.unitPrice) : <span className="muted">-</span>}</td>
                      <td className="num">{fmtNum(supplyAmt)}</td>
                      <td className="num">{fmtNum(vatAmt)}</td>
                      <td className="num strong">{fmtNum(totalAmt)}</td>
                      <td>
                        <span className={`tag ${o.status === '취소' ? 'bad' : 'ok'}`}>{o.status}</span>
                      </td>
                    </tr>
                  )
                })}
                {orders.data && rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="empty">
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
                  <span>{t.typeLabel}</span>
                  <select value={form.orderType} onChange={(e) => changeOrderType(e.target.value)}>
                    {typeOptions.map((tp) => (
                      <option key={tp.code} value={String(tp.code)}>
                        {tp.code}: {tp.codeName}
                      </option>
                    ))}
                  </select>
                </label>
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
                  <span>통화</span>
                  <select value={form.currency} onChange={(e) => changeCurrency(e.target.value)}>
                    {currencyOptions.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.codeName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>환율</span>
                  <input className="num" type="number" min="0.0001" step="any" value={form.exchangeRate} onChange={(e) => set({ exchangeRate: e.target.value })} />
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
                      <th style={{ width: 34 }}>행</th>
                      <th>품목</th>
                      <th style={{ width: 44 }}>단위</th>
                      <th className="num" style={{ width: 82 }}>
                        수량
                      </th>
                      <th className="num" style={{ width: 98 }}>
                        단가
                      </th>
                      <th className="num" style={{ width: 104 }}>
                        공급가
                      </th>
                      <th className="num" style={{ width: 92 }}>
                        부가세
                      </th>
                      <th className="num" style={{ width: 106 }}>
                        합계액
                      </th>
                      <th style={{ width: 32 }} />
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
                          <input className="num" type="number" min="1" step="1" value={l.qty} onChange={(e) => changeQty(i, e.target.value)} aria-label={`${i + 1}행 수량`} />
                        </td>
                        <td>
                          <input className="num" type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => changeUnitPrice(i, e.target.value)} aria-label={`${i + 1}행 단가`} />
                        </td>
                        <td>
                          <input className="num" type="number" min="0" step="1" value={l.supplyAmt} onChange={(e) => changeSupplyAmt(i, e.target.value)} aria-label={`${i + 1}행 공급가`} />
                        </td>
                        <td>
                          <input className="num" type="number" min="0" step="1" value={l.vatAmt} onChange={(e) => changeVatAmt(i, e.target.value)} aria-label={`${i + 1}행 부가세`} />
                        </td>
                        <td>
                          <input className="num strong" type="number" min="0" step="1" value={l.totalAmt} onChange={(e) => changeTotalAmt(i, e.target.value)} aria-label={`${i + 1}행 합계액`} />
                        </td>
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
                      <td className="num strong">{fmtNum(formSums.qty)}</td>
                      <td className="muted num">합계</td>
                      <td className="num strong">{fmtNum(formSums.supplyAmt)}</td>
                      <td className="num strong">{fmtNum(formSums.vatAmt)}</td>
                      <td className="num strong">{fmtNum(formSums.totalAmt)}</td>
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
