// "테이블" 탭: OpenAPI 데이터는 상세 기능(오퍼레이션) 목록, 파일 데이터는 안내 문구
export default function TablesPanel({ detail, onOpenTab }) {
  const { isPublicApi, operations } = detail;
  return (
    <section className="profile-card tab-panel">
      <div className="card-heading">
        <div>
          <span className="card-eyebrow">테이블 목록</span>
          <h2>{isPublicApi ? "API 상세 기능" : "포함된 테이블"}</h2>
        </div>
        <span className="example-chip">{isPublicApi ? `${operations.length}개` : "정보 없음"}</span>
      </div>
      {isPublicApi ? (
        <div className="operation-list">
          {operations.map((operation) => (
            <button className="table-detail" key={`${operation.path}-${operation.name}`} onClick={() => onOpenTab("columns")}>
              <span className="table-icon large">⌁</span>
              <span>
                <b>{operation.name}</b>
                <small>{operation.path}</small>
              </span>
              <span className="table-meta">
                <b>{operation.columns.length}</b>개 컬럼<i>›</i>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="metadata-empty">
          <b>포털에서는 실제 DB 테이블명을 제공하지 않습니다.</b>
          <p>파일 데이터셋의 공식 컬럼명만 확인할 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
