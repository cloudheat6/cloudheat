import { useEffect, useState } from 'react'
import { api, useApi } from '../../lib/api.js'
import { useToast } from '../../lib/toast.jsx'
import ProductPicker from '../../components/ProductPicker.jsx'
import { ErrorBox, PageHeader } from '../../components/ui.jsx'

// 라우팅: 제품별 공정 순서. 편집 후 '저장' 하면 통째로 교체
export default function Routings() {
  const notify = useToast()
  const items = useApi('/master/items')
  const { data: processes } = useApi('/master/processes')
  const { data: lines } = useApi('/master/lines')
  const [code, setCode] = useState(null)
  const [steps, setSteps] = useState([])
  const [saved, setSaved] = useState('[]')
  const [busy, setBusy] = useState(false)

  const usable = (processes ?? []).filter((p) => p.useYn)
  const item = items.data?.find((i) => i.itemCode === code)
  const dirty = JSON.stringify(steps) !== saved

  // 처음엔 첫 제품 선택
  useEffect(() => {
    if (!code && items.data) setCode(items.data.find((i) => i.itemType === '제품')?.itemCode ?? null)
  }, [items.data, code])

  useEffect(() => {
    if (!code) return
    let alive = true
    api(`/master/routings/${encodeURIComponent(code)}`).then((rows) => {
      if (!alive) return
      const s = rows.map((r) => ({ processCode: r.processCode, lineId: r.lineId == null ? '' : String(r.lineId) }))
      setSteps(s)
      setSaved(JSON.stringify(s))
    })
    return () => (alive = false)
  }, [code])

  const pick = (c) => {
    if (dirty && !window.confirm('저장하지 않은 변경이 있어요. 버릴까요?')) return
    setCode(c)
  }

  const set = (i, patch) => setSteps(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSteps(next)
  }

  const save = async () => {
    setBusy(true)
    try {
      await api(`/master/routings/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: steps.map((s) => ({ processCode: s.processCode, lineId: s.lineId === '' ? null : Number(s.lineId) })),
      })
      setSaved(JSON.stringify(steps))
      notify(`${code} 라우팅 저장됨 (${steps.length}공정)`, 'ok')
      items.reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="라우팅관리" desc="제품을 만드는 공정 순서예요. 작업지시의 공정별 실적이 이 순서로 계산돼요." />
      <ErrorBox error={items.error} onRetry={items.reload} />
      <div className="md">
        <ProductPicker items={items.data} selected={code} onSelect={pick} count={(i) => i.routingCount} countLabel="공정" />
        <section className="editor">
          {item ? (
            <>
              <div className="editor-head">
                <div>
                  <div className="mono strong">{item.itemCode}</div>
                  <div className="muted small">{item.itemName}</div>
                </div>
                <div className="page-actions">
                  <button className="btn ghost" disabled={!dirty || busy} onClick={() => setSteps(JSON.parse(saved))}>
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
                    <th style={{ width: 56 }}>순서</th>
                    <th>공정</th>
                    <th style={{ width: 160 }}>라인</th>
                    <th style={{ width: 132 }} />
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}>
                      <td className="mono">{i + 1}</td>
                      <td>
                        <select value={s.processCode} onChange={(e) => set(i, { processCode: e.target.value })} aria-label="공정">
                          {!usable.some((p) => p.processCode === s.processCode) && <option value={s.processCode}>{s.processCode} (사용 안 함)</option>}
                          {usable.map((p) => (
                            <option key={p.processCode} value={p.processCode}>
                              {p.processCode} · {p.processName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={s.lineId} onChange={(e) => set(i, { lineId: e.target.value })} aria-label="라인">
                          <option value="">(지정 안 함)</option>
                          {(lines ?? []).map((l) => (
                            <option key={l.lineId} value={l.lineId}>
                              {l.lineName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="row-actions">
                        <button className="icon-btn sm" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                          ↑
                        </button>
                        <button className="icon-btn sm" aria-label="아래로" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                          ↓
                        </button>
                        <button className="icon-btn sm" aria-label="삭제" onClick={() => setSteps(steps.filter((_, k) => k !== i))}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                  {steps.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted small empty-row">
                        등록된 공정이 없어요
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                className="btn ghost add-btn"
                disabled={!usable.length}
                onClick={() => setSteps([...steps, { processCode: usable[0].processCode, lineId: item.lineId == null ? '' : String(item.lineId) }])}
              >
                + 공정 추가
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
