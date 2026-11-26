import { useState } from 'react'

// 왼쪽 제품 목록 (라우팅 · BOM 관리에서 공통)
export default function ProductPicker({ items, selected, onSelect, count, countLabel }) {
  const [q, setQ] = useState('')
  const list = (items ?? []).filter(
    (i) => i.itemType === '제품' && (!q || i.itemCode.toLowerCase().includes(q.toLowerCase()) || i.itemName.includes(q)),
  )
  return (
    <aside className="picker">
      <input className="search" type="search" placeholder="제품 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {list.map((i) => (
          <li key={i.itemCode}>
            <button className={`pick ${selected === i.itemCode ? 'on' : ''} ${i.useYn ? '' : 'off'}`} onClick={() => onSelect(i.itemCode)}>
              <span className="pick-main">
                <span className="mono strong">{i.itemCode}</span>
                <span className="pick-name">{i.itemName}</span>
              </span>
              <span className={`pick-count ${count(i) ? '' : 'zero'}`}>
                {count(i)}
                {countLabel}
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted small pick-empty">제품이 없어요</li>}
      </ul>
    </aside>
  )
}
