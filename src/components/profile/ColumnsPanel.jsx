// "컬럼" 탭: 컬럼 사전. 문화빅데이터포털 컬럼정의서가 있으면 순서·타입·길이·PK·NOT NULL 까지 보여준다.
const flagClass = (value) => (value === "Y" ? "definition-flag yes" : "definition-flag");

export default function ColumnsPanel({ detail }) {
  const { columns, hasColumns, hasDefinition, portalName } = detail;

  return (
    <section className="profile-card tab-panel">
      <div className="card-heading">
        <div>
          <span className="card-eyebrow">컬럼 정의</span>
          <h2>데이터 항목(컬럼) 설명</h2>
          <p>
            {hasDefinition
              ? `${portalName} 공식 컬럼정의서 기준입니다. 고유 키는 각 행을 구분하는 값, 필수 값은 항상 채워지는 항목입니다.`
              : `${portalName}에 공개된 항목의 영문 이름(컬럼명)과 한글명입니다.`}
          </p>
        </div>
        <span className="example-chip">{hasDefinition ? "컬럼정의서 반영" : hasColumns ? "공식 메타데이터" : "미제공"}</span>
      </div>
      {columns.length > 0 ? (
        <div className="dictionary-wrap">
          <table className={hasDefinition ? "dictionary detailed" : "dictionary"}>
            <thead>
              <tr>
                {hasDefinition && <th>순서</th>}
                <th>컬럼명</th>
                <th>한글명</th>
                {hasDefinition && (
                  <>
                    <th>자료형</th>
                    <th>길이</th>
                    <th title="Primary Key: 각 행을 구분하는 값">고유 키(PK)</th>
                    <th title="NOT NULL: 항상 값이 채워지는 항목">필수 값</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name}>
                  {hasDefinition && <td>{column.order}</td>}
                  <td className="column-name">
                    <b>{column.name}</b>
                    {column.key && <i>{column.key}</i>}
                  </td>
                  <td>{column.label}</td>
                  {hasDefinition && (
                    <>
                      <td>
                        <code>{column.type || "—"}</code>
                      </td>
                      <td>{column.length || "—"}</td>
                      <td>
                        <span className={flagClass(column.pk)}>{column.pk || "—"}</span>
                      </td>
                      <td>
                        <span className={flagClass(column.notNull)}>{column.notNull || "—"}</span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="metadata-empty">
          <b>확인 가능한 컬럼 정의서가 없습니다.</b>
          <p>공식 포털 응답이 제공되지 않아 추정 컬럼은 표시하지 않았습니다.</p>
        </div>
      )}
    </section>
  );
}
