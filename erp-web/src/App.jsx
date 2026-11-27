import { NavLink, Navigate, Route, Routes } from 'react-router'
import Orders from './pages/Orders.jsx'
import Master from './pages/Master.jsx'
import Documents from './pages/Documents.jsx'

const MENU = [
  { to: '/purchase', label: '발주 입력' },
  { to: '/sales', label: '수주 입력' },
  { to: '/documents', label: 'MES 수신 문서' },
  { to: '/master', label: '품목 · 거래처' },
]

export default function App() {
  return (
    <div className="app">
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <img src="/favicon.svg" alt="" width="24" height="24" />
            <strong>가상 ERP</strong>
            <span className="brand-sub">MES 연동 상대 시스템 (데모)</span>
          </div>
          <nav className="menu">
            {MENU.map((m) => (
              <NavLink key={m.to} to={m.to} className={({ isActive }) => `menu-item ${isActive ? 'on' : ''}`}>
                {m.label}
              </NavLink>
            ))}
          </nav>
          <a className="to-mes" href="https://mes.cloudheat.kr" target="_blank" rel="noreferrer">
            MES 열기 ↗
          </a>
        </div>
      </header>
      <main className="body">
        <Routes>
          <Route path="/" element={<Navigate to="/purchase" replace />} />
          <Route path="/purchase" element={<Orders kind="purchase" />} />
          <Route path="/sales" element={<Orders kind="sales" />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/master" element={<Master />} />
          <Route path="*" element={<p className="muted">주소를 확인해 주세요.</p>} />
        </Routes>
      </main>
      <footer className="foot">
        <span>실제 더존 ERP 규격이 아닌, 연동 흐름을 보여주기 위한 가상 시스템이에요.</span>
        <span className="mono" title={`커밋 ${__GIT_SHA__}`}>
          v{__APP_VERSION__} · {__GIT_SHA__}
        </span>
      </footer>
    </div>
  )
}
