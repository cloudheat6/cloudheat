import { Link } from 'react-router'
import { PageHeader } from '../components/ui.jsx'

export default function Planned({ title, desc }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="planned">
        {desc ? (
          <>
            <span className="planned-stage">준비 중</span>
            <p>{desc}</p>
          </>
        ) : (
          <p>주소를 확인해 주세요.</p>
        )}
        <Link to="/" className="btn ghost">
          대시보드로
        </Link>
      </div>
    </>
  )
}
