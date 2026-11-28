import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useApi } from './lib/api.js'
import { erpWebUrl } from './lib/format.js'
import Dashboard from './pages/Dashboard.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import Stock from './pages/Stock.jsx'
import StockTx from './pages/StockTx.jsx'
import Opening from './pages/Opening.jsx'
import Orders from './pages/Orders.jsx'
import Integration from './pages/Integration.jsx'
import Planned from './pages/Planned.jsx'
import Items from './pages/master/Items.jsx'
import Partners from './pages/master/Partners.jsx'
import Codes from './pages/master/Codes.jsx'
import ProcessWarehouse from './pages/master/ProcessWarehouse.jsx'
import Routings from './pages/master/Routings.jsx'
import Bom from './pages/master/Bom.jsx'

// 메뉴: planned 가 있으면 아직 준비 중인 화면 (설명 문구)
export const MENU = [
  { group: null, items: [{ to: '/', label: '대시보드', icon: '◧' }] },
  {
    group: '기준정보',
    items: [
      { to: '/master/codes', label: '공통코드관리', icon: '⊞' },
      { to: '/master/items', label: '품목관리', icon: '▦' },
      { to: '/master/partners', label: '거래처관리', icon: '☷' },
      { to: '/master/processes', label: '공정 · 창고관리', icon: '⌂' },
      { to: '/master/routings', label: '라우팅관리', icon: '↬' },
      { to: '/master/bom', label: 'BOM관리', icon: '⋔' },
    ],
  },
  {
    group: '구매',
    items: [
      { to: '/purchase/orders', label: '발주조회', icon: '⇣' },
      { to: '/purchase/receipts', label: '입고관리', icon: '⊕', planned: '발주를 선택해서 입고 등록 → 원자재 재고 증가 → ERP 로 입고 전송' },
    ],
  },
  {
    group: '생산',
    items: [
      { to: '/production/work-orders', label: '작업지시관리', icon: '⚙' },
      { to: '/production/results', label: '생산실적관리', icon: '✓', planned: '작업지시를 골라 양품 · 불량 실적을 건별로 등록 · 취소 → 제품 재고 반영 · ERP 로 생산실적 전송' },
    ],
  },
  {
    group: '영업',
    items: [
      { to: '/sales/orders', label: '주문조회', icon: '⇣' },
      { to: '/sales/shipments', label: '출고관리', icon: '⊖', planned: '주문을 선택해서 출고 등록 → 제품 재고 감소 → ERP 로 출고 전송' },
    ],
  },
  {
    group: '재고',
    items: [
      { to: '/inventory/moves', label: '재고이동관리', icon: '⇄', planned: '창고 간 재고 이동 (출고 창고 −, 입고 창고 +)' },
      { to: '/inventory/adjustments', label: '재고조정관리', icon: '±', planned: '실사 결과와 장부 재고의 차이를 조정 (사유 기록)' },
      { to: '/inventory/opening', label: '기초재고관리', icon: '◫' },
      { to: '/inventory/stock', label: '현재고조회', icon: '▤' },
      { to: '/inventory/transactions', label: '재고수불조회', icon: '≡' },
    ],
  },
  { group: 'ERP 연동', items: [{ to: '/integration', label: '연동 모니터링', icon: '⇅' }] },
]

const PLANNED = MENU.flatMap((g) => g.items).filter((i) => i.planned)
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

const normMenu = (s) => s.replace(/[\s·]/g, '').toLowerCase()
const toChoseong = (s) =>
  [...normMenu(s)]
    .map((ch) => {
      const code = ch.charCodeAt(0) - 0xac00
      return code >= 0 && code <= 11171 ? CHOSEONG[Math.floor(code / 588)] : ch
    })
    .join('')

const matchMenu = (query, group, label) => {
  const q = normMenu(query)
  if (!q) return true
  const target = `${group ?? ''}${label}`
  return normMenu(target).includes(q) || toChoseong(target).includes(q)
}

