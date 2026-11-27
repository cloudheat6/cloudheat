// 공통 UI 조각
const TONES = {
  대기: 'muted', 진행: 'info', 완료: 'ok', 지연: 'bad',
  성공: 'ok', 실패: 'bad', 부분성공: 'warn',
  기초: 'muted', 입고: 'ok', 생산입고: 'ok', 생산투입: 'warn', 출고: 'info', 이동: 'muted', 조정: 'warn',
  원자재: 'muted', 제품: 'info', 확정: 'info', 취소: 'bad',
  자동: 'muted', 수동: 'info',
}

export function Badge({ children, tone }) {
  return <span className={`badge t-${tone ?? TONES[children] ?? 'muted'}`}>{children}</span>
}

// AG Grid 셀 렌더러로 그대로 쓰기
export const BadgeCell = ({ value }) => (value ? <Badge>{value}</Badge> : null)

export function PageHeader({ title, desc, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}

export function Kpi({ label, value, tone, sub }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="error-box">
      <span>불러오지 못했어요: {error}</span>
      {onRetry && (
        <button className="btn ghost sm" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

export function Chips({ options, value, onToggle, label }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} className={`chip ${value.has(o) ? 'on' : ''}`} onClick={() => onToggle(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

export function useToggleSet(setter) {
  return (v) =>
    setter((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
}
