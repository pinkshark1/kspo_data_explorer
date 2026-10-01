import SampleTable from "../SampleTable.jsx";

// "한눈에 보기" 탭: 컬럼 요약 카드 + 샘플 행 카드
export default function OverviewPanel({ dataset, detail, onOpenTab }) {
  const { columns, hasColumns, hasDefinition, isPublicApi, operations, apiSample, csvSample, rows, hasRows, portalName } = detail;

  const tableDescription = isPublicApi
    ? `${portalName}에 공개된 오픈API이며 ${operations.length}개 상세 기능의 응답 컬럼을 포함합니다.`
    : `${portalName}에 공개된 파일 데이터셋입니다.`;

  const sampleHelper = apiSample
    ? `${apiSample.operationName} 응답 ${rows.length}행입니다.`
    : csvSample
      ? `제공 CSV의 첫 ${rows.length}개 행입니다.`
      : "샘플 데이터가 아직 없습니다.";

  return (
    <section className="overview-grid">
      <article className="profile-card schema-card">
        <div className="card-heading">
          <div>
            <span className="card-eyebrow">테이블 구조</span>
            <h2>어떤 정보가 있나요?</h2>
          </div>
          <span className="example-chip">{hasColumns ? "공식 컬럼" : "정의서 미제공"}</span>
        </div>
        <div className="table-summary">
          <span className="table-icon large">▦</span>
          <div>
            <strong>{dataset.name}</strong>
            <p>{tableDescription}</p>
          </div>
        </div>
        {columns.length > 0 ? (
          <>
            <div className="schema-metrics">
              <span>
                <b>{columns.length}개</b> 컬럼
              </span>
              <span>
                <b>공식</b> 정의
              </span>
            </div>
            <table className="schema-preview">
              <thead>
                <tr>
                  <th>컬럼명</th>
                  <th>한글명</th>
                  {hasDefinition && <th>형식</th>}
                </tr>
              </thead>
              <tbody>
                {columns.slice(0, 5).map((column) => (
                  <tr key={column.name}>
                    <td>{column.name}</td>
                    <td>{column.label}</td>
                    {hasDefinition && (
                      <td>
                        {column.type}
                        {column.length && `(${column.length})`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="text-button" onClick={() => onOpenTab("columns")}>
              전체 {columns.length}개 컬럼 보기 <span>⌄</span>
            </button>
          </>
        ) : (
          <div className="metadata-empty">
            <b>공개된 컬럼 정의가 없습니다.</b>
            <p>포털에 정의서가 추가되면 실제 컬럼명으로 갱신할 수 있습니다.</p>
          </div>
        )}
      </article>

      <article className="profile-card sample-card">
        <div className="card-heading">
          <div>
            <span className="card-eyebrow">샘플 행</span>
            <h2>데이터는 이렇게 생겼어요</h2>
          </div>
          <span className="helper-text">{sampleHelper}</span>
        </div>
        {!hasRows ? (
          <div className="metadata-empty">
            <b>{csvSample ? "제공된 CSV에 데이터 행이 없습니다." : "컬럼명만 반영된 데이터셋입니다."}</b>
            <p>{csvSample ? "헤더만 존재해 표시할 수 있는 샘플 행이 없습니다." : "실제 행 데이터는 별도 원천 파일을 받아야 표시할 수 있습니다."}</p>
          </div>
        ) : (
          <>
            <SampleTable detail={detail} compact />
            <button className="text-button" onClick={() => onOpenTab("sample")}>
              샘플 데이터 더 보기 <span>›</span>
            </button>
          </>
        )}
      </article>
    </section>
  );
}
