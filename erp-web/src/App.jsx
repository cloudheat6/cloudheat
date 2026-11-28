import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { mesWebUrl } from './lib/api.js'
import Orders from './pages/Orders.jsx'
import Master from './pages/Master.jsx'
import Codes from './pages/Codes.jsx'
import Planned from './pages/Planned.jsx'

// 메뉴: planned 가 있으면 아직 준비 중인 화면 (설명 문구)
export const MENU = [
  {
    group: '기준정보',
    items: [
      { to: '/master/items', label: '품목등록', icon: '▦' },
      { to: '/master/partners', label: '거래처등록', icon: '☷' },
      { to: '/master/codes', label: '관리내역등록', icon: '⊞' },
    ],
  },
  {
    group: '구매관리',
    items: [
      { to: '/purchase/orders', label: '발주등록', icon: '✎' },
      { to: '/purchase/receipts', label: '입고등록', icon: '⊕', kind: '외부 연동', planned: 'MES 입고관리에서 등록한 입고 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '영업관리',
    items: [
      { to: '/sales/orders', label: '주문등록', icon: '✎' },
      { to: '/sales/shipments', label: '출고등록', icon: '⊖', kind: '외부 연동', planned: 'MES 출고관리에서 등록한 출고 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '생산관리',
    items: [
      { to: '/production/work-orders', label: '지시등록', icon: '⚙', kind: '외부 연동', planned: 'MES 작업지시관리의 작업지시 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/production/results', label: '실적등록', icon: '✓', kind: '외부 연동', planned: 'MES 생산실적관리에서 등록한 생산실적을 전송받아 조회하는 읽기 전용 화면이에요.' },
    ],
  },
  {
    group: '재고관리',
    items: [
      { to: '/inventory/moves', label: '재고이동등록', icon: '⇄', kind: '외부 연동', planned: 'MES 재고이동관리에서 등록한 창고 간 이동 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/inventory/adjustments', label: '재고조정등록', icon: '±', kind: '외부 연동', planned: 'MES에서 등록한 기초재고(기초조정) · 재고조정 내역을 전송받아 조회하는 읽기 전용 화면이에요.' },
      { to: '/inventory/ledger', label: '재고수불부', icon: '≡', kind: '조회', planned: '기초조정 · 입고 · 생산 · 출고 · 이동 · 조정 전표를 기준으로 품목별 재고 수불 내역을 조회하는 화면이에요.' },
    ],
  },
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

const isPathInItem = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`)
const findActiveGroup = (pathname) => MENU.find((g) => g.items.some((it) => isPathInItem(pathname, it.to)))?.group ?? null

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const searchRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const activeGroup = findActiveGroup(location.pathname)
  const [openGroup, setOpenGroup] = useState(() => activeGroup)

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

  // 한 번에 한 모듈만 펼침. 다른 모듈을 접으면 현재 활성 화면의 모듈로 복귀
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
          {visibleMenu.map((g) => {
            const isActiveGroup = g.group === activeGroup
            const isOpen = isSearching || openGroup === g.group
            return (
              <div key={g.group} className="nav-group">
                <button
                  type="button"
                  className={`nav-title ${isActiveGroup && isOpen ? 'current' : ''}`}
                  aria-expanded={isOpen}
                  title={isActiveGroup && isOpen ? '현재 활성화된 화면의 모듈이에요' : isOpen ? `${g.group} 접기` : `${g.group} 펼치기`}
                  onClick={() => !isSearching && toggleGroup(g.group)}
                >
                  <span>{g.group}</span>
                  {!isSearching && (
                    <span className={`nav-caret ${isOpen ? 'open' : ''}`} aria-hidden>
                      ▾
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="nav-items">
                    {g.items.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
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
          <div className="topbar-note">
            {import.meta.env.DEV && <span className="tag" style={{ marginRight: 8 }}>DEV</span>}
            실제 더존 ERP 규격이 아닌, 연동 흐름을 보여주기 위한 가상 시스템이에요.
          </div>
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

            <Route path="/master/items" element={<Master key="items" kind="items" />} />
            <Route path="/master/partners" element={<Master key="partners" kind="partners" />} />
            <Route path="/master/codes" element={<Codes />} />
            <Route path="/purchase/orders" element={<Orders key="purchase" kind="purchase" />} />
            <Route path="/sales/orders" element={<Orders key="sales" kind="sales" />} />
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
