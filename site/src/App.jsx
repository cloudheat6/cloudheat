import { useEffect, useState } from 'react'

const stack = [
  { name: 'React', desc: 'Vite · AG Grid 화면' },
  { name: 'ASP.NET Core', desc: '.NET 10 Web API · Dapper' },
  { name: 'PostgreSQL', desc: 'PostgreSQL 16 · 뷰 · 윈도 함수' },
  { name: 'Caddy', desc: 'Ubuntu 24.04 · 자동 HTTPS' },
  { name: 'Cloudflare', desc: 'DNS · 프록시' },
]

// 실무에서 쓰는 기술
const skills = [
  { name: 'C#', desc: 'ERP 연동 MES 업무 로직 · API 연동' },
  { name: 'DevExpress WinForms', desc: 'GridControl 기반 MES 화면 개발' },
  { name: 'MSSQL', desc: '테이블 설계 · 쿼리 · 저장 프로시저' },
]

// ERP 업무 중 MES 로 내려온 기능
const modules = [
  { area: '구매', items: ['발주', '입고'], role: '개발' },
  { area: '영업 · 생산', items: ['주문', '생산', '출고'], role: '개발' },
  { area: '재고', items: ['재고이동', '재고조정', '기초재고'], role: '개발' },
  { area: '품질관리', items: ['품질 업무'], role: '유지보수' },
]

// 연동한 ERP
const erps = [
  { name: '더존 Amaranth 10', desc: 'API 연동', state: '진행 중' },
  { name: '더존 iCUBE', desc: 'ERP 연동', state: '이전 프로젝트' },
]

// Claude 와 바이브코딩으로 만든 것
const vibe = [
  { name: 'React', desc: '이 사이트와 MES 데모 화면 (Vite · AG Grid)' },
  { name: 'PostgreSQL', desc: 'MES 데모 DB · MSSQL → PG 전환 연습' },
]

function formatUptime(ms) {
  const s = Math.floor(ms / 1000)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sec}`
}

export default function App() {
  const [now, setNow] = useState(() => Date.now())
  const [opened] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const built = new Date(__BUILD_TIME__)

  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          cloudheat
        </a>
        <span className="domain">cloudheat.kr</span>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">self-hosted · Hyper-V · Ubuntu</p>
          <h1>
            집에서 돌아가는
            <br />
            <span className="heat">김도현 서버</span>
          </h1>
        </section>

        <section className="exp" aria-label="업무 경험">
          <div className="exp-head">
            <div>
              <p className="eyebrow">Experience</p>
              <h2>ERP 연동 MES 개발</h2>
              <p className="exp-sub">
                ERP 업무 중 현장으로 내려온 기능을 MES에서 개발하고, ERP와 데이터를 주고받도록 연동했어요.
              </p>
            </div>
            <div className="erp-link" aria-label="연동 구조">
              <span className="node">ERP</span>
              <span className="arrow">⇄</span>
              <span className="node mes">MES</span>
            </div>
          </div>

          <div className="modules">
            {modules.map((m) => (
              <article key={m.area} className={`module ${m.role === '유지보수' ? 'maint' : ''}`}>
                <div className="module-top">
                  <h3>{m.area}</h3>
                  <span className="role">{m.role}</span>
                </div>
                <ul>
                  {m.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="erps">
            {erps.map((e) => (
              <div key={e.name} className="erp">
                <strong>{e.name}</strong>
                <span>{e.desc}</span>
                <span className={`erp-state ${e.state === '진행 중' ? 'live' : ''}`}>{e.state}</span>
              </div>
            ))}
          </div>
        </section>

        <a className="work" href="https://mes.cloudheat.kr">
          <div className="work-text">
            <p className="eyebrow">Portfolio · mes.cloudheat.kr</p>
            <h2>ERP 연동 MES 웹 데모</h2>
            <p>
              실무에서 C# DevExpress WinForms + MSSQL로 만드는 ERP 연동 MES를 React · ASP.NET Core · PostgreSQL 웹으로
              옮기고 있어요. 가상 ERP 서버와 실제로 데이터를 주고받고, 생산 · 재고 · 연동 이력을 직접 만져볼 수 있어요.
            </p>
          </div>
          <span className="work-cta">MES 열기 →</span>
        </a>

        <section className="skills" aria-label="기술">
          <div className="skill-group">
            <h2>보유 스킬</h2>
            <p className="skill-sub">실무 · ERP 연동 MES 개발</p>
            <ul>
              {skills.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>
                  <span>{s.desc}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="skill-group vibe">
            <h2>Claude와 바이브코딩</h2>
            <p className="skill-sub">AI와 대화하며 새 스택으로 확장 중</p>
            <ul>
              {vibe.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>
                  <span>{s.desc}</span>
                </li>
              ))}
            </ul>
            <p className="skill-note">
              이 사이트의 React 화면, ASP.NET Core API, PostgreSQL 스키마, 리눅스 서버 배포까지 Claude와 함께 만들었어요.
            </p>
          </div>
        </section>

        <section className="status" aria-label="배포 정보">
          <div className="stat">
            <span className="label">상태</span>
            <span className="value ok">
              <i className="dot" /> online
            </span>
          </div>
          <div className="stat">
            <span className="label">버전</span>
            <span className="value">v{__APP_VERSION__}</span>
          </div>
          <div className="stat">
            <span className="label">빌드 시각</span>
            <span className="value">{built.toLocaleString('ko-KR')}</span>
          </div>
          <div className="stat">
            <span className="label">페이지 체류</span>
            <span className="value mono">{formatUptime(now - opened)}</span>
          </div>
        </section>

        <section className="stack">
          {stack.map((s) => (
            <article key={s.name} className="card">
              <h2>{s.name}</h2>
              <p>{s.desc}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="foot">© {new Date().getFullYear()} cloudheat</footer>
    </div>
  )
}
