import { useEffect, useState } from 'react'
import { api, fmtDateTime, useApi } from '../lib/api.js'
import { useToast } from '../lib/toast.jsx'

// 관리내역등록: 발주구분 · 주문구분 · 통화 · 품목구분 · 거래처구분 · 단위 · 창고구분 등 코드화된 항목 관리
export default function Codes() {
  const notify = useToast()
  const { data, error, reload } = useApi('/codes')
  const [picked, setPicked] = useState(null)
  const [groupForm, setGroupForm] = useState(null) // 새 관리항목 추가 폼
  const [newCode, setNewCode] = useState({ code: '', codeName: '', sortNo: '', remark: '' })
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)

  const groups = data ?? []
  const current = groups.find((g) => g.groupCode === picked) ?? groups[0] ?? null

  useEffect(() => {
    if (!picked && groups.length) setPicked(groups[0].groupCode)
  }, [picked, groups])

  useEffect(() => {
    if (!current) return
    setDrafts(
      Object.fromEntries(
        current.codes.map((c) => [
          c.code,
          { codeName: c.codeName, sortNo: String(c.sortNo), remark: c.remark ?? '', useYn: c.useYn },
        ]),
      ),
    )
    const maxSort = current.codes.reduce((m, c) => Math.max(m, c.sortNo), 0)
    setNewCode({ code: '', codeName: '', sortNo: String(maxSort + 1), remark: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.groupCode, data])

  const addGroup = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const code = groupForm.groupCode.trim().toUpperCase()
      await api('/codes/groups', {
        method: 'POST',
        body: { groupCode: code, groupName: groupForm.groupName, remark: groupForm.remark, sortNo: Number(groupForm.sortNo) || 0, useYn: true },
      })
      notify(`관리항목 ${code} 등록됨`, 'ok')
      setGroupForm(null)
      setPicked(code)
      await reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addCode = async (e) => {
    e.preventDefault()
    if (!current) return
    setBusy(true)
    try {
      await api(`/codes/${encodeURIComponent(current.groupCode)}`, {
        method: 'POST',
        body: {
          code: newCode.code,
          codeName: newCode.codeName,
          sortNo: Number(newCode.sortNo) || 0,
          remark: newCode.remark,
          useYn: true,
        },
      })
      notify(`${current.groupName} [${newCode.code}] 등록됨 · MES 도 1분 안에 받아가요`, 'ok')
      await reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const saveCode = async (orig) => {
    const d = drafts[orig.code]
    if (!d) return
    setBusy(true)
    try {
      await api(`/codes/${encodeURIComponent(current.groupCode)}/${encodeURIComponent(orig.code)}`, {
        method: 'PUT',
        body: {
          codeName: d.codeName,
          sortNo: Number(d.sortNo) || 0,
          remark: d.remark,
          useYn: d.useYn,
        },
      })
      notify(`[${orig.code}] 저장됨 · MES 도 1분 안에 받아가요`, 'ok')
      await reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeCode = async (orig) => {
    if (!window.confirm(`${current.groupName} [${orig.code} · ${orig.codeName}] 코드를 삭제할까요?`)) return
    setBusy(true)
    try {
      await api(`/codes/${encodeURIComponent(current.groupCode)}/${encodeURIComponent(orig.code)}`, { method: 'DELETE' })
      notify(`[${orig.code}] 삭제됨`, 'ok')
      await reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const isDirty = (c) => {
    const d = drafts[c.code]
    if (!d) return false
    return d.codeName !== c.codeName || Number(d.sortNo) !== c.sortNo || d.remark !== (c.remark ?? '') || d.useYn !== c.useYn
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>관리내역등록</h1>
          <p>
            발주구분 · 주문구분 · 통화 · 품목구분 · 거래처구분 · 단위 · 창고구분 등 코드화한 항목을 관리해요. 여기서 등록 · 수정하면 ERP 입력 화면 선택 목록에 바로 반영되고, MES 공통코드관리로도 1분마다 동기화돼요.
          </p>
        </div>
        <button
          className="btn ghost"
          onClick={() => setGroupForm(groupForm ? null : { groupCode: '', groupName: '', sortNo: String(groups.length + 1), remark: '' })}
        >
          {groupForm ? '항목 추가 닫기' : '+ 새 관리항목'}
        </button>
      </div>

      {error && (
        <div className="error-box">
          불러오지 못했어요: {error}{' '}
          <button className="btn ghost sm" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}

      {groupForm && (
        <form className="panel code-add-bar" onSubmit={addGroup}>
          <input
            placeholder="관리항목 코드 (예: PAY_TYPE)"
            value={groupForm.groupCode}
            onChange={(e) => setGroupForm({ ...groupForm, groupCode: e.target.value })}
            maxLength={20}
            required
          />
          <input
            placeholder="관리항목명 (예: 결제구분)"
            value={groupForm.groupName}
            onChange={(e) => setGroupForm({ ...groupForm, groupName: e.target.value })}
            maxLength={50}
            required
          />
          <input
            className="num"
            type="number"
            placeholder="정렬"
            style={{ width: 80 }}
            value={groupForm.sortNo}
            onChange={(e) => setGroupForm({ ...groupForm, sortNo: e.target.value })}
          />
          <input
            className="grow"
            placeholder="비고"
            value={groupForm.remark}
            onChange={(e) => setGroupForm({ ...groupForm, remark: e.target.value })}
            maxLength={200}
          />
          <button className="btn" disabled={busy}>
            관리항목 저장
          </button>
        </form>
      )}

      <div className="code-layout">
        <section className="panel">
          <h2 className="panel-title">
            관리항목 <span className="muted small">{groups.length}개</span>
          </h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>항목코드</th>
                  <th>관리항목명</th>
                  <th className="num">코드수</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr
                    key={g.groupCode}
                    className={current?.groupCode === g.groupCode ? 'sel' : ''}
                    onClick={() => setPicked(g.groupCode)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setPicked(g.groupCode)}
                  >
                    <td className="mono strong">{g.groupCode}</td>
                    <td>
                      {g.groupName}
                      {g.remark && <div className="muted small">{g.remark}</div>}
                    </td>
                    <td className="num">{g.codes.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {current && (
          <section className="panel">
            <div className="form-head">
              <div>
                <h2>
                  {current.groupCode} · {current.groupName}
                </h2>
                <span className="muted small">
                  {current.remark || '선택 목록에 표시되는 관리내역 코드예요'} · 최종 수정 {fmtDateTime(current.updatedAt)}
                </span>
              </div>
            </div>

            <form className="panel-bar code-inline-form" onSubmit={addCode}>
              <input
                placeholder="코드 (예: 2)"
                style={{ width: 110 }}
                value={newCode.code}
                onChange={(e) => setNewCode({ ...newCode, code: e.target.value })}
                maxLength={20}
                required
              />
              <input
                placeholder="관리내역명 (예: 외주발주)"
                style={{ width: 160 }}
                value={newCode.codeName}
                onChange={(e) => setNewCode({ ...newCode, codeName: e.target.value })}
                maxLength={50}
                required
              />
              <input
                className="num"
                type="number"
                placeholder="정렬"
                style={{ width: 74 }}
                value={newCode.sortNo}
                onChange={(e) => setNewCode({ ...newCode, sortNo: e.target.value })}
              />
              <input
                className="search"
                placeholder="비고 (선택)"
                value={newCode.remark}
                onChange={(e) => setNewCode({ ...newCode, remark: e.target.value })}
                maxLength={200}
              />
              <button className="btn" disabled={busy}>
                + 코드 추가
              </button>
            </form>

            <div className="table-wrap">
              <table className="tbl lines">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>코드</th>
                    <th style={{ width: 170 }}>관리내역명</th>
                    <th className="num" style={{ width: 76 }}>
                      정렬
                    </th>
                    <th>비고</th>
                    <th style={{ width: 64 }}>사용</th>
                    <th style={{ width: 126 }} />
                  </tr>
                </thead>
                <tbody>
                  {current.codes.map((c) => {
                    const d = drafts[c.code] ?? { codeName: c.codeName, sortNo: String(c.sortNo), remark: c.remark ?? '', useYn: c.useYn }
                    const changed = isDirty(c)
                    return (
                      <tr key={c.code}>
                        <td className="mono strong" style={{ paddingLeft: 10 }}>
                          {c.code}
                        </td>
                        <td>
                          <input
                            value={d.codeName}
                            maxLength={50}
                            onChange={(e) => setDrafts({ ...drafts, [c.code]: { ...d, codeName: e.target.value } })}
                            aria-label={`${c.code} 명칭`}
                          />
                        </td>
                        <td>
                          <input
                            className="num"
                            type="number"
                            value={d.sortNo}
                            onChange={(e) => setDrafts({ ...drafts, [c.code]: { ...d, sortNo: e.target.value } })}
                            aria-label={`${c.code} 정렬`}
                          />
                        </td>
                        <td>
                          <input
                            value={d.remark}
                            maxLength={200}
                            onChange={(e) => setDrafts({ ...drafts, [c.code]: { ...d, remark: e.target.value } })}
                            aria-label={`${c.code} 비고`}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            style={{ width: 16, height: 16 }}
                            checked={d.useYn}
                            onChange={(e) => setDrafts({ ...drafts, [c.code]: { ...d, useYn: e.target.checked } })}
                            aria-label={`${c.code} 사용`}
                          />
                        </td>
                        <td className="num">
                          <button className="btn sm" disabled={busy || !changed} onClick={() => saveCode(c)} style={{ marginRight: 4 }}>
                            저장
                          </button>
                          <button className="btn ghost danger sm" disabled={busy} onClick={() => removeCode(c)}>
                            삭제
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {current.codes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        등록된 관리내역 코드가 없어요. 위 입력줄에서 추가해 보세요
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  )
}
