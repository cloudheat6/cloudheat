import { Link } from 'react-router'

export default function Planned({ title, kind, desc }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="planned">
        {desc ? (
          <>
            <div className="planned-badges">
              <span className="planned-stage">준비 중</span>
              {kind && <span className="tag">{kind}</span>}
            </div>
            <p>{desc}</p>
          </>
        ) : (
          <p>주소를 확인해 주세요.</p>
        )}
        <Link to="/purchase/orders" className="btn ghost">
          발주등록으로
        </Link>
      </div>
    </>
  )
}
