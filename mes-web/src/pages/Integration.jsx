import { useMemo, useState } from 'react'
import { api, useApi } from '../lib/api.js'
import { DataGrid } from '../lib/grid.jsx'
import { ago, fmtDateTime, fmtNum } from '../lib/format.js'
import { useToast } from '../lib/toast.jsx'
import { Badge, BadgeCell, ErrorBox, Kpi, PageHeader } from '../components/ui.jsx'

const TABS = [
  { id: 'out', label: 'MES → ERP 송신' },
  { id: 'in', label: 'ERP → MES 수신 이력' },
  { id: 'erp', label: 'ERP 쪽 수신 문서' },
]

export default function Integration() {
  const notify = useToast()
  const [tab, setTab] = useState('out')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState(null)
  const summary = useApi('/integration/summary', { refreshMs: 5000 })
  const outbox = useApi('/integration/outbox?limit=300', { refreshMs: 5000 })
  const syncLog = useApi('/integration/sync-log?limit=200', { refreshMs: 10000 })

  const s = summary.data?.summary
  const erpOnline = summary.data?.erpOnline

  const act = async (fn, okMsg) => {
    setBusy(true)
    try {
      const r = await fn()
      notify(okMsg(r), 'ok')
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy(false)
      summary.reload()
      outbox.reload()
      syncLog.reload()
    }
  }

  const outCols = useMemo(
    () => [
      { field: 'outboxId', headerName: 'No', width: 75, type: 'rightAligned', cellClass: 'mono muted' },
      { field: 'createdAt', headerName: '생성', width: 125, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono', filter: false },
      { field: 'docType', headerName: '문서', width: 95 },
      { field: 'docNo', headerName: 'MES 문서번호', width: 150, cellClass: 'mono strong' },
      { field: 'status', headerName: '상태', width: 85, cellRenderer: BadgeCell },
      { field: 'attempts', headerName: '시도', width: 70, type: 'rightAligned' },
      {
        colId: 'next', headerName: '다음 시도', width: 100, filter: false,
        valueGetter: (p) => (p.data.status === '대기' && p.data.attempts > 0 ? p.data.nextAttemptAt : null),
        valueFormatter: (p) => {
          if (!p.value) return ''
          const s = Math.round((new Date(p.value) - Date.now()) / 1000)
          return s > 0 ? `${s}초 후` : '곧'
        },
      },
      { field: 'erpDocNo', headerName: 'ERP 문서번호', width: 150, cellClass: 'mono' },
      { field: 'sentAt', headerName: '전송 완료', width: 125, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono', filter: false },
      { field: 'lastError', headerName: '마지막 오류', flex: 1, minWidth: 220, cellClassRules: { 'warn-text': (p) => p.data.status !== '성공' && !!p.value } },
      {
        colId: 'act', headerName: '', width: 90, sortable: false, filter: false, pinned: 'right',
        cellRenderer: (p) =>
          p.data.status === '실패' ? (
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation()
                act(() => api(`/integration/outbox/${p.data.outboxId}/retry`, { method: 'POST' }), () => `${p.data.docNo} 재전송 대기`)
              }}
            >
              재전송
            </button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const inCols = useMemo(
    () => [
      { field: 'syncId', headerName: 'No', width: 75, type: 'rightAligned', cellClass: 'mono muted' },
      { field: 'startedAt', headerName: '일시', width: 125, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono', filter: false },
      { field: 'kind', headerName: '대상', width: 80 },
      { field: 'triggerBy', headerName: '구분', width: 80, cellRenderer: BadgeCell },
      { field: 'status', headerName: '결과', width: 95, cellRenderer: BadgeCell },
      { field: 'fetched', headerName: '받은 건', width: 85, type: 'rightAligned' },
      { field: 'applied', headerName: '반영', width: 75, type: 'rightAligned' },
      { field: 'skipped', headerName: '제외', width: 75, type: 'rightAligned', cellClassRules: { 'warn-text': (p) => p.value > 0 } },
      { field: 'message', headerName: '내용', flex: 1, minWidth: 260, tooltipField: 'message' },
    ],
    [],
  )

  return (
    <>
      <PageHeader
        title="ERP 연동 모니터링"
        desc="송신은 Transactional Outbox로 업무 저장과 같은 트랜잭션에 기록한 뒤 백그라운드에서 보내요. ERP는 일부러 15% 확률로 장애, 5% 확률로 응답 지연을 일으켜요."
      >
        <button className="btn ghost" disabled={busy} onClick={() => act(() => api('/integration/sync', { method: 'POST' }), (l) => `수신: ${l.map((x) => `${x.kind} ${x.status}`).join(', ') || '새 데이터 없음'}`)}>
          지금 수신
        </button>
        <button
          className="btn"
          disabled={busy || !s?.outbox?.failed}
          onClick={() => act(() => api('/integration/outbox/retry-failed', { method: 'POST' }), (r) => `실패 ${r.count}건 재전송 대기`)}
        >
          실패 전체 재전송
        </button>
      </PageHeader>
      <ErrorBox error={summary.error} onRetry={summary.reload} />

      <section className="kpis">
        <Kpi label="ERP" value={erpOnline == null ? '-' : erpOnline ? '연결됨' : '응답 없음'} tone={erpOnline ? 'ok' : 'bad'} sub="127.0.0.1:5090" />
        <Kpi label="송신 대기" value={fmtNum(s?.outbox?.pending ?? 0)} tone={s?.outbox?.pending ? 'warn' : ''} sub="재시도 중 포함" />
        <Kpi label="송신 성공" value={fmtNum(s?.outbox?.success ?? 0)} tone="ok" />
        <Kpi label="송신 실패" value={fmtNum(s?.outbox?.failed ?? 0)} tone={s?.outbox?.failed ? 'bad' : 'ok'} sub="수동 재전송 필요" />
        {(s?.lastSync ?? []).map((l) => (
          <Kpi key={l.kind} label={`${l.kind} 수신`} value={ago(l.startedAt)} sub={<Badge>{l.status}</Badge>} />
        ))}
      </section>

      <div className="flow-note">
        <span>생산 실적 저장</span>→<span>outbox 기록 (같은 트랜잭션)</span>→<span>3초마다 송신</span>→
        <span>실패 시 5·10·20·40초 후 재시도</span>→<span>5회 실패 · 검증 오류는 ‘실패’ → 재전송</span>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'out' && (
        <div className={`split ${picked ? 'with-side' : ''}`}>
          <DataGrid
            height={520}
            rowData={outbox.data}
            getRowId={(p) => String(p.data.outboxId)}
            columnDefs={outCols}
            onRowClicked={(e) => setPicked(e.data)}
            overlayNoRowsTemplate="아직 송신한 문서가 없어요. 작업지시관리에서 실적을 수정해 보세요."
          />
          {picked && (
            <aside className="side-panel">
              <div className="side-head">
                <div>
                  <div className="mono strong">{picked.docNo}</div>
                  <div className="muted small">
                    {picked.docType} · <Badge>{picked.status}</Badge> · {picked.attempts}회 시도
                  </div>
                </div>
                <button className="icon-btn" aria-label="닫기" onClick={() => setPicked(null)}>
                  ×
                </button>
              </div>
              <h3>전송 내용 (JSON)</h3>
              <pre className="json">{JSON.stringify(JSON.parse(picked.payload), null, 2)}</pre>
              {picked.lastError && (
                <>
                  <h3>마지막 오류</h3>
                  <p className="small warn-text">{picked.lastError}</p>
                </>
              )}
            </aside>
          )}
        </div>
      )}

      {tab === 'in' && (
        <DataGrid height={520} rowData={syncLog.data} getRowId={(p) => String(p.data.syncId)} columnDefs={inCols} overlayNoRowsTemplate="수신 이력이 없어요" />
      )}

      {tab === 'erp' && <ErpDocuments />}
    </>
  )
}

// 상대편(ERP)이 실제로 받은 문서 — 송신이 정말 도착했는지 확인
function ErpDocuments() {
  const { data, error, reload, loading } = useApi('/integration/erp/documents')
  const cols = useMemo(
    () => [
      { field: 'receivedAt', headerName: 'ERP 수신 일시', width: 140, valueFormatter: (p) => fmtDateTime(p.value), cellClass: 'mono', filter: false },
      { field: 'docType', headerName: '문서', width: 100 },
      { field: 'docNo', headerName: 'MES 문서번호', width: 160, cellClass: 'mono' },
      { field: 'erpDocNo', headerName: 'ERP 문서번호', width: 160, cellClass: 'mono strong' },
      { field: 'lineCount', headerName: '라인', width: 80, type: 'rightAligned' },
      { field: 'totalQty', headerName: '수량 합계', width: 110, type: 'rightAligned', valueFormatter: (p) => fmtNum(p.value) },
    ],
    [],
  )
  return (
    <>
      <div className="toolbar">
        <span className="muted small">ERP의 API를 직접 조회해요. ERP도 가끔 장애를 내니 실패하면 다시 시도하세요.</span>
        <div className="toolbar-actions">
          <button className="btn ghost" onClick={reload} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <DataGrid height={480} rowData={data} getRowId={(p) => p.data.docNo} columnDefs={cols} overlayNoRowsTemplate="ERP가 받은 문서가 없어요" />
    </>
  )
}
