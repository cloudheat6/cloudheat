import { fmtDateTime, fmtNum, useApi } from '../lib/api.js'

// MES 가 보낸 문서 (생산실적 · 입고 · 출고). docNo 기준으로 한 번만 받음
export default function Documents() {
  const { data, error, reload } = useApi('/documents')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>MES 수신 이력</h1>
          <p>MES 가 보낸 생산실적 · 입고 · 출고 문서예요. 같은 문서가 다시 와도 MES 문서번호로 걸러서 한 번만 반영해요.</p>
        </div>
        <button className="btn ghost" onClick={reload}>
          새로고침
        </button>
      </div>
      {error && <div className="error-box">불러오지 못했어요: {error}</div>}
      <section className="panel">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>수신 일시</th>
                <th>유형</th>
                <th>MES 문서번호</th>
                <th>ERP 전표번호</th>
                <th className="num">행</th>
                <th className="num">수량 합계</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((d) => (
                <tr key={d.docNo}>
                  <td className="mono">{fmtDateTime(d.receivedAt)}</td>
                  <td>
                    <span className="tag">{d.docType}</span>
                  </td>
                  <td className="mono">{d.docNo}</td>
                  <td className="mono strong">{d.erpDocNo}</td>
                  <td className="num">{d.lineCount}</td>
                  <td className="num">{fmtNum(d.totalQty)}</td>
                </tr>
              ))}
              {data && data.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    아직 받은 문서가 없어요. MES 에서 입고 · 생산실적 · 출고를 등록하면 여기에 쌓여요
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
