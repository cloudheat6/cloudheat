import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router'
import { useApi } from './lib/api.js'
import Dashboard from './pages/Dashboard.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import Stock from './pages/Stock.jsx'
import StockTx from './pages/StockTx.jsx'
import Orders from './pages/Orders.jsx'
import Integration from './pages/Integration.jsx'
import Planned from './pages/Planned.jsx'

// 메뉴: planned 가 있으면 아직 준비 중인 화면 (설명 문구)
export const MENU = [
  { group: null, items: [{ to: '/', label: '대시보드', icon: '◧' }] },
  {
    group: '기준정보',
    items: [
      { to: '/master/items', label: '품목관리', icon: '▦', planned: '제품 · 반제품 · 원자재 품목, 단위, 기본 창고' },
      { to: '/master/partners', label: '거래처관리', icon: '☷', planned: '매입처 · 매출처' },
      { to: '/master/processes', label: '공정 · 창고관리', icon: '⌂', planned: '라인 · 공정, 창고' },
      { to: '/master/routings', label: '라우팅관리', icon: '↬', planned: '품목별 공정 순서' },
      { to: '/master/bom', label: 'BOM관리', icon: '⋔', planned: '제품 1개를 만드는 데 필요한 원자재 · 수량 (생산 시 자재 투입에 사용)' },
    ],
  },
  {
    group: '구매',
    items: [
      { to: '/purchase/orders', label: '발주관리', icon: '⇣' },
      { to: '/purchase/receipts', label: '입고관리', icon: '⊕', planned: '발주를 선택해서 입고 등록 → 원자재 재고 증가 → ERP 로 입고 전송' },
    ],
  },
  {
    group: '생산',
    items: [{ to: '/production/work-orders', label: '작업지시관리', icon: '⚙' }],
  },
  {
    group: '영업',
    items: [
      { to: '/sales/orders', label: '주문관리', icon: '⇣' },
      { to: '/sales/shipments', label: '출고관리', icon: '⊖', planned: '주문을 선택해서 출고 등록 → 제품 재고 감소 → ERP 로 출고 전송' },
    ],
  },
  {
    group: '재고',
    items: [
      { to: '/inventory/moves', label: '재고이동관리', icon: '⇄', planned: '창고 간 재고 이동 (출고 창고 −, 입고 창고 +)' },
      { to: '/inventory/adjustments', label: '재고조정관리', icon: '±', planned: '실사 결과와 장부 재고의 차이를 조정 (사유 기록)' },
      { to: '/inventory/opening', label: '기초재고관리', icon: '◫', planned: '시스템 시작 시점의 품목 × 창고별 재고 등록' },
      { to: '/inventory/stock', label: '현재고조회', icon: '▤' },
      { to: '/inventory/transactions', label: '재고수불조회', icon: '≡' },
    ],
  },
  { group: 'ERP 연동', items: [{ to: '/integration', label: '연동 모니터링', icon: '⇅' }] },
]

const PLANNED = MENU.flatMap((g) => g.items).filter((i) => i.planned)

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const { data: integ } = useApi('/integration/summary', { refreshMs: 15000 })

  useEffect(() => setNavOpen(false), [location.pathname])

  const failed = integ?.summary?.outbox?.failed ?? 0
  const erpOnline = integ?.erpOnline

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="26" height="26" />
          <div>
            <strong>cloudheat MES</strong>
            <span>ERP 연동 데모</span>
          </div>
        </div>
        <nav>
          {MENU.map((g, i) => (
            <div key={i} className="nav-group">
              {g.group && <div className="nav-title">{g.group}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon" aria-hidden>
                    {it.icon}
                  </span>
                  <span className="nav-label">{it.label}</span>
                  {it.planned && <span className="nav-stage">준비 중</span>}
                  {it.to === '/integration' && failed > 0 && <span className="nav-alert">{failed}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="https://cloudheat.kr">← cloudheat.kr</a>
          <span title={`커밋 ${__GIT_SHA__}`}>
            v{__APP_VERSION__} · {__GIT_SHA__}
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="메뉴" onClick={() => setNavOpen((v) => !v)}>
            ☰
          </button>
          <div className="topbar-note">가상 데이터</div>
          <NavLink to="/integration" className={`erp-pill ${erpOnline == null ? '' : erpOnline ? 'up' : 'down'}`}>
            <i className="dot" />
            가상 ERP {erpOnline == null ? '확인 중' : erpOnline ? '연결됨' : '응답 없음'}
          </NavLink>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/purchase/orders" element={<Orders kind="발주" />} />
            <Route path="/sales/orders" element={<Orders kind="주문" />} />
            <Route path="/production/work-orders" element={<WorkOrders />} />
            <Route path="/inventory/stock" element={<Stock />} />
            <Route path="/inventory/transactions" element={<StockTx />} />
            <Route path="/integration" element={<Integration />} />
            {PLANNED.map((p) => (
              <Route key={p.to} path={p.to} element={<Planned title={p.label} desc={p.planned} />} />
            ))}
            <Route path="*" element={<Planned title="페이지를 찾을 수 없어요" />} />
          </Routes>
        </main>
      </div>
      <div className="scrim" onClick={() => setNavOpen(false)} />
    </div>
  )
}
