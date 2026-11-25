// 업무 경험: ERP 업무 중 MES 로 옮겨 개발한 기능
const work = [
  { area: '구매', items: '발주, 입고', role: '개발' },
  { area: '영업', items: '주문, 출고', role: '개발' },
  { area: '생산', items: '생산 실적', role: '개발' },
  { area: '재고', items: '재고이동, 재고조정, 기초재고', role: '개발' },
  { area: '품질관리', items: '품질 업무', role: '유지보수' },
]

const erps = [
  { name: '더존 Amaranth 10', how: 'API 연동', when: '현재' },
  { name: '더존 iCUBE', how: 'ERP 연동', when: '이전' },
]

export default function App() {
  return (
    <div className="page">
      <header className="head">
        <h1>김도현</h1>
        <p className="role">MES 개발자</p>
        <p className="intro">
          ERP와 연동되는 MES를 개발하고 있습니다. ERP에서 처리하던 구매 · 영업 · 생산 · 재고 업무 중 현장에서 다뤄야 하는
          기능을 MES로 옮겨 만들었고, 더존 ERP와 데이터를 주고받는 연동을 맡고 있습니다.
        </p>
      </header>

      <section>
        <h2>업무</h2>
        <dl className="rows">
          {work.map((w) => (
            <div key={w.area} className="row">
              <dt>{w.area}</dt>
              <dd>
                {w.items}
                {w.role !== '개발' && <span className="note"> ({w.role})</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>ERP 연동</h2>
        <dl className="rows">
          {erps.map((e) => (
            <div key={e.name} className="row">
              <dt>{e.name}</dt>
              <dd>
                {e.how}
                <span className="note"> · {e.when}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>기술</h2>
        <dl className="rows">
          <div className="row">
            <dt>실무</dt>
            <dd>C#, DevExpress WinForms, MSSQL</dd>
          </div>
          <div className="row">
            <dt>개인 프로젝트</dt>
            <dd>
              React, ASP.NET Core, PostgreSQL
              <span className="sub">Claude(AI)를 활용해 만들면서 익히고 있습니다.</span>
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>프로젝트</h2>
        <article className="project">
          <h3>
            <a href="https://mes.cloudheat.kr">MES 웹</a>
          </h3>
          <p>
            실무에서 WinForms로 만드는 MES를 웹으로 옮겨 보는 개인 프로젝트입니다. 발주 · 주문 수신, 작업지시, 재고
            수불을 구현했고, 별도로 만든 가상 ERP 서버와 데이터를 주고받습니다. 연동 실패 시 재시도와 수동 재전송까지
            다룹니다.
          </p>
          <p className="meta">React · AG Grid · ASP.NET Core · PostgreSQL · Ubuntu</p>
          <p className="links">
            <a href="https://mes.cloudheat.kr">mes.cloudheat.kr</a>
            <a href="https://github.com/cloudheat6/cloudheat">소스 코드</a>
          </p>
        </article>
      </section>

      <footer className="foot">
        <span>© {new Date().getFullYear()} 김도현</span>
        <a href="https://github.com/cloudheat6">GitHub</a>
      </footer>
    </div>
  )
}
