// "연관 데이터" 탭: 같은 분야 또는 같은 출처 시스템 데이터
export default function RelatedPanel({ related, onSelect }) {
  return (
    <section className="profile-card tab-panel">
      <div className="card-heading">
        <div>
          <span className="card-eyebrow">연관 데이터</span>
          <h2>함께 보면 좋은 데이터</h2>
          <p>같은 분야 또는 출처 시스템을 기준으로 연결했습니다.</p>
        </div>
      </div>
      <div className="related-grid">
        {related.map((dataset) => (
          <button key={dataset.no} onClick={() => onSelect(dataset)}>
            <span className="table-icon">▦</span>
            <span>
              <b>{dataset.name}</b>
              <small>{dataset.sys}</small>
            </span>
            <i>›</i>
          </button>
        ))}
      </div>
    </section>
  );
}
