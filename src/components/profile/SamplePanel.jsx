import SampleTable from "../SampleTable.jsx";

// "샘플 데이터" 탭: CSV 원본 앞부분 또는 OpenAPI 응답. API는 상세 기능을 골라 볼 수 있다.
export default function SamplePanel({ detail, onChangeOperation }) {
  const { apiSample, apiOperations, csvSample, isCultureSample, rows, hasRows, totalRows, portalName } = detail;

  const chip = apiSample ? `API 응답 ${rows.length}행` : csvSample ? `원본 ${rows.length}행` : "미반영";

  const note = apiSample
    ? `※ 제공된 XML 응답의 원본 순서를 기준으로 ${rows.length}행을 표시합니다. API 전체 조회 결과는 ${totalRows?.toLocaleString("ko-KR")}행입니다.`
    : isCultureSample
      ? `※ ${portalName} 다운로드 CSV의 원본 순서를 기준으로 최대 10행 중 ${rows.length}행을 표시합니다.`
      : `※ 제공된 CSV의 원본 순서를 기준으로 ${rows.length}행을 표시합니다. 전체 원본은 ${totalRows?.toLocaleString("ko-KR")}행입니다.`;

  return (
    <section className="profile-card tab-panel">
      <div className="card-heading">
        <div>
          <span className="card-eyebrow">데이터 예시</span>
          <h2>샘플 데이터</h2>
          <p>값의 형태와 데이터 패턴을 빠르게 확인할 수 있습니다.</p>
        </div>
        <span className="example-chip">{chip}</span>
      </div>
      {!hasRows ? (
        <div className="metadata-empty">
          <b>{csvSample ? "제공된 CSV에 데이터 행이 없습니다." : "샘플 데이터는 아직 연결되지 않았습니다."}</b>
          <p>{csvSample ? "원본 파일에는 컬럼 헤더만 있고 실제 레코드는 없습니다." : "이번 단계에서는 공식 컬럼명만 반영했습니다."}</p>
        </div>
      ) : (
        <>
          {apiSample && (
            <div className="sample-operation-picker">
              <label>
                <span>API 상세 기능</span>
                <select value={apiSample.path} onChange={(event) => onChangeOperation(event.target.value)}>
                  {apiOperations.map((operation) => (
                    <option key={operation.path} value={operation.path}>
                      {operation.operationName}
                    </option>
                  ))}
                </select>
              </label>
              <code>{apiSample.path}</code>
            </div>
          )}
          <SampleTable detail={detail} />
          <p className="sample-note">{note}</p>
        </>
      )}
    </section>
  );
}
