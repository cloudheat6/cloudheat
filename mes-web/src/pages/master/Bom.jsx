import { useEffect, useState } from 'react'
import { api, useApi } from '../../lib/api.js'
import { useToast } from '../../lib/toast.jsx'
import ProductPicker from '../../components/ProductPicker.jsx'
import { Badge, ErrorBox, PageHeader } from '../../components/ui.jsx'

// BOM: 제품 1개를 만드는 데 드는 자품목 · 소요량 (단단계). 편집 후 '저장' 하면 통째로 교체
export default function Bom() {
  const notify = useToast()
  const items = useApi('/master/items')
  const [code, setCode] = useState(null)
  const [lines, setLines] = useState([])
  const [saved, setSaved] = useState('[]')
  const [busy, setBusy] = useState(false)

  const all = items.data ?? []
  const parent = all.find((i) => i.itemCode === code)
  const byCode = Object.fromEntries(all.map((i) => [i.itemCode, i]))
  const choices = all.filter((i) => i.itemCode !== code && i.useYn)
  const dirty = JSON.stringify(lines) !== saved

  useEffect(() => {
    if (!code && items.data) setCode(items.data.find((i) => i.itemType === '제품')?.itemCode ?? null)
  }, [items.data, code])

  useEffect(() => {
    if (!code) return
    let alive = true
    api(`/master/bom/${encodeURIComponent(code)}`).then((rows) => {
      if (!alive) return
      const l = rows.map((r) => ({ childCode: r.childCode, qtyPer: String(Number(r.qtyPer)) }))
      setLines(l)
      setSaved(JSON.stringify(l))
    })
    return () => (alive = false)
  }, [code])

  const pick = (c) => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있어요. 버릴까요?')) return
    setCode(c)
  }

  const set = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  const save = async () => {
    const bad = lines.find((l) => !(Number(l.qtyPer) > 0))
    if (bad) return notify(`${bad.childCode} 소요량은 0보다 커야 해요`)
    setBusy(true)
    try {
      await api(`/master/bom/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: lines.map((l) => ({ childCode: l.childCode, qtyPer: Number(l.qtyPer) })),
      })
      setSaved(JSON.stringify(lines))
      notify(`${code} BOM 저장됨 (${lines.length}개 자품목)`, 'ok')
      items.reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const nextChoice = choices.find((c) => !lines.some((l) => l.childCode === c.itemCode))

  return (
    <>
      <PageHeader
        title="BOM관리"
        desc="제품 1개를 만드는 데 필요한 자재와 수량이에요. MES에서 관리하고, 생산 실적을 등록할 때 자재 투입량 계산에 써요."
      />
      <ErrorBox error={items.error} onRetry={items.reload} />
      <div className="md">
        <ProductPicker items={items.data} selected={code} onSelect={pick} count={(i) => i.bomCount} countLabel="개" />
        <section className="editor">
          {parent ? (
            <>
              <div className="editor-head">
                <div>
                  <div className="mono strong">{parent.itemCode}</div>
                  <div className="muted small">
                    {parent.itemName} · 1{parent.unit} 기준
                  </div>
                </div>
                <div className="page-actions">
                  <button className="btn ghost" disabled={!dirty || busy} onClick={() => setLines(JSON.parse(saved))}>
                    되돌리기
                  </button>
                  <button className="btn" disabled={!dirty || busy} onClick={save}>
                    저장
                  </button>
                </div>
              </div>

              <table className="edit-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>자품목</th>
                    <th style={{ width: 80 }}>구분</th>
                    <th style={{ width: 150 }}>소요량</th>
                    <th style={{ width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = byCode[l.childCode]
                    return (
                      <tr key={i}>
                        <td className="mono">{i + 1}</td>
                        <td>
                          <select value={l.childCode} onChange={(e) => set(i, { childCode: e.target.value })} aria-label="자품목">
                            {['원자재', '제품'].map((type) => (
                              <optgroup key={type} label={type}>
                                {choices
                                  .filter((x) => x.itemType === type && (x.itemCode === l.childCode || !lines.some((y) => y.childCode === x.itemCode)))
                                  .map((x) => (
                                    <option key={x.itemCode} value={x.itemCode}>
                                      {x.itemCode} · {x.itemName}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td>{c && <Badge>{c.itemType}</Badge>}</td>
                        <td>
                          <span className="qty-input">
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={l.qtyPer}
                              onChange={(e) => set(i, { qtyPer: e.target.value })}
                              aria-label="소요량"
                            />
                            <span className="muted small">{c?.unit}</span>
                          </span>
                        </td>
                        <td className="row-actions">
                          <button className="icon-btn sm" aria-label="삭제" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted small empty-row">
                        등록된 자품목이 없어요
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                className="btn ghost add-btn"
                disabled={!nextChoice}
                onClick={() => setLines([...lines, { childCode: nextChoice.itemCode, qtyPer: '1' }])}
              >
                + 자품목 추가
              </button>
              {dirty && <p className="small warn-note">저장하지 않은 변경이 있어요</p>}
            </>
          ) : (
            <p className="muted">왼쪽에서 제품을 고르세요</p>
          )}
        </section>
      </div>
    </>
  )
}
