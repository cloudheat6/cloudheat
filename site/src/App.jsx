// 업무 경험: ERP 업무 중 MES 로 옮겨 개발한 기능
const work = [
  { area: '구매', items: ['발주', '입고'] },
  { area: '영업', items: ['주문', '출고'] },
  { area: '생산', items: ['생산 실적'] },
  { area: '재고', items: ['재고이동', '재고조정', '기초재고'] },
  { area: '품질관리', items: ['품질 업무'], maint: true },
]

const erps = [
  { name: '더존 Amaranth 10', how: 'API 연동', when: '현재', live: true },
  { name: '더존 iCUBE', how: 'ERP 연동', when: '이전' },
]

const shots = [
  { src: '/shots/mes-work-orders.png', caption: '작업지시관리' },
  { src: '/shots/mes-integration.png', caption: 'ERP 연동 모니터링' },
]

function Chips({ items }) {
  return (
    <ul className="chips">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )
}

export default function App() {
  return (
    <>
      <header className="head">
        <div className="wrap">
          <p className="kicker">MES 개발자 · 더존 ERP 연동</p>
          <h1>김도현</h1>
          <p className="intro">
            ERP와 연동되는 MES를 개발하고 있습니다. ERP에서 처리하던 구매 · 영업 · 생산 · 재고 업무 중 현장에서 다뤄야
            하는 기능을 MES로 옮겨 만들었고, 더존 ERP와 데이터를 주고받는 연동을 맡고 있습니다.
          </p>
          <p className="now">
            <i className="dot" /> 지금은 더존 Amaranth 10 API 연동을 개발하고 있습니다
          </p>
        </div>
      </header>

      <main className="wrap">
        <section>
          <h2>업무</h2>
          <div className="work">
            {work.map((w) => (
              <div key={w.area} className={`work-item ${w.maint ? 'maint' : ''}`}>
                <h3>
                  {w.area}
                  {w.maint && <span className="tag">유지보수</span>}
                </h3>
                <Chips items={w.items} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>ERP 연동</h2>
          <ul className="erps">
            {erps.map((e) => (
              <li key={e.name}>
                <i className={`dot ${e.live ? '' : 'off'}`} />
                <strong>{e.name}</strong>
                <span>{e.how}</span>
                <span className="when">{e.when}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>기술</h2>
          <div className="skills">
            <div>
              <h3>실무</h3>
              <Chips items={['C#', 'DevExpress WinForms', 'MSSQL']} />
            </div>
            <div>
              <h3>개인 프로젝트</h3>
              <Chips items={['React', 'ASP.NET Core', 'PostgreSQL']} />
              <p className="sub">Claude(AI)를 활용해 만들면서 익히고 있습니다.</p>
            </div>
          </div>
        </section>

        <section>
          <h2>프로젝트</h2>
          <article className="project">
            <div className="project-head">
              <h3>
                <a href="https://mes.cloudheat.kr">MES 웹</a>
              </h3>
              <span className="meta">개인 프로젝트</span>
            </div>
            <p>
              실무에서 WinForms로 만드는 MES를 웹으로 옮겨 보는 프로젝트입니다. 발주 · 주문 수신, 작업지시, 재고 수불을
              구현했고, 별도로 만든 가상 ERP 서버와 데이터를 주고받습니다. 연동 실패 시 재시도와 수동 재전송까지 다룹니다.
            </p>
            <div className="shots">
              {shots.map((s) => (
                <figure key={s.src}>
                  <a href="https://mes.cloudheat.kr">
                    <img src={s.src} alt={`MES 웹 ${s.caption} 화면`} width="1440" height="900" loading="lazy" />
                  </a>
                  <figcaption>{s.caption}</figcaption>
                </figure>
              ))}
            </div>
            <Chips items={['React', 'AG Grid', 'ASP.NET Core', 'PostgreSQL', 'Ubuntu']} />
            <p className="links">
              <a href="https://mes.cloudheat.kr">mes.cloudheat.kr</a>
              <a href="https://github.com/cloudheat6/cloudheat">소스 코드</a>
            </p>
          </article>
        </section>
      </main>

      <footer className="wrap foot">
        <span>© {new Date().getFullYear()} 김도현</span>
        <a href="https://github.com/cloudheat6">GitHub</a>
      </footer>
    </>
  )
}
