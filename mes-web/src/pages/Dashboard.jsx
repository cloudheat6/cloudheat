import { Link } from 'react-router'
import { useApi } from '../lib/api.js'
import { ago, fmtNum, fmtPct } from '../lib/format.js'
import { Badge, PageHeader } from '../components/ui.jsx'

function Step({ to, title, value, sub, stage, erp }) {
  const body = (
    <>
      <span className="step-title">
        {title}
        {erp && <span className="step-erp">{erp}</span>}
      </span>
      <span className="step-value">{value}</span>
      <span className="step-sub">{stage ? '준비 중' : sub}</span>
    </>
  )
  return to ? (
    <Link to={to} className={`step ${stage ? 'planned' : ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`step ${stage ? 'planned' : ''}`}>{body}</div>
  )
}

export default function Dashboard() {
  const integ = useApi('/integration/summary', { refreshMs: 10000 })
  const stock = useApi('/inventory/stock', { refreshMs: 15000 })
  const wo = useApi('/work-orders')
  const health = useApi('/health')

  const s = integ.data?.summary
  const rmQty = (stock.data ?? []).filter((r) => r.itemType === '원자재').reduce((a, r) => a + r.qty, 0)
  const fgQty = (stock.data ?? []).filter((r) => r.itemType === '제품').reduce((a, r) => a + r.qty, 0)
  const plan = (wo.data ?? []).reduce((a, r) => a + r.planQty, 0)
  const prod = (wo.data ?? []).reduce((a, r) => a + r.prodQty, 0)

  return (
    <>
      <PageHeader
        title="대시보드"
        desc="ERP 업무 중 현장으로 내려온 구매 · 영업 · 생산 · 재고 흐름을 MES 웹으로 옮기는 중이에요. 화면을 하나씩 늘려가요."
      />

      <section className="flow">
        <div className="flow-row">
          <Step to="/purchase/orders" title="발주관리" erp="ERP→" value={`${fmtNum(s?.receivedOrders?.purchase ?? 0)}건`} sub="ERP에서 수신" />
          <span className="flow-arrow">→</span>
          <Step to="/purchase/receipts" title="입고관리" erp="→ERP" stage value="—" />
          <span className="flow-arrow">→</span>
          <Step to="/inventory/stock" title="원자재 재고" value={fmtNum(rmQty)} sub="원자재창고" />
          <span className="flow-arrow">→</span>
          <Step to="/production/work-orders" title="작업지시관리" erp="→ERP" value={fmtPct(plan ? prod / plan : 0)} sub={`작업지시 ${fmtNum(wo.data?.length ?? 0)}건 달성률`} />
          <span className="flow-arrow">→</span>
          <Step to="/inventory/stock" title="제품 재고" value={fmtNum(fgQty)} sub="제품창고" />
          <span className="flow-arrow">→</span>
          <Step to="/sales/shipments" title="출고관리" erp="→ERP" stage value="—" />
        </div>
        <div className="flow-row secondary">
          <Step to="/sales/orders" title="주문관리" erp="ERP→" value={`${fmtNum(s?.receivedOrders?.sales ?? 0)}건`} sub="생산 · 출고의 근거" />
          <span className="flow-hint">← 주문을 기준으로 생산하고 출고해요</span>
        </div>
      </section>

      <section className="cards-2">
        <div className="card">
          <div className="card-head">
            <h2>ERP 연동 상태</h2>
            <Link to="/integration" className="link">
              모니터링 →
            </Link>
          </div>
          <dl className="facts">
            <dt>가상 ERP</dt>
            <dd>{integ.data == null ? '-' : integ.data.erpOnline ? <Badge tone="ok">연결됨</Badge> : <Badge tone="bad">응답 없음</Badge>}</dd>
            <dt>송신 대기 / 성공 / 실패</dt>
            <dd className="mono">
              {fmtNum(s?.outbox?.pending ?? 0)} / {fmtNum(s?.outbox?.success ?? 0)} /{' '}
              <span className={s?.outbox?.failed ? 'warn-text' : ''}>{fmtNum(s?.outbox?.failed ?? 0)}</span>
            </dd>
            {(s?.lastSync ?? []).map((l) => (
              <FactSync key={l.kind} l={l} />
            ))}
          </dl>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>이렇게 만들었어요</h2>
          </div>
          <ul className="tech">
            <li><strong>화면</strong> React · React Router · AG Grid Community</li>
            <li><strong>API</strong> ASP.NET Core (.NET 10) · Dapper · Npgsql</li>
            <li><strong>DB</strong> PostgreSQL 16 · PL/pgSQL 재고 함수 · 윈도 함수</li>
            <li><strong>연동</strong> 가상 ERP 서버(별도 서비스 · API 키) · Outbox 송신 · 증분 수신</li>
            <li><strong>서버</strong> Ubuntu · Caddy · systemd · Cloudflare</li>
            <li>
              <strong>버전</strong>
              <span className="mono">
                화면 v{__APP_VERSION__} ({__GIT_SHA__}) · API v{health.data?.version ?? '-'}
              </span>
            </li>
          </ul>
          <p className="muted small">실무는 C# · DevExpress WinForms · MSSQL로 더존 ERP(Amaranth 10 · iCUBE)와 연동하는 MES를 개발하고 있어요.</p>
        </div>
      </section>
    </>
  )
}

function FactSync({ l }) {
  return (
    <>
      <dt>{l.kind} 수신</dt>
      <dd>
        <Badge>{l.status}</Badge> <span className="muted small">{ago(l.startedAt)}</span>
      </dd>
    </>
  )
}