const isPathInItem = (pathname, to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`))
const findActiveGroup = (pathname) => MENU.find((g) => g.group && g.items.some((it) => isPathInItem(pathname, it.to)))?.group ?? null

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const searchRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const activeGroup = findActiveGroup(location.pathname)
  const [openGroup, setOpenGroup] = useState(() => activeGroup)
  const { data: integ } = useApi('/integration/summary', { refreshMs: 15000 })

  useEffect(() => {
    setNavOpen(false)
    setOpenGroup(activeGroup)
  }, [location.pathname, activeGroup])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setNavOpen(true)
        requestAnimationFrame(() => {
          searchRef.current?.focus()
          searchRef.current?.select()
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 한 번에 한 모듈만 펼침. 다른 모듈을 접으면 현재 활성 화면의 모듈(없으면 전체 접힘)로 복귀
  const toggleGroup = (group) => {
    setOpenGroup((prev) => (prev === group ? activeGroup : group))
  }

  const isSearching = menuQuery.trim().length > 0
  const visibleMenu = useMemo(() => {
    if (!isSearching) return MENU
    return MENU.map((g) => ({ ...g, items: g.items.filter((it) => matchMenu(menuQuery, g.group, it.label)) })).filter((g) => g.items.length > 0)
  }, [isSearching, menuQuery])

  const flatMatches = useMemo(() => (isSearching ? visibleMenu.flatMap((g) => g.items) : []), [isSearching, visibleMenu])
  const safeIdx = flatMatches.length > 0 ? Math.min(highlightIdx, flatMatches.length - 1) : -1
  const focusTo = safeIdx >= 0 ? flatMatches[safeIdx].to : null

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown' && flatMatches.length > 0) {
      e.preventDefault()
      setHighlightIdx((i) => (i + 1) % flatMatches.length)
    } else if (e.key === 'ArrowUp' && flatMatches.length > 0) {
      e.preventDefault()
      setHighlightIdx((i) => (i - 1 + flatMatches.length) % flatMatches.length)
    } else if (e.key === 'Enter' && focusTo) {
      e.preventDefault()
      navigate(focusTo)
      setMenuQuery('')
      setHighlightIdx(0)
      searchRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (menuQuery) {
        setMenuQuery('')
        setHighlightIdx(0)
      } else {
        searchRef.current?.blur()
      }
    }
  }

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
        <div className="nav-search">
          <input
            ref={searchRef}
            type="text"
            placeholder="메뉴 검색 (초성 가능)"
            aria-label="메뉴 검색"
            value={menuQuery}
            onChange={(e) => {
              setMenuQuery(e.target.value)
              setHighlightIdx(0)
            }}
            onKeyDown={onSearchKeyDown}
          />
          {menuQuery ? (
            <button
              type="button"
              className="nav-search-clear"
              aria-label="검색어 지우기"
              onClick={() => {
                setMenuQuery('')
                setHighlightIdx(0)
                searchRef.current?.focus()
              }}
            >
              ×
            </button>
          ) : (
            <span className="nav-search-hint" aria-hidden>
              Ctrl+K
            </span>
          )}
        </div>
        <nav>
          {visibleMenu.map((g, i) => {
            const isActiveGroup = g.group != null && g.group === activeGroup
            const isOpen = !g.group || isSearching || openGroup === g.group
            return (
              <div key={g.group ?? i} className="nav-group">
                {g.group && (
                  <button
                    type="button"
                    className={`nav-title ${isActiveGroup && isOpen ? 'current' : ''}`}
                    aria-expanded={isOpen}
                    title={isActiveGroup && isOpen ? '현재 활성화된 화면의 모듈이에요' : isOpen ? `${g.group} 접기` : `${g.group} 펼치기`}
                    onClick={() => !isSearching && toggleGroup(g.group)}
                  >
                    <span>{g.group}</span>
                    {g.group === 'ERP 연동' && !isOpen && failed > 0 && <span className="nav-alert">{failed}</span>}
                    {!isSearching && (
                      <span className={`nav-caret ${isOpen ? 'open' : ''}`} aria-hidden>
                        ▾
                      </span>
                    )}
                  </button>
                )}
                {isOpen && (
                  <div className="nav-items">
                    {g.items.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        end={it.to === '/'}
                        onMouseEnter={() => {
                          if (!isSearching) return
                          const idx = flatMatches.findIndex((m) => m.to === it.to)
                          if (idx >= 0) setHighlightIdx(idx)
                        }}
                        onClick={() => {
                          if (isSearching) {
                            setMenuQuery('')
                            setHighlightIdx(0)
                          }
                        }}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${isSearching && focusTo === it.to ? 'kb-focus' : ''}`}
                      >
                        <span className="nav-icon" aria-hidden>
                          {it.icon}
                        </span>
                        <span className="nav-label">{it.label}</span>
                        {it.planned && <span className="nav-stage">준비 중</span>}
                        {it.to === '/integration' && failed > 0 && <span className="nav-alert">{failed}</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {isSearching && flatMatches.length === 0 && <div className="nav-empty">일치하는 메뉴가 없어요</div>}
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
          <div className="topbar-note">
            {import.meta.env.DEV && <span className="badge t-info" style={{ marginRight: 8 }}>DEV</span>}
            가상 데이터
          </div>
          <div className="topbar-right">
            <NavLink to="/integration" className={`erp-pill ${erpOnline == null ? '' : erpOnline ? 'up' : 'down'}`}>
              <i className="dot" />
              ERP {erpOnline == null ? '확인 중' : erpOnline ? '연결됨' : '응답 없음'}
            </NavLink>
            <a className="erp-go" href={erpWebUrl()} target="_blank" rel="noreferrer">
              ERP로 이동
            </a>
          </div>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/purchase/orders" element={<Orders key="발주" kind="발주" />} />
            <Route path="/sales/orders" element={<Orders key="주문" kind="주문" />} />
            <Route path="/production/work-orders" element={<WorkOrders />} />
            <Route path="/inventory/opening" element={<Opening />} />
            <Route path="/inventory/stock" element={<Stock />} />
            <Route path="/inventory/transactions" element={<StockTx />} />
            <Route path="/integration" element={<Integration />} />
            <Route path="/master/codes" element={<Codes />} />
            <Route path="/master/items" element={<Items />} />
            <Route path="/master/partners" element={<Partners />} />
            <Route path="/master/processes" element={<ProcessWarehouse />} />
            <Route path="/master/routings" element={<Routings />} />
            <Route path="/master/bom" element={<Bom />} />
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
