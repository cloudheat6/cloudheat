import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { mesWebUrl } from './lib/api.js'
import Orders from './pages/Orders.jsx'
import Master from './pages/Master.jsx'
import Planned from './pages/Planned.jsx'

// 메뉴: planned 가 있으면 아직 준비 중인 화면 (설명 문구)
export const MENU = [
  {
    group: '기준정보',
    items: [
      { to: '/master/items', label: '품목등록', icon: '▦' },
      { to: '/master/partners', label: '거래처등록', icon: '☷' },
    ],
  },
  {
    group: '구매관리',
    items: [
      { to: '/purchase/orders', label: '발주등록', icon: '✎' },
      { to: '/purchase/receipts', label: '입고관리', icon: '⊕', kind: '외부 연동', planned: 'MES 입고관리에서 등록한 입고 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '영업관리',
    items: [
      { to: '/sales/orders', label: '수주등록', icon: '✎' },
      { to: '/sales/shipments', label: '출고관리', icon: '⊖', kind: '외부 연동', planned: 'MES 출고관리에서 등록한 출고 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '생산관리',
    items: [
      { to: '/production/work-orders', label: '지시관리', icon: '⚙', kind: '외부 연동', planned: 'MES 작업지시관리의 작업지시 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/production/results', label: '실적관리', icon: '✓', kind: '외부 연동', planned: 'MES 생산실적관리에서 등록한 생산실적을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '재고관리',
    items: [
      { to: '/inventory/moves', label: '재고이동관리', icon: '⇄', kind: '외부 연동', planned: 'MES 재고이동관리에서 등록한 창고 간 이동 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/inventory/adjustments', label: '재고조정관리', icon: '±', kind: '외부 연동', planned: 'MES에서 등록한 기초재고(기초조정) · 재고조정 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/inventory/ledger', label: '재고수불부', icon: '≡', kind: '조회', planned: '기초조정 · 입고 · 생산 · 출고 · 이동 · 조정 전표를 기준으로 품목별 재고 수불 내역을 조회하는 화면이에요.' },
    ],
  },
]

const PLANNED = MENU.flatMap((g) => g.items).filter((i) => i.planned)

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setNavOpen(false), [location.pathname])

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="26" height="26" />
          <div>
            <strong>가상 ERP</strong>
            <span>MES 연동 상대 시스템</span>
          </div>
        </div>
        <nav>
          {MENU.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-title">{g.group}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon" aria-hidden>
                    {it.icon}
                  </span>
                  <span className="nav-label">{it.label}</span>
                  {it.planned && <span className="nav-stage">준비 중</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="https://cloudheat.kr">← cloudheat.kr</a>
          <span className="mono" title={`커밋 ${__GIT_SHA__}`}>
            v{__APP_VERSION__} · {__GIT_SHA__}
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="메뉴" onClick={() => setNavOpen((v) => !v)}>
            ☰
          </button>
          <div className="topbar-note">실제 더존 ERP 규격이 아닌, 연동 흐름을 보여주기 위한 가상 시스템이에요.</div>
          <div className="topbar-right">
            <a className="mes-go" href={mesWebUrl()} target="_blank" rel="noreferrer">
              MES로 이동
            </a>
          </div>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/purchase/orders" replace />} />
            <Route path="/purchase" element={<Navigate to="/purchase/orders" replace />} />
            <Route path="/sales" element={<Navigate to="/sales/orders" replace />} />
            <Route path="/master" element={<Navigate to="/master/items" replace />} />

            <Route path="/master/items" element={<Master kind="items" />} />
            <Route path="/master/partners" element={<Master kind="partners" />} />
            <Route path="/purchase/orders" element={<Orders kind="purchase" />} />
            <Route path="/sales/orders" element={<Orders kind="sales" />} />
            {PLANNED.map((p) => (
              <Route key={p.to} path={p.to} element={<Planned title={p.label} kind={p.kind} desc={p.planned} />} />
            ))}
            <Route path="*" element={<Planned title="페이지를 찾을 수 없어요" />} />
          </Routes>
        </main>
      </div>
      <div className="scrim" onClick={() => setNavOpen(false)} />
    </div>
  )
}
