import { fmtDateTime, useApi } from '../lib/api.js'

// 품목 · 거래처: ERP 가 원본. MES 는 1분마다 바뀐 것만 받아감
export default function Master() {
  const items = useApi('/items')
  const partners = useApi('/partners')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>품목 · 거래처</h1>
          <p>기준정보의 원본은 ERP 예요. MES 는 1분마다 바뀐 것만 받아가서 품목관리 · 거래처관리에 반영해요.</p>
        </div>
      </div>
      {(items.error || partners.error) && <div className="error-box">불러오지 못했어요: {items.error || partners.error}</div>}
      <div className="cols">
        <section className="panel">
          <h2 className="panel-title">품목 {items.data && <span className="muted small">{items.data.length}건</span>}</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>품목코드</th>
                  <th>품목명</th>
                  <th>구분</th>
                  <th>단위</th>
                  <th>최종 수정</th>
                </tr>
              </thead>
              <tbody>
                {(items.data ?? [])
                  .toSorted((a, b) => b.itemType.localeCompare(a.itemType) || a.itemCode.localeCompare(b.itemCode))
                  .map((i) => (
                    <tr key={i.itemCode}>
                      <td className="mono strong">{i.itemCode}</td>
                      <td>{i.itemName}</td>
                      <td>
                        <span className="tag">{i.itemType}</span>
                      </td>
                      <td>{i.unit}</td>
                      <td className="mono muted">{fmtDateTime(i.updatedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-title">거래처 {partners.data && <span className="muted small">{partners.data.length}건</span>}</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>코드</th>
                  <th>거래처명</th>
                  <th>구분</th>
                  <th>최종 수정</th>
                </tr>
              </thead>
              <tbody>
                {(partners.data ?? [])
                  .toSorted((a, b) => a.partnerCode.localeCompare(b.partnerCode))
                  .map((p) => (
                    <tr key={p.partnerCode}>
                      <td className="mono strong">{p.partnerCode}</td>
                      <td>{p.partnerName}</td>
                      <td>
                        <span className="tag">{p.partnerType}</span>
                      </td>
                      <td className="mono muted">{fmtDateTime(p.updatedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
